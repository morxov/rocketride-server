/**
 * Pipeline sessions and typed access to the tools pipeline.
 *
 * guard-tools.pipe is a Tools source hosting tool_redis (writes on) and
 * db_postgres (audit log). It is started once per client and reused; every
 * call below is a direct client.tool() / client.database.query() invocation,
 * so results are deterministic and no LLM is involved.
 */

import type { PipelineConfig, RocketRideClient } from 'rocketride';
import guardTools from '../pipelines/guard-tools.pipe';

export const REDIS_NODE = 'redis_1';
export const AUDIT_NODE = 'db_postgres_1';

// ---------------------------------------------------------------------------
// Token cache: one running task per (client, pipeline)
// ---------------------------------------------------------------------------

const tokens = new WeakMap<RocketRideClient, Map<string, Promise<string>>>();

/** Start (or attach to) a pipeline once and return its task token. */
export function pipelineToken(client: RocketRideClient, pipeline: Record<string, unknown>, name: string): Promise<string> {
	let perClient = tokens.get(client);
	if (!perClient) {
		perClient = new Map();
		tokens.set(client, perClient);
	}
	const id = String(pipeline.project_id);
	let pending = perClient.get(id);
	if (!pending) {
		pending = client
			.use({ pipeline: pipeline as unknown as PipelineConfig, useExisting: true, name, ttl: 900 })
			.then((r) => r.token);
		pending.catch(() => perClient!.delete(id));
		perClient.set(id, pending);
	}
	return pending;
}

/** Forget a pipeline's token so the next call starts or re-attaches it. */
export function dropToken(client: RocketRideClient, pipeline: Record<string, unknown>): void {
	tokens.get(client)?.delete(String(pipeline.project_id));
}

const toolsToken = (client: RocketRideClient) => pipelineToken(client, guardTools, 'Margin Guard tools');

// ---------------------------------------------------------------------------
// Concurrency gate: the Redis node's pool holds 10 connections and FAILS
// rather than waits when it is exhausted, so never run more than 6 at once.
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Redis tools
// ---------------------------------------------------------------------------

export class RedisToolError extends Error {
	constructor(
		message: string,
		readonly code: string,
		readonly outcome: string,
	) {
		super(message);
	}
}

interface ToolEnvelope {
	success: boolean;
	error?: string;
	error_code?: string;
	outcome?: string;
}

async function redisCall<T>(client: RocketRideClient, tool: string, input: Record<string, unknown>): Promise<T> {
	const token = await toolsToken(client);
	let result: ToolEnvelope;
	try {
		result = await gated(() => client.tool<ToolEnvelope>({ token, tool: `redis_${tool}`, nodeId: REDIS_NODE, input, timeout: 15000 }));
	} catch (e) {
		// The task may have idled out; re-attach on the next call. Never
		// retried here: a write whose outcome is unknown must not be repeated.
		dropToken(client, guardTools);
		throw e;
	}
	if (!result || result.success !== true) {
		throw new RedisToolError(result?.error ?? `redis_${tool} failed`, result?.error_code ?? 'unknown', result?.outcome ?? 'unknown');
	}
	return result as unknown as T;
}

export interface GetResult { key: string; found: boolean; value: string | null; ttl_seconds: number }
export interface SetResult { key: string; stored: boolean; requested_ttl_seconds: number }
export interface TtlResult { key: string; exists: boolean; has_expiry: boolean; ttl_seconds: number }
export interface ExpireResult { key: string; updated: boolean }
export interface IncrResult { key: string; value_decimal: string }
export interface ScanResult { cursor: string; keys: string[]; skipped: number; done: boolean }
export interface DeleteResult { deleted_count: number }

/** The seven tool_redis operations, one method each. */
export const redis = {
	get: (c: RocketRideClient, key: string) => redisCall<GetResult>(c, 'get', { key }),
	/** ttlSeconds 0 = persistent. condition NX = only if absent (a lock), XX = only if present. */
	set: (c: RocketRideClient, key: string, value: string, ttlSeconds: number, condition?: 'NX' | 'XX') =>
		redisCall<SetResult>(c, 'set', condition ? { key, value, ttl_seconds: ttlSeconds, condition } : { key, value, ttl_seconds: ttlSeconds }),
	ttl: (c: RocketRideClient, key: string) => redisCall<TtlResult>(c, 'ttl', { key }),
	expire: (c: RocketRideClient, key: string, ttlSeconds: number) => redisCall<ExpireResult>(c, 'expire', { key, ttl_seconds: ttlSeconds }),
	/** amount is a decimal string so 64-bit counters survive JavaScript numbers. */
	incr: (c: RocketRideClient, key: string, amount: number | string = 1) => redisCall<IncrResult>(c, 'incr', { key, amount: String(amount) }),
	scanPage: (c: RocketRideClient, cursor: string, count = 500) => redisCall<ScanResult>(c, 'scan', { cursor, count }),
	delete: (c: RocketRideClient, keyList: string[]) => redisCall<DeleteResult>(c, 'delete', { keys: keyList }),

	/**
	 * Every logical key in the namespace. SCAN pages can be empty or repeat a
	 * key, so loop until the node reports done and de-duplicate.
	 */
	async scanAll(c: RocketRideClient): Promise<string[]> {
		const found = new Set<string>();
		let cursor = '0';
		for (let page = 0; page < 200; page++) {
			const r = await redis.scanPage(c, cursor);
			r.keys.forEach((k) => found.add(k));
			if (r.done) break;
			cursor = r.cursor;
		}
		return [...found];
	},

	/** Delete any number of keys, 100 per call (the node's cap). */
	async deleteMany(c: RocketRideClient, keyList: string[]): Promise<number> {
		let deleted = 0;
		for (let i = 0; i < keyList.length; i += 100) {
			deleted += (await redis.delete(c, keyList.slice(i, i + 100))).deleted_count;
		}
		return deleted;
	},
};

// ---------------------------------------------------------------------------
// Audit database (raw SQL through the db_postgres node's execute tool)
// ---------------------------------------------------------------------------

export async function sql<T = Record<string, unknown>>(client: RocketRideClient, statement: string, params?: unknown[]): Promise<T[]> {
	const token = await toolsToken(client);
	try {
		const result = await gated(() => client.database.query({ token, nodeId: AUDIT_NODE, sql: statement, params }));
		return result.rows as T[];
	} catch (e) {
		dropToken(client, guardTools);
		throw e;
	}
}
