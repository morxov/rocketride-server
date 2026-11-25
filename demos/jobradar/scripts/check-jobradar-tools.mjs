// Smoke test: node --env-file=.env scripts/check-jobradar-tools.mjs
import { readFileSync } from 'node:fs';
import { RocketRideClient } from 'rocketride';
const pipeline = JSON.parse(readFileSync('apps/jobradar-ui/src/pipelines/jobradar-tools.pipe', 'utf8'));
const client = new RocketRideClient();
try {
	await client.connect();
	const validation = await client.validate({ pipeline });
	console.log('validation', JSON.stringify({ errors: validation.errors, warnings: validation.warnings }));
	if (validation.errors?.length) throw Error('Tools pipeline validation failed');
	const { token } = await client.use({ pipeline, useExisting: true, ttl: 600 });
	const result = await client.tool({ token, nodeId: 'firecrawl_1', tool: 'scrape_url', input: { url: 'https://example.com', format: 'markdown' }, timeout: 60000 });
	if (result.success === false || !result.content) throw Error(result.error || 'No page content returned');
	console.log('Firecrawl passed, content length:', result.content.length);
} finally { await client.disconnect(); }
process.exit();
