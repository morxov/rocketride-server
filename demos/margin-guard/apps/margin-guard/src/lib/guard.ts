/**
 * AI Margin Guard domain logic: reading the live picture out of Redis,
 * proposing changes, and applying approved changes exactly once.
 *
 * Rules this file enforces:
 *  - A change never writes directly. It becomes a `pending:` key that expires
 *    on its own; only an approval applies it.
 *  - Applying claims a one-time `lock:apply:` key (SET NX) first, so two
 *    approvers, a double click or a retry cannot apply the same change twice.
 *  - Every step is written to the audit log.
 */

import type { RocketRideClient } from 'rocketride';
import {
	ALERT_THRESHOLDS,
	ALERT_TTL,
	COUNTER_TTL,
	FALLBACK_COST_FACTOR,
	FALLBACK_MODEL,
	FEATURES,
	LOCK_TTL,
	PENDING_TTL,
	ROLLUP_TTL,
	UNIT_COST_MICROS,
	currentMonth,
	keys,
	secondsToMonthEnd,
	type Feature,
} from './keys';
import { RedisToolError, redis, sql } from './session';

// =============================================================================
// TYPES
// =============================================================================

export interface FeatureUsage {
	costUsd: number;
	calls: number;
	/** Seconds until the off switch lifts; null when the feature is on. */
	offTtl: number | null;
}

export interface Customer {
	id: string;
	name: string;
	plan: string;
	revenueUsd: number;
	budgetUsd: number;
	costUsd: number;
	calls: number;
	/** Share of the AI budget used, in percent (can exceed 100). */
	usedPct: number;
	/** (revenue - AI cost) / revenue, in percent (negative when losing money). */
	marginPct: number;
	features: Record<Feature, FeatureUsage>;
	fallback: { model: string; ttl: number } | null;
	/** Alert thresholds already recorded this month. */
	alerts: number[];
}

export type ChangeType = 'set_budget' | 'switch_off' | 'switch_on' | 'set_fallback' | 'clear_fallback';

export interface PendingChange {
	id: string;
	type: ChangeType;
	customer: string;
	customerName: string;
	feature?: Feature;
	budgetUsd?: number;
	ttlSeconds?: number;
	model?: string;
	summary: string;
	reason: string;
	proposedBy: string;
	proposedAt: string;
	/** Seconds left before this proposal expires unapproved. */
	ttl: number;
}

export interface Snapshot {
	month: string;
	customers: Customer[];
	pending: PendingChange[];
	applyEnabled: boolean;
	keyCount: number;
	loadedAt: number;
}

export interface AuditRow {
	id: number;
	at: string;
	actor: string;
	event: string;
	action_id: string | null;
	customer: string | null;
	summary: string;
}

export const WORKSPACE_ID = 'demo';

// =============================================================================
// AUDIT LOG (Postgres through the db_postgres node)
// =============================================================================

let schemaReady: Promise<void> | null = null;

function ensureAuditSchema(client: RocketRideClient): Promise<void> {
	if (!schemaReady) {
		schemaReady = sql(
			client,
			`CREATE TABLE IF NOT EXISTS mg_audit (
				id BIGSERIAL PRIMARY KEY,
				at TIMESTAMPTZ NOT NULL DEFAULT now(),
				workspace_id TEXT NOT NULL,
				actor TEXT NOT NULL,
				event TEXT NOT NULL,
				action_id TEXT,
				customer TEXT,
				summary TEXT NOT NULL,
				detail TEXT
			)`,
		).then(() => undefined);
		schemaReady.catch(() => {
			schemaReady = null;
		});
	}
	return schemaReady;
}

export async function audit(
	client: RocketRideClient,
	entry: { actor: string; event: string; summary: string; actionId?: string; customer?: string; detail?: unknown },
): Promise<void> {
	await ensureAuditSchema(client);
	await sql(client, 'INSERT INTO mg_audit (workspace_id, actor, event, action_id, customer, summary, detail) VALUES ($1, $2, $3, $4, $5, $6, $7)', [
		WORKSPACE_ID,
		entry.actor,
		entry.event,
		entry.actionId ?? null,
		entry.customer ?? null,
		entry.summary,
		entry.detail === undefined ? null : JSON.stringify(entry.detail),
	]);
}

export async function loadAudit(client: RocketRideClient, limit = 200): Promise<AuditRow[]> {
	await ensureAuditSchema(client);
	return sql<AuditRow>(
		client,
		`SELECT id, to_char(at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS at, actor, event, action_id, customer, summary
		 FROM mg_audit WHERE workspace_id = $1 ORDER BY id DESC LIMIT ${Math.floor(limit)}`,
		[WORKSPACE_ID],
	);
}

// =============================================================================
// SNAPSHOT: scan the namespace, read what matters, compute margins
// =============================================================================

function parseJson<T>(value: string | null): T | null {
	if (!value) return null;
	try {
		return JSON.parse(value) as T;
	} catch {
		return null;
	}
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export async function loadSnapshot(client: RocketRideClient): Promise<Snapshot> {
	const month = currentMonth();
	const all = await redis.scanAll(client);

	// Only read keys that feed the screens: this month's counters plus state.
	const wanted = all.filter((k) => {
		const head = k.split(':', 1)[0];
		if (head === 'usage' || head === 'calls') return k.endsWith(`:${month}`);
		return head === 'budget' || head === 'switch' || head === 'fallback' || head === 'pending' || k === keys.applyEnabled();
	});
	const values = new Map<string, { value: string; ttl: number }>();
	await Promise.all(
		wanted.map(async (k) => {
			const r = await redis.get(client, k);
			if (r.found && r.value !== null) values.set(k, { value: r.value, ttl: r.ttl_seconds });
		}),
	);
	const alertKeys = new Set(all.filter((k) => k.startsWith('alert:')));

	const customers: Customer[] = [];
	for (const [k, entry] of values) {
		if (!k.startsWith('budget:')) continue;
		const id = k.slice('budget:'.length);
		const record = parseJson<{ name: string; plan: string; revenue_usd: number; budget_usd: number }>(entry.value);
		if (!record) continue;

		const features = {} as Record<Feature, FeatureUsage>;
		let costUsd = 0;
		let calls = 0;
		for (const f of FEATURES) {
			const micros = Number(values.get(keys.usage(id, f, month))?.value ?? 0);
			const n = Number(values.get(keys.calls(id, f, month))?.value ?? 0);
			const off = values.get(keys.switchOff(id, f));
			features[f] = { costUsd: micros / 1e6, calls: n, offTtl: off ? off.ttl : null };
			costUsd += micros / 1e6;
			calls += n;
		}
		const fb = values.get(keys.fallback(id));
		customers.push({
			id,
			name: record.name,
			plan: record.plan,
			revenueUsd: record.revenue_usd,
			budgetUsd: record.budget_usd,
			costUsd,
			calls,
			usedPct: record.budget_usd > 0 ? (costUsd / record.budget_usd) * 100 : 0,
			marginPct: record.revenue_usd > 0 ? ((record.revenue_usd - costUsd) / record.revenue_usd) * 100 : 0,
			features,
			fallback: fb ? { model: fb.value, ttl: fb.ttl } : null,
			alerts: ALERT_THRESHOLDS.filter((t) => alertKeys.has(keys.alert(id, month, t))),
		});
	}
	customers.sort((a, b) => a.marginPct - b.marginPct);

	const pending: PendingChange[] = [];
	for (const [k, entry] of values) {
		if (!k.startsWith('pending:')) continue;
		const change = parseJson<Omit<PendingChange, 'ttl'>>(entry.value);
		if (change) pending.push({ ...change, ttl: entry.ttl });
	}
	pending.sort((a, b) => a.proposedAt.localeCompare(b.proposedAt));

	return {
		month,
		customers,
		pending,
		applyEnabled: values.get(keys.applyEnabled())?.value === 'on',
		keyCount: all.length,
		loadedAt: Date.now(),
	};
}

// =============================================================================
// ALERTS: each threshold fires once per customer per month (SET NX)
// =============================================================================

export interface FiredAlert {
	customer: string;
	customerName: string;
	threshold: number;
}

/**
 * Record any budget threshold a customer has crossed and not been alerted
 * for. SET NX makes the marker the single source of truth: if two app
 * sessions refresh at the same moment, only one of them gets stored=true.
 */
export async function fireAlerts(client: RocketRideClient, snapshot: Snapshot): Promise<FiredAlert[]> {
	const fired: FiredAlert[] = [];
	for (const c of snapshot.customers) {
		for (const threshold of ALERT_THRESHOLDS) {
			if (c.usedPct < threshold || c.alerts.includes(threshold)) continue;
			const r = await redis.set(client, keys.alert(c.id, snapshot.month, threshold), new Date().toISOString(), ALERT_TTL, 'NX');
			if (!r.stored) continue;
			c.alerts.push(threshold);
			fired.push({ customer: c.id, customerName: c.name, threshold });
			await audit(client, {
				actor: 'system',
				event: 'alert',
				customer: c.id,
				summary: `${c.name} reached ${threshold}% of its AI budget ($${c.costUsd.toFixed(2)} of $${c.budgetUsd.toFixed(2)})`,
			});
		}
	}
	return fired;
}

// =============================================================================
// ROLLUP: a short-lived cached summary the read-only advisor agent reads
// =============================================================================

let lastRollup = '';
let lastRollupAt = 0;

export async function writeRollup(client: RocketRideClient, snapshot: Snapshot): Promise<void> {
	const body = JSON.stringify({
		month: snapshot.month,
		customers: snapshot.customers.map((c) => ({
			id: c.id,
			name: c.name,
			plan: c.plan,
			revenue_usd: c.revenueUsd,
			budget_usd: c.budgetUsd,
			cost_usd: round2(c.costUsd),
			budget_used_pct: Math.round(c.usedPct),
			margin_pct: Math.round(c.marginPct),
			features: Object.fromEntries(FEATURES.map((f) => [f, { cost_usd: round2(c.features[f].costUsd), calls: c.features[f].calls }])),
			switched_off: FEATURES.filter((f) => c.features[f].offTtl !== null),
			fallback: c.fallback?.model ?? null,
		})),
		pending_changes: snapshot.pending.length,
	});
	const now = Date.now();
	if (body === lastRollup && now - lastRollupAt < 120_000) return;
	await redis.set(client, keys.rollup(), body, ROLLUP_TTL);
	lastRollup = body;
	lastRollupAt = now;
}

// =============================================================================
// PROPOSALS
// =============================================================================

export function describeChange(c: Pick<PendingChange, 'type' | 'customerName' | 'feature' | 'budgetUsd' | 'ttlSeconds' | 'model'>): string {
	switch (c.type) {
		case 'set_budget':
			return `Set ${c.customerName}'s monthly AI budget to $${(c.budgetUsd ?? 0).toFixed(2)}`;
		case 'switch_off':
			return `Switch "${c.feature}" off for ${c.customerName} for ${formatDuration(c.ttlSeconds ?? 0)}`;
		case 'switch_on':
			return `Switch "${c.feature}" back on for ${c.customerName}`;
		case 'set_fallback':
			return `Move ${c.customerName} to the cheaper model (${c.model}) until month end`;
		case 'clear_fallback':
			return `Return ${c.customerName} to the standard model`;
	}
}

export function formatDuration(seconds: number): string {
	if (seconds < 0) return 'no expiry';
	if (seconds < 90) return `${seconds}s`;
	if (seconds < 3570) return `${Math.round(seconds / 60)} min`;
	if (seconds < 2 * 86400) {
		const hours = Math.round(seconds / 360) / 10;
		return hours === 1 ? '1 hour' : `${hours} hours`;
	}
	return `${Math.round(seconds / 86400)} days`;
}

export type ChangeRequest = Pick<PendingChange, 'type' | 'customer' | 'customerName' | 'feature' | 'budgetUsd' | 'ttlSeconds' | 'model' | 'reason'>;

/**
 * Save a proposed change. Nothing is applied. SET NX on a fresh id means a
 * repeated submit can never overwrite or duplicate a proposal, and the TTL
 * means a proposal nobody approves simply disappears.
 */
export async function propose(client: RocketRideClient, actor: string, request: ChangeRequest): Promise<PendingChange> {
	const id = crypto.randomUUID().slice(0, 8);
	const change: Omit<PendingChange, 'ttl'> = {
		...request,
		id,
		summary: describeChange(request),
		proposedBy: actor,
		proposedAt: new Date().toISOString(),
	};
	const r = await redis.set(client, keys.pending(id), JSON.stringify(change), PENDING_TTL, 'NX');
	if (!r.stored) throw new Error('A proposal with this id already exists. Try again.');
	await audit(client, { actor, event: 'proposed', actionId: id, customer: request.customer, summary: change.summary, detail: change });
	return { ...change, ttl: PENDING_TTL };
}

export type ApprovalOutcome = 'applied' | 'dry_run' | 'expired' | 'already_applied';

/**
 * Approve a proposal and apply it exactly once.
 *  1. Re-read the pending key: it may have expired while the page was open.
 *  2. Claim lock:apply:<id> with SET NX. Losing the claim means another
 *     approval already ran, so stop.
 *  3. Apply, log, and remove the pending key.
 */
export async function approve(client: RocketRideClient, actor: string, id: string): Promise<{ outcome: ApprovalOutcome; detail: string }> {
	const current = await redis.get(client, keys.pending(id));
	const change = current.found ? parseJson<Omit<PendingChange, 'ttl'>>(current.value) : null;
	if (!change) {
		// A finished approval deletes the pending key but keeps its lock for an
		// hour, so a lock here means this was applied, not that it expired.
		if ((await redis.get(client, keys.applyLock(id))).found) {
			return { outcome: 'already_applied', detail: 'This change was already approved and applied. It was not applied a second time.' };
		}
		await audit(client, { actor, event: 'expired', actionId: id, summary: `Approval of ${id} arrived after the proposal expired` });
		return { outcome: 'expired', detail: 'This proposal expired before it was approved. Nothing was changed.' };
	}

	const lock = await redis.set(client, keys.applyLock(id), actor, LOCK_TTL, 'NX');
	if (!lock.stored) {
		return { outcome: 'already_applied', detail: 'Someone else already approved this change. It was not applied a second time.' };
	}

	const enabled = (await redis.get(client, keys.applyEnabled())).value === 'on';
	if (!enabled) {
		// Dry run: release the claim so the change can be approved for real later.
		await redis.delete(client, [keys.applyLock(id)]);
		await audit(client, { actor, event: 'dry_run', actionId: id, customer: change.customer, summary: `Dry run, not applied: ${change.summary}` });
		return { outcome: 'dry_run', detail: 'Applying changes is switched off, so this was recorded as a dry run. The proposal is still pending.' };
	}

	let detail: string;
	try {
		detail = await apply(client, change);
	} catch (e) {
		// Release the claim only when Redis says nothing was written. If the
		// outcome is unknown the lock stays, so a person checks before retrying.
		const safe = !(e instanceof RedisToolError) || e.outcome === 'not_applied';
		if (safe) await redis.delete(client, [keys.applyLock(id)]);
		await audit(client, { actor: 'system', event: 'failed', actionId: id, customer: change.customer, summary: `Could not apply: ${change.summary} (${e instanceof Error ? e.message : String(e)})` });
		throw e;
	}
	await audit(client, { actor, event: 'approved', actionId: id, customer: change.customer, summary: change.summary });
	await audit(client, { actor: 'system', event: 'applied', actionId: id, customer: change.customer, summary: detail });
	await redis.delete(client, [keys.pending(id)]);
	return { outcome: 'applied', detail };
}

/** Remove a proposal. Returns false when it had already expired or been handled. */
export async function reject(client: RocketRideClient, actor: string, change: PendingChange): Promise<boolean> {
	const r = await redis.delete(client, [keys.pending(change.id)]);
	if (!r.deleted_count) return false;
	await audit(client, { actor, event: 'rejected', actionId: change.id, customer: change.customer, summary: change.summary });
	return true;
}

/** Write one approved change to Redis and return a sentence saying what happened. */
async function apply(client: RocketRideClient, change: Omit<PendingChange, 'ttl'>): Promise<string> {
	switch (change.type) {
		case 'switch_off': {
			const key = keys.switchOff(change.customer, change.feature!);
			await redis.set(client, key, 'off', change.ttlSeconds ?? 3600);
			const check = await redis.ttl(client, key);
			return `Wrote ${key} = off. Redis will remove it in ${formatDuration(check.ttl_seconds)}, which turns the feature back on.`;
		}
		case 'switch_on': {
			const key = keys.switchOff(change.customer, change.feature!);
			const r = await redis.delete(client, [key]);
			return r.deleted_count ? `Deleted ${key}. The feature is on again.` : `${key} had already expired. The feature is on.`;
		}
		case 'set_budget': {
			const key = keys.budget(change.customer);
			const existing = parseJson<Record<string, unknown>>((await redis.get(client, key)).value);
			if (!existing) throw new Error(`Customer record ${key} no longer exists.`);
			const r = await redis.set(client, key, JSON.stringify({ ...existing, budget_usd: change.budgetUsd }), 0, 'XX');
			if (!r.stored) throw new Error(`Customer record ${key} disappeared before it could be updated.`);
			return `Updated ${key}: budget is now $${(change.budgetUsd ?? 0).toFixed(2)} a month (no expiry).`;
		}
		case 'set_fallback': {
			const key = keys.fallback(change.customer);
			await redis.set(client, key, change.model ?? FALLBACK_MODEL, secondsToMonthEnd());
			const check = await redis.ttl(client, key);
			return `Wrote ${key} = ${change.model ?? FALLBACK_MODEL}. It expires at month end, in ${formatDuration(check.ttl_seconds)}.`;
		}
		case 'clear_fallback': {
			const key = keys.fallback(change.customer);
			await redis.delete(client, [key]);
			return `Deleted ${key}. The standard model is back in use.`;
		}
	}
}

/** Give a pending proposal or an active switch more time (EXPIRE). */
export async function extend(client: RocketRideClient, actor: string, key: string, seconds: number, summary: string): Promise<boolean> {
	const r = await redis.expire(client, key, seconds);
	if (r.updated) await audit(client, { actor, event: 'extended', summary });
	return r.updated;
}

export async function setApplyEnabled(client: RocketRideClient, actor: string, enabled: boolean): Promise<void> {
	if (enabled) await redis.set(client, keys.applyEnabled(), 'on', 0);
	else await redis.delete(client, [keys.applyEnabled()]);
	await audit(client, { actor, event: 'setting', summary: enabled ? 'Applying approved changes switched ON' : 'Applying approved changes switched OFF (dry run)' });
}

// =============================================================================
// DEMO DATA AND TEST TRAFFIC
// =============================================================================

interface SeedCustomer {
	id: string;
	name: string;
	plan: string;
	revenue: number;
	budget: number;
	/** Share of budget already used this month, split across features. */
	used: number;
	mix: Record<Feature, number>;
}

export const SEED_CUSTOMERS: SeedCustomer[] = [
	{ id: 'acme', name: 'Acme Robotics', plan: 'Enterprise', revenue: 2400, budget: 600, used: 0.34, mix: { summarize: 0.5, chat: 0.35, search: 0.15 } },
	{ id: 'umbrella', name: 'Umbrella Health', plan: 'Enterprise', revenue: 2400, budget: 600, used: 0.12, mix: { summarize: 0.3, chat: 0.5, search: 0.2 } },
	{ id: 'northwind', name: 'Northwind Traders', plan: 'Growth', revenue: 499, budget: 150, used: 0.62, mix: { summarize: 0.6, chat: 0.3, search: 0.1 } },
	{ id: 'globex', name: 'Globex', plan: 'Growth', revenue: 499, budget: 150, used: 0.21, mix: { summarize: 0.2, chat: 0.6, search: 0.2 } },
	{ id: 'initech', name: 'Initech', plan: 'Starter', revenue: 99, budget: 40, used: 0.86, mix: { summarize: 0.45, chat: 0.45, search: 0.1 } },
	{ id: 'hooli', name: 'Hooli', plan: 'Starter', revenue: 99, budget: 40, used: 0.42, mix: { summarize: 0.7, chat: 0.2, search: 0.1 } },
];

/** Wipe the namespace and load six sample customers with month-to-date usage. */
export async function resetDemo(client: RocketRideClient, actor: string): Promise<number> {
	const removed = await redis.deleteMany(client, await redis.scanAll(client));
	const month = currentMonth();
	for (const c of SEED_CUSTOMERS) {
		await redis.set(client, keys.budget(c.id), JSON.stringify({ name: c.name, plan: c.plan, revenue_usd: c.revenue, budget_usd: c.budget }), 0);
		await Promise.all(
			FEATURES.map(async (f) => {
				const micros = Math.round(c.budget * c.used * c.mix[f] * 1e6);
				const calls = Math.round(micros / UNIT_COST_MICROS[f]);
				await redis.incr(client, keys.usage(c.id, f, month), micros);
				await redis.incr(client, keys.calls(c.id, f, month), calls);
				// INCR never sets an expiry, so month counters get one explicitly.
				await redis.expire(client, keys.usage(c.id, f, month), COUNTER_TTL);
				await redis.expire(client, keys.calls(c.id, f, month), COUNTER_TTL);
			}),
		);
	}
	await redis.set(client, keys.applyEnabled(), 'on', 0);
	lastRollup = '';
	await audit(client, { actor, event: 'demo_reset', summary: `Demo data reloaded: removed ${removed} keys, seeded ${SEED_CUSTOMERS.length} customers` });
	return removed;
}

export interface TrafficResult {
	sent: number;
	blocked: boolean;
	costUsd: number;
	model: string;
}

/**
 * Act as the customer's backend for one batch of AI calls: obey the off
 * switch and the fallback model, then count calls and cost with INCR.
 */
export async function sendTraffic(client: RocketRideClient, customer: string, feature: Feature, callCount: number): Promise<TrafficResult> {
	const month = currentMonth();
	const [off, fb] = await Promise.all([redis.get(client, keys.switchOff(customer, feature)), redis.get(client, keys.fallback(customer))]);
	if (off.found) return { sent: 0, blocked: true, costUsd: 0, model: '' };

	const unit = Math.round(UNIT_COST_MICROS[feature] * (fb.found ? FALLBACK_COST_FACTOR : 1));
	const micros = unit * callCount;
	const [usage] = await Promise.all([redis.incr(client, keys.usage(customer, feature, month), micros), redis.incr(client, keys.calls(customer, feature, month), callCount)]);
	if (usage.value_decimal === String(micros)) {
		// First write of the month created the counters: give them an expiry.
		await Promise.all([redis.expire(client, keys.usage(customer, feature, month), COUNTER_TTL), redis.expire(client, keys.calls(customer, feature, month), COUNTER_TTL)]);
	}
	return { sent: callCount, blocked: false, costUsd: micros / 1e6, model: fb.found ? (fb.value ?? FALLBACK_MODEL) : 'standard' };
}
