/**
 * Redis key layout for AI Margin Guard. Every key is a LOGICAL name: the
 * tool_redis node prepends its configured namespace (`rr:margin-guard:`).
 * The customer's backend (see simulator/) writes the same keys directly.
 */

export const NAMESPACE = 'rr:margin-guard:';
export const FEATURES = ['summarize', 'chat', 'search'] as const;
export type Feature = (typeof FEATURES)[number];

/** Cost of one AI call per feature, in micro-dollars (the counters are integers). */
export const UNIT_COST_MICROS: Record<Feature, number> = { summarize: 12000, chat: 4000, search: 1500 };
/** A fallback model costs this fraction of the normal model. */
export const FALLBACK_COST_FACTOR = 0.15;
export const FALLBACK_MODEL = 'gemini-flash-lite';

export const ALERT_THRESHOLDS = [50, 80, 100] as const;

export const DAY = 86400;
export const COUNTER_TTL = 100 * DAY; // month counters clean themselves up
export const ALERT_TTL = 40 * DAY;
export const PENDING_TTL = 3600; // an unapproved proposal expires after an hour
export const LOCK_TTL = 3600;
export const ROLLUP_TTL = 300;

/** Current month as YYYY-MM (UTC), the suffix of every usage counter. */
export function currentMonth(now = new Date()): string {
	return now.toISOString().slice(0, 7);
}

/** Seconds from now until the first instant of next month (UTC). */
export function secondsToMonthEnd(now = new Date()): number {
	const next = Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1);
	return Math.max(60, Math.floor((next - now.getTime()) / 1000));
}

export const keys = {
	budget: (customer: string) => `budget:${customer}`,
	usage: (customer: string, feature: string, month: string) => `usage:${customer}:${feature}:${month}`,
	calls: (customer: string, feature: string, month: string) => `calls:${customer}:${feature}:${month}`,
	switchOff: (customer: string, feature: string) => `switch:${customer}:${feature}`,
	fallback: (customer: string) => `fallback:${customer}`,
	alert: (customer: string, month: string, threshold: number) => `alert:${customer}:${month}:${threshold}`,
	pending: (id: string) => `pending:${id}`,
	applyLock: (id: string) => `lock:apply:${id}`,
	rollup: () => 'rollup:current',
	applyEnabled: () => 'config:apply_enabled',
};
