import type { PipelineConfig, RocketRideClient } from 'rocketride';
import toolsPipe from '../pipelines/jobradar-tools.pipe';

// =============================================================================
// PIPELINE TOKENS
// =============================================================================

const tokens = new WeakMap<RocketRideClient, Map<string, Promise<string>>>();

/** Start (or attach to) a pipeline once per client and reuse its token. */
export function pipelineToken(client: RocketRideClient, pipeline: Record<string, unknown>, name: string): Promise<string> {
	let perClient = tokens.get(client);
	if (!perClient) {
		perClient = new Map();
		tokens.set(client, perClient);
	}
	const id = String(pipeline.project_id);
	let pending = perClient.get(id);
	if (!pending) {
		pending = client.use({ pipeline: pipeline as unknown as PipelineConfig, useExisting: true, name, ttl: 1800 }).then((r) => r.token);
		pending.catch(() => perClient!.delete(id));
		perClient.set(id, pending);
	}
	return pending;
}

export function dropToken(client: RocketRideClient, pipeline: Record<string, unknown>): void {
	tokens.get(client)?.delete(String(pipeline.project_id));
}

/** Run tool reads with bounded concurrency. */
export async function mapGated<T, R>(items: T[], fn: (item: T) => Promise<R>): Promise<R[]> {
	const out = new Array<R>(items.length);
	let index = 0;
	await Promise.all(
		Array.from({ length: Math.min(6, items.length) }, async () => {
			while (index < items.length) {
				const i = index++;
				out[i] = await fn(items[i]);
			}
		})
	);
	return out;
}

export async function scrapePage(client: RocketRideClient, url: string): Promise<string> {
	const token = await pipelineToken(client, toolsPipe, 'JobRadar web tools');
	try {
		const res = await client.tool<{ content?: string; success?: boolean; error?: string }>({ token, nodeId: 'firecrawl_1', tool: 'scrape_url', input: { url, format: 'markdown' }, timeout: 60000 });
		if (res.success === false) throw new Error(res.error || 'Could not read the posting.');
		return String(res.content ?? '');
	} catch (e) {
		dropToken(client, toolsPipe);
		throw e;
	}
}
