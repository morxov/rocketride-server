// Smoke test for explain.pipe:  node --env-file=.env scripts/check-explain.mjs
import { readFileSync } from 'node:fs';
import { RocketRideClient, Question } from 'rocketride';
const pipeline = JSON.parse(readFileSync('apps/margin-guard/src/pipelines/explain.pipe', 'utf8'));
const client = new RocketRideClient();
await client.connect();
const old = await client.use({ pipeline, useExisting: true });
await client.terminate(old.token); // restart so .pipe edits take effect
const { token } = await client.use({ pipeline });
const q = new Question();
q.addQuestion(
	JSON.stringify({
		customer: 'Hooli',
		plan: 'Starter',
		month: '2026-11',
		revenue_usd: 99,
		budget_usd: 30,
		cost_usd: 41.2,
		features: {
			summarize: { cost_usd: 33.1, calls: 2758 },
			chat: { cost_usd: 6.4, calls: 533 },
			search: { cost_usd: 1.7, calls: 141 },
		},
		switches: [],
		fallback: null,
	})
);
const res = await client.chat({ token, question: q });
console.log(JSON.stringify(res, null, 1).slice(0, 2500));
await client.disconnect();
process.exit(0);
