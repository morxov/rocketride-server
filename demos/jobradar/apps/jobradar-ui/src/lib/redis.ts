/**
 * Pipeline sessions and typed tool calls.
 *
 * jobradar-tools.pipe hosts three tool_redis nodes, each locked to its own
 * namespace, plus tool_firecrawl:
 *   redis_jobs  jobradar:jobs:       first-seen index shards, description cache, daily counters, refresh lock
 *   redis_user  jobradar:u:alex:     profile, prefs, tracker, reminders, digest, fit cache, assistant notes
 *   redis_seen  jobradar:seen:alex:  one key per job the user has seen or hidden (expires on its own)
 * Separate namespaces keep SCAN cheap: scanning the seen marks never walks the job index.
 */

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

// =============================================================================
// CONCURRENCY GATE (each Redis node's pool fails instead of waiting when full)
// =============================================================================

const MAX_PARALLEL = 6;
let active = 0;
const waiting: Array<() => void> = [];

async function gated<T>(fn: () => Promise<T>): Promise<T> {
	if (active >= MAX_PARALLEL) await new Promise<void>((resolve) => waiting.push(resolve));
	active++;
	try {
		return await fn();
	} finally {
		active--;
		waiting.shift()?.();
	}
}

/** Run fn over items with the gate, preserving order. */
export async function mapGated<T, R>(items: T[], fn: (item: T) => Promise<R>): Promise<R[]> {
	return Promise.all(items.map((item) => fn(item)));
}

// =============================================================================
// REDIS
// =============================================================================

export type RedisNode = 'redis_jobs' | 'redis_user' | 'redis_seen';

export class RedisToolError extends Error {
	constructor(
		message: string,
		readonly code: string,
		readonly outcome: string,
	) {
		super(message);
	}
}

interface Envelope {
	success: boolean;
	error?: string;
	error_code?: string;
	outcome?: string;
}

async function call<T>(client: RocketRideClient, node: string, tool: string, input: Record<string, unknown>, timeout = 15000): Promise<T> {
	const token = await pipelineToken(client, toolsPipe, 'JobRadar tools');
	let result: Envelope;
	try {
		result = await gated(() => client.tool<Envelope>({ token, tool, nodeId: node, input, timeout }));
	} catch (e) {
		// The task may have idled out; re-attach next time. Never retried here:
		// a write whose outcome is unknown must not be repeated blindly.
		dropToken(client, toolsPipe);
		throw e;
	}
	if (!result || result.success !== true) {
		throw new RedisToolError(result?.error ?? `${tool} failed`, result?.error_code ?? 'unknown', result?.outcome ?? 'unknown');
	}
	return result as unknown as T;
}

export interface GetResult { key: string; found: boolean; value: string | null; ttl_seconds: number }
export interface SetResult { key: string; stored: boolean }
export interface ScanResult { cursor: string; keys: string[]; done: boolean }

export function redis(client: RocketRideClient, node: RedisNode) {
	const r = {
		get: (key: string) => call<GetResult>(client, node, 'redis_get', { key }),
		/** ttl 0 = no expiry. NX = only if absent (locks, first-seen marks); XX = only if present. */
		set: (key: string, value: string, ttl: number, condition?: 'NX' | 'XX') =>
			call<SetResult>(client, node, 'redis_set', condition ? { key, value, ttl_seconds: ttl, condition } : { key, value, ttl_seconds: ttl }),
		ttl: (key: string) => call<{ exists: boolean; ttl_seconds: number }>(client, node, 'redis_ttl', { key }),
		expire: (key: string, ttl: number) => call<{ updated: boolean }>(client, node, 'redis_expire', { key, ttl_seconds: ttl }),
		incr: (key: string, amount: number | string = 1) => call<{ value_decimal: string }>(client, node, 'redis_incr', { key, amount: String(amount) }),
		delete: (keys: string[]) => call<{ deleted_count: number }>(client, node, 'redis_delete', { keys }),

		/** Every key in this node's namespace. Pages may be empty or repeat keys. */
		async scanAll(): Promise<string[]> {
			const found = new Set<string>();
			let cursor = '0';
			for (let page = 0; page < 400; page++) {
				const res = await call<ScanResult>(client, node, 'redis_scan', { cursor, count: 500 });
				res.keys.forEach((k) => found.add(k));
				if (res.done) break;
				cursor = res.cursor;
			}
			return [...found];
		},

		async getJson<T>(key: string): Promise<T | null> {
			const res = await r.get(key);
			if (!res.found || !res.value) return null;
			try {
				return JSON.parse(res.value) as T;
			} catch {
				return null;
			}
		},

		setJson: (key: string, value: unknown, ttl: number, condition?: 'NX' | 'XX') => r.set(key, JSON.stringify(value), ttl, condition),

		async deleteMany(keys: string[]): Promise<number> {
			let n = 0;
			for (let i = 0; i < keys.length; i += 100) n += (await r.delete(keys.slice(i, i + 100))).deleted_count;
			return n;
		},
	};
	return r;
}

// =============================================================================
// FIRECRAWL
// =============================================================================

export async function scrapePage(client: RocketRideClient, url: string): Promise<string> {
	const res = await call<{ content?: string }>(client, 'firecrawl_1', 'scrape_url', { url, format: 'markdown' }, 60000);
	return String(res.content ?? '');
}
