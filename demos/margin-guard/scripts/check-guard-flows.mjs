// Headless check of the approval flows in apps/margin-guard/src/lib/guard.ts,
// run against the dev engine, Redis and Postgres. Uses a throwaway customer
// (`selftest`) and removes its keys at the end; demo customers are untouched.
// Audit rows it writes are tagged with customer `selftest`.
//
// Run from the workspace root:
//   node --env-file=.env --import ./scripts/ts-hooks.mjs --experimental-transform-types scripts/check-guard-flows.mjs
import { RocketRideClient } from 'rocketride';
import * as guard from '../apps/margin-guard/src/lib/guard.ts';
import { keys, currentMonth, FEATURES } from '../apps/margin-guard/src/lib/keys.ts';
import { redis, sql } from '../apps/margin-guard/src/lib/session.ts';

const C = 'selftest';
const NAME = 'Selftest Co';
const ACTOR = 'flow-check';
const client = new RocketRideClient();
await client.connect();

let failures = 0;
const check = (label, ok, extra = '') => {
	if (!ok) failures++;
	console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${extra ? `  (${extra})` : ''}`);
};
const findCustomer = async () => (await guard.loadSnapshot(client)).customers.find((c) => c.id === C);
const budget = async () => JSON.parse((await redis.get(client, keys.budget(C))).value).budget_usd;
const req = (extra) => ({ customer: C, customerName: NAME, reason: 'flow check', ...extra });

const initialApply = (await redis.get(client, keys.applyEnabled())).value === 'on';
const created = [];

try {
	// Throwaway customer
	await redis.set(
		client,
		keys.budget(C),
		JSON.stringify({ name: NAME, plan: 'Starter', revenue_usd: 50, budget_usd: 20 }),
		600
	);
	await guard.setApplyEnabled(client, ACTOR, true);

	// 1. Cheaper model, then back to standard
	let p = await guard.propose(client, ACTOR, req({ type: 'set_fallback', model: 'gemini-flash-lite' }));
	created.push(p.id);
	let r = await guard.approve(client, ACTOR, p.id);
	const fb = await redis.get(client, keys.fallback(C));
	check(
		'set_fallback applied',
		r.outcome === 'applied' && fb.value === 'gemini-flash-lite' && fb.ttl_seconds > 0,
		r.detail
	);
	const t1 = await guard.sendTraffic(client, C, 'chat', 10);
	check(
		'traffic uses fallback model and cheaper cost',
		t1.model === 'gemini-flash-lite' && Math.abs(t1.costUsd - 0.006) < 1e-9,
		JSON.stringify(t1)
	);
	p = await guard.propose(client, ACTOR, req({ type: 'clear_fallback' }));
	created.push(p.id);
	r = await guard.approve(client, ACTOR, p.id);
	check(
		'clear_fallback applied',
		r.outcome === 'applied' && !(await redis.get(client, keys.fallback(C))).found,
		r.detail
	);
	const t2 = await guard.sendTraffic(client, C, 'chat', 10);
	check(
		'traffic back on standard model',
		t2.model === 'standard' && Math.abs(t2.costUsd - 0.04) < 1e-9,
		JSON.stringify(t2)
	);

	// 2. Budget change
	p = await guard.propose(client, ACTOR, req({ type: 'set_budget', budgetUsd: 35 }));
	created.push(p.id);
	r = await guard.approve(client, ACTOR, p.id);
	check('set_budget applied', r.outcome === 'applied' && (await budget()) === 35, r.detail);
	r = await guard.approve(client, ACTOR, p.id);
	check('approving an applied proposal again reports already_applied', r.outcome === 'already_applied', r.detail);
	const snapC = await findCustomer();
	check('snapshot shows new budget', snapC?.budgetUsd === 35, `budget=${snapC?.budgetUsd}`);

	// 3. Reject
	p = await guard.propose(client, ACTOR, req({ type: 'set_budget', budgetUsd: 999 }));
	created.push(p.id);
	const pendingP = (await guard.loadSnapshot(client)).pending.find((x) => x.id === p.id);
	check('proposal listed as pending', !!pendingP);
	const removed = await guard.reject(client, ACTOR, pendingP);
	check(
		'reject removes pending key, budget unchanged',
		removed && !(await redis.get(client, keys.pending(p.id))).found && (await budget()) === 35
	);
	check('rejecting it again reports it was already gone', (await guard.reject(client, ACTOR, pendingP)) === false);
	r = await guard.approve(client, ACTOR, p.id);
	check('approving a rejected proposal reports expired', r.outcome === 'expired', r.detail);

	// 4. Extend a pending proposal and an active switch
	p = await guard.propose(client, ACTOR, req({ type: 'switch_off', feature: 'search', ttlSeconds: 120 }));
	created.push(p.id);
	await guard.extend(client, ACTOR, keys.pending(p.id), 7200, `Extended ${p.id}`);
	const pt = await redis.ttl(client, keys.pending(p.id));
	check('extend pending proposal to 2 h', pt.ttl_seconds > 3600, `ttl=${pt.ttl_seconds}`);
	r = await guard.approve(client, ACTOR, p.id);
	check('switch_off applied', r.outcome === 'applied', r.detail);
	check('traffic blocked while switched off', (await guard.sendTraffic(client, C, 'search', 5)).blocked === true);
	const extended = await guard.extend(client, ACTOR, keys.switchOff(C, 'search'), 1800, 'Extended switch');
	const st = await redis.ttl(client, keys.switchOff(C, 'search'));
	check('extend active switch', extended && st.ttl_seconds > 1700 && st.ttl_seconds <= 1800, `ttl=${st.ttl_seconds}`);
	check(
		'extend on missing key returns false',
		(await guard.extend(client, ACTOR, 'switch:selftest:nope', 60, 'x')) === false
	);
	p = await guard.propose(client, ACTOR, req({ type: 'switch_on', feature: 'search' }));
	created.push(p.id);
	r = await guard.approve(client, ACTOR, p.id);
	check(
		'switch_on applied, traffic flows',
		r.outcome === 'applied' && !(await guard.sendTraffic(client, C, 'search', 5)).blocked,
		r.detail
	);

	// 5. Dry run
	await guard.setApplyEnabled(client, ACTOR, false);
	p = await guard.propose(client, ACTOR, req({ type: 'set_budget', budgetUsd: 44 }));
	created.push(p.id);
	r = await guard.approve(client, ACTOR, p.id);
	const lockAfterDry = await redis.get(client, keys.applyLock(p.id));
	check(
		'dry run does not apply, proposal still pending, lock released',
		r.outcome === 'dry_run' &&
			(await budget()) === 35 &&
			(await redis.get(client, keys.pending(p.id))).found &&
			!lockAfterDry.found,
		r.detail
	);
	await guard.setApplyEnabled(client, ACTOR, true);
	r = await guard.approve(client, ACTOR, p.id);
	check(
		'same proposal applies after dry run is turned off',
		r.outcome === 'applied' && (await budget()) === 44,
		r.detail
	);

	// 6. Two approvals racing
	p = await guard.propose(client, ACTOR, req({ type: 'set_budget', budgetUsd: 51 }));
	created.push(p.id);
	const race = await Promise.allSettled([
		guard.approve(client, 'approver-a', p.id),
		guard.approve(client, 'approver-b', p.id),
	]);
	const outcomes = race
		.map((x) => (x.status === 'fulfilled' ? x.value.outcome : `error: ${x.reason?.message}`))
		.sort();
	check(
		'racing approvals: exactly one applies',
		outcomes.filter((o) => o === 'applied').length === 1,
		outcomes.join(', ')
	);
	check(
		'racing approvals: the other is already_applied or expired',
		outcomes.some((o) => o === 'already_applied' || o === 'expired'),
		outcomes.join(', ')
	);
	const [row] = await sql(
		client,
		"SELECT count(*)::int AS n FROM mg_audit WHERE action_id = $1 AND event = 'applied'",
		[p.id]
	);
	check('racing approvals: one "applied" audit row', row?.n === 1, `rows=${row?.n}`);

	// 7. Proposal expiring on its own
	p = await guard.propose(client, ACTOR, req({ type: 'set_budget', budgetUsd: 77 }));
	created.push(p.id);
	await redis.expire(client, keys.pending(p.id), 2);
	await new Promise((res) => setTimeout(res, 3500));
	const gone = !(await guard.loadSnapshot(client)).pending.some((x) => x.id === p.id);
	r = await guard.approve(client, ACTOR, p.id);
	check(
		'expired proposal disappears and approval reports expired',
		gone && r.outcome === 'expired' && (await budget()) === 51,
		r.detail
	);
} catch (e) {
	failures++;
	console.log('ERROR', e?.stack ?? e);
} finally {
	// Clean up the throwaway customer, its counters, switches and locks.
	const month = currentMonth();
	const junk = [
		keys.budget(C),
		keys.fallback(C),
		...FEATURES.flatMap((f) => [keys.usage(C, f, month), keys.calls(C, f, month), keys.switchOff(C, f)]),
		...created.flatMap((id) => [keys.pending(id), keys.applyLock(id)]),
	];
	await redis.deleteMany(client, junk);
	if (!initialApply) await guard.setApplyEnabled(client, ACTOR, false);
	await client.disconnect();
}
console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed');
process.exit(failures ? 1 : 0);
