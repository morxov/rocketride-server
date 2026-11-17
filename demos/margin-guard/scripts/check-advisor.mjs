// Smoke test for advisor.pipe:  node --env-file=.env scripts/check-advisor.mjs "question"
import { readFileSync } from 'node:fs';
import { RocketRideClient, Question } from 'rocketride';
const pipeline = JSON.parse(readFileSync('apps/margin-guard/src/pipelines/advisor.pipe', 'utf8'));
const client = new RocketRideClient();
await client.connect();
// Restart so edits to the .pipe take effect (useExisting would attach to the old run).
const old = await client.use({ pipeline, useExisting: true });
await client.terminate(old.token);
const { token } = await client.use({ pipeline });
const q = new Question();
q.addQuestion(process.argv[2] ?? 'Which customer has the worst margin this month, and what is driving it?');
const t = Date.now();
const res = await client.chat({
	token,
	question: q,
	onSSE: async (type, data) =>
		console.log(`  +${((Date.now() - t) / 1000).toFixed(1)}s`, type, JSON.stringify(data).slice(0, 110)),
});
console.log(`${((Date.now() - t) / 1000).toFixed(1)}s`);
console.log(JSON.stringify(res.answers ?? res, null, 1).slice(0, 3000));
// The node itself refuses writes on this connection, whatever the agent tries.
const refused = await client
	.tool({
		token,
		tool: 'redis_set',
		nodeId: 'redis_readonly_1',
		input: { key: 'should-not-exist', value: 'x', ttl_seconds: 60 },
	})
	.catch((e) => ({ thrown: String(e.message ?? e) }));
console.log('direct write on read-only node ->', JSON.stringify(refused));
await client.disconnect();
process.exit(0);
