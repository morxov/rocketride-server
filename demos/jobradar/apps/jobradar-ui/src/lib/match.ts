/**
 * Transparent match scoring and freshness checks. Plain rules, same answer
 * every time, and every point comes with a reason the user can read.
 */

import type { Job, Level, WatchedCompany } from './sources';

// =============================================================================
// TYPES
// =============================================================================

export interface Profile {
	name: string;
	headline: string;
	level: Level;
	graduation: string;
	target_roles: string[];
	skills: string[];
	locations: string[];
	evidence: string[];
}

export interface Prefs {
	levels: Level[];
	roles: string[];
	locations: string[];
	remoteOk: boolean;
	needsSponsorship: boolean;
	minScore: number;
	maxAgeDays: number;
	watched: WatchedCompany[];
	excludeCompanies: string[];
}

export type Flag = 'new' | 'fresh' | 'reposted' | 'stale' | 'no_sponsorship' | 'multi_source';

export interface ScoredJob extends Job {
	score: number;
	reasons: string[];
	warnings: string[];
	flags: Flag[];
	/** When JobRadar first saw this role (epoch seconds). */
	firstSeen: number;
}

export const DEFAULT_PREFS: Prefs = {
	levels: ['intern'],
	roles: ['software engineer'],
	locations: [],
	remoteOk: true,
	needsSponsorship: false,
	minScore: 45,
	maxAgeDays: 30,
	watched: [],
	excludeCompanies: [],
};

export function prefsFromProfile(p: Profile, base: Prefs = DEFAULT_PREFS): Prefs {
	return {
		...base,
		levels: [p.level],
		roles: p.target_roles.length ? p.target_roles.slice(0, 5) : base.roles,
		locations: p.locations.filter((l) => !/remote/i.test(l)).slice(0, 5),
		remoteOk: true,
	};
}

// =============================================================================
// SCORING
// =============================================================================

const STOP = new Set(['and', 'or', 'the', 'of', 'for', 'a', 'an', 'to', 'in', 'with', 'role']);
const stem = (w: string) => w.slice(0, 5);
const words = (s: string) => s.toLowerCase().replace(/[^a-z0-9+#]+/g, ' ').split(' ').filter((w) => w && !STOP.has(w));

/** Domain hints from Simplify's categories, used when the title alone is vague. */
const CATEGORY_HINTS: Record<string, RegExp> = {
	'AI/ML/Data': /\b(machine learning|ml|ai|data|research|scien)/i,
	Software: /\b(software|backend|frontend|full ?stack|developer|engineer|web|mobile|platform|infra)/i,
	Hardware: /\b(hardware|electrical|embedded|firmware|asic|fpga|robot|mechanical)/i,
	Product: /\b(product|pm|design|ux)/i,
	Quant: /\b(quant|trading|financ)/i,
};

const BLOCKS_SPONSORSHIP = /citizenship is required|does not offer sponsorship|no sponsorship/i;
const DAY = 86400;

export function ago(epochSeconds: number, now = Date.now() / 1000): string {
	const d = Math.max(0, now - epochSeconds);
	if (d < 3600) return `${Math.max(1, Math.round(d / 60))} min ago`;
	if (d < DAY) return `${Math.round(d / 3600)} h ago`;
	if (d < 2 * DAY) return 'yesterday';
	if (d < 60 * DAY) return `${Math.round(d / DAY)} days ago`;
	return `${Math.round(d / (30 * DAY))} months ago`;
}

export function scoreJob(job: Job & { firstSeen: number }, profile: Profile | null, prefs: Prefs, isNew: boolean, now = Date.now() / 1000): ScoredJob {
	const reasons: string[] = [];
	const warnings: string[] = [];
	const flags: Flag[] = [];
	const title = job.title.toLowerCase();
	const titleStems = new Set(words(job.title).map(stem));
	let score = 0;

	// Role fit: share of a target role's words found in the title (55 points).
	let bestRole = '';
	let bestFrac = 0;
	for (const role of prefs.roles) {
		const rw = words(role).map(stem);
		if (!rw.length) continue;
		const frac = rw.filter((w) => titleStems.has(w)).length / rw.length;
		if (frac > bestFrac) {
			bestFrac = frac;
			bestRole = role;
		}
	}
	if (bestFrac > 0) {
		score += Math.round(55 * bestFrac);
		reasons.push(bestFrac === 1 ? `Title matches "${bestRole}"` : `Title partly matches "${bestRole}"`);
	} else if (job.category && prefs.roles.some((r) => CATEGORY_HINTS[job.category!]?.test(r))) {
		score += 25;
		reasons.push(`${job.category} role, in your area`);
	}

	// Skills named in the title, category or description (10 points; most list feeds have no description).
	if (profile?.skills.length) {
		const hay = `${title} ${job.category ?? ''} ${(job.description ?? '').slice(0, 6000).toLowerCase()}`;
		const hits = profile.skills.filter((s) => {
			const k = s.toLowerCase().replace(/\s*\(.*\)/, '').trim();
			return k.length > 1 && new RegExp(`(^|[^a-z0-9])${k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z0-9]|$)`).test(hay);
		});
		if (hits.length) {
			score += Math.min(10, hits.length * 3);
			reasons.push(`Mentions ${hits.slice(0, 4).join(', ')}`);
		}
	}

	// Location (20 points).
	const locText = job.locations.join(' | ').toLowerCase();
	if (!prefs.locations.length) {
		score += 15;
	} else {
		const hit = prefs.locations.find((l) => {
			const city = l.split(',')[0].trim().toLowerCase();
			return city.length > 1 && locText.includes(city);
		});
		if (hit) {
			score += 20;
			reasons.push(`In ${hit.split(',')[0]}`);
		} else if (job.remote && prefs.remoteOk) {
			score += 20;
			reasons.push('Remote');
		} else if (job.locations.length) {
			warnings.push(`Not in your locations (${job.locations.slice(0, 2).join(', ')}${job.locations.length > 2 ? '...' : ''})`);
		}
	}

	// Freshness (15 points): applying early matters.
	const age = now - job.posted;
	if (age < 2 * DAY) {
		score += 15;
		flags.push('fresh');
		reasons.push(`Posted ${ago(job.posted, now)}`);
	} else if (age < 7 * DAY) {
		score += 10;
	} else if (age < 14 * DAY) {
		score += 5;
	}

	// Ghost and repost checks.
	if (job.postCount >= 2) {
		flags.push('reposted');
		warnings.push(`Posted ${job.postCount} times since ${new Date(job.firstPosted * 1000).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`);
	}
	const openFor = now - job.firstPosted;
	if ((job.postCount >= 3 && openFor > 30 * DAY) || openFor > 75 * DAY) {
		flags.push('stale');
		score -= 10;
		warnings.push(`Likely stale: first posted ${ago(job.firstPosted, now)}`);
	}

	// Sponsorship.
	if (job.sponsorship && BLOCKS_SPONSORSHIP.test(job.sponsorship)) {
		flags.push('no_sponsorship');
		if (prefs.needsSponsorship) {
			// A hard blocker, not a penalty: you cannot take this job, so it never reaches New.
			score = -1000;
			warnings.push(`${job.sponsorship}: hidden because you need sponsorship`);
		}
	}

	if (job.sources.length > 1) flags.push('multi_source');
	if (isNew) flags.push('new');

	return { ...job, score: Math.max(0, Math.min(100, score)), reasons, warnings, flags };
}

export function passesFilters(job: Job, prefs: Prefs): boolean {
	if (!prefs.levels.includes(job.level)) return false;
	const company = job.company.toLowerCase();
	if (prefs.excludeCompanies.some((c) => c && company.includes(c.toLowerCase()))) return false;
	return true;
}
