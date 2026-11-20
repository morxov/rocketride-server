// Smoke test for jobradar-tools.pipe:  node --env-file=.env scripts/check-jobradar-tools.mjs
import { readFileSync } from 'node:fs';
// `rocketride` is the workspace's vendored client, installed by `rocketride init` (see ../README.md).
// eslint-disable-next-line n/no-missing-import
import { RocketRideClient } from 'rocketride';
const pipeline = JSON.parse(readFileSync('apps/jobradar-ui/src/pipelines/jobradar-tools.pipe', 'utf8'));
const client = new RocketRideClient();
await client.connect();
const old = await client.use({ pipeline, useExisting: true });
await client.terminate(old.token);
const { token } = await client.use({ pipeline });
const setInput = { key: 'selftest', value: 'ok', ttl_seconds: 30 };
const setResult = await client.tool({ token, tool: 'redis_set', nodeId: 'redis_jobs', input: setInput });
console.log('redis', JSON.stringify(setResult));
for (const tool of ['scrape_url']) {
	try {
		const input = { url: 'https://example.com', format: 'markdown' };
		const r = await client.tool({ token, tool, nodeId: 'firecrawl_1', input, timeout: 60000 });
		console.log(tool, 'OK', JSON.stringify(r).slice(0, 300));
	} catch (e) { console.log(tool, 'ERR', String(e.message ?? e).slice(0, 300)); }
}
await client.disconnect(); process.exit(0);
