/**
 * Everything JobRadar keeps in Redis, and the refresh cycle.
 *
 * Key layout (namespaces come from the three tool_redis nodes):
 *   jobradar:jobs:idx:{0..31}          JSON {fp: {f: first seen, l: last seen}} — shard of the first-seen index
 *   jobradar:jobs:meta:initialized     set once, so the first run back-dates first-seen to the posting date
 *   jobradar:jobs:lock:refresh         SET NX lock, 120 s, so two tabs never write the index at once
 *   jobradar:jobs:desc:{fp}            job description cache, 7 days (spares Firecrawl credits)
 *   jobradar:jobs:stat:{date}:{metric} daily counters (INCR), 35 days
 *   jobradar:u:alex:profile | resume | prefs | state | digest
 *   jobradar:u:alex:app:{fp}           tracker record
 *   jobradar:u:alex:remind:{fp}        follow-up reminder, expires 14 days after it is due
 *   jobradar:u:alex:fit:{fp}           cached "explain fit", 7 days
 *   jobradar:u:alex:stat:applied:{wk}  applications per ISO week (INCR)
 *   jobradar:u:alex:notes:*            notes and reminders the assistant saved
 *   jobradar:seen:alex:s:{fp} | h:{fp} seen (45 days) / hidden (90 days) marks
 */

import type { RocketRideClient } from 'rocketride';
import { DEFAULT_PREFS, passesFilters, scoreJob, type Prefs, type Profile, type ScoredJob } from './match';
import { redis } from './redis';
import { fetchJobs, isOnBoard, postingKey, type FetchReport, type Job } from './sources';

const DAY = 86400;
const SHARDS = 32;
const SEEN_TTL = 45 * DAY;
const HIDDEN_TTL = 90 * DAY;
const DESC_TTL = 7 * DAY;
const FIT_TTL = 7 * DAY;
const STAT_TTL = 35 * DAY;
const INDEX_KEEP = 60 * DAY;

const nowSec = () => Math.floor(Date.now() / 1000);
/** Local calendar date as YYYY-MM-DD (reminders and "today" follow the user's clock, not UTC). */
export const localDate = (d: Date = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const today = () => localDate();
const shardOf = (fp: string) => parseInt(fp.slice(-4), 36) % SHARDS;

export function isoWeek(d = new Date()): string {
	const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
	const day = t.getUTCDay() || 7;
	t.setUTCDate(t.getUTCDate() + 4 - day);
	const year = t.getUTCFullYear();
	const week = Math.ceil(((t.getTime() - Date.UTC(year, 0, 1)) / DAY / 1000 + 1) / 7);
	return `${year}-w${String(week).padStart(2, '0')}`;
}

// =============================================================================
// TYPES
// =============================================================================

export type Status = 'saved' | 'applied' | 'assessment' | 'interview' | 'offer' | 'closed';

export const STATUSES: { id: Status; label: string }[] = [
	{ id: 'saved', label: 'Saved' },
	{ id: 'applied', label: 'Applied' },
	{ id: 'assessment', label: 'Online assessment' },
	{ id: 'interview', label: 'Interview' },
	{ id: 'offer', label: 'Offer' },
	{ id: 'closed', label: 'Closed' },
];

export interface TrackItem {
	fp: string;
	title: string;
	company: string;
	url: string;
	location: string;
	status: Status;
	createdAt: number;
	updatedAt: number;
	appliedAt?: number;
	history: { status: Status; at: number }[];
	notes: string;
	outcome?: 'rejected' | 'withdrawn' | 'accepted' | 'declined' | 'posting_closed';
}

export interface Reminder {
	id: string; // redis key under the user namespace
	fp?: string;
	text: string;
	due: string; // YYYY-MM-DD
	source: 'app' | 'assistant';
}

export interface Note {
	id: string;
	text: string;
	created?: string;
}

export interface UserData {
	profile: Profile | null;
	resume: string;
	prefs: Prefs;
	tracker: TrackItem[];
	reminders: Reminder[];
	notes: Note[];
	seen: Set<string>;
	hidden: Set<string>;
	appliedThisWeek: number;
}

export type Entry = Job & { firstSeen: number };

export interface RefreshResult {
	entries: Entry[];
	brandNew: Set<string>; // fingerprints first seen in THIS refresh
	scanned: number;
	duplicates: number;
	errors: string[];
	openFps: Set<string>;
	closedFps: FetchReport['closedFps'];
	boardsChecked: FetchReport['boardsChecked'];
	stats: { scannedToday: number; newToday: number; dupesToday: number };
	wroteIndex: boolean;
	/** True the very first time the index is built: nothing has a JobRadar history yet. */
	firstRun: boolean;
	at: number;
}

// =============================================================================
// USER DATA
// =============================================================================

export async function loadUser(client: RocketRideClient): Promise<UserData> {
	const user = redis(client, 'redis_user');
	const seenNode = redis(client, 'redis_seen');
	const [keys, seenKeys] = await Promise.all([user.scanAll(), seenNode.scanAll()]);

	const pick = (prefix: string) => keys.filter((k) => k.startsWith(prefix));
	const [profile, resume, prefs, appliedThisWeek] = await Promise.all([
		user.getJson<Profile>('profile'),
		user.get('resume').then((r) => r.value ?? ''),
		user.getJson<Prefs>('prefs'),
		user.get(`stat:applied:${isoWeek()}`).then((r) => Number(r.value ?? 0)),
	]);
	const tracker = (await Promise.all(pick('app:').map((k) => user.getJson<TrackItem>(k)))).filter(Boolean) as TrackItem[];
	const appReminders = await Promise.all(
		pick('remind:').map(async (k) => {
			const r = await user.getJson<{ fp?: string; text: string; due: string }>(k);
			return r ? ({ id: k, ...r, source: 'app' } as Reminder) : null;
		}),
	);
	const noteKeys = pick('notes:');
	const noteValues = await Promise.all(noteKeys.map((k) => user.get(k)));
	const reminders: Reminder[] = appReminders.filter(Boolean) as Reminder[];
	const notes: Note[] = [];
	noteKeys.forEach((k, i) => {
		const raw = noteValues[i].value ?? '';
		let v: { text?: string; due?: string; created?: string } = {};
		try {
			v = JSON.parse(raw);
		} catch {
			v = { text: raw };
		}
		if (k.startsWith('notes:reminder:') && v.due) reminders.push({ id: k, text: v.text ?? raw, due: v.due, source: 'assistant' });
		else notes.push({ id: k, text: v.text ?? raw, created: v.created });
	});
	reminders.sort((a, b) => a.due.localeCompare(b.due));

	return {
		profile,
		resume,
		prefs: { ...DEFAULT_PREFS, ...(prefs ?? {}) },
		tracker: tracker.sort((a, b) => b.updatedAt - a.updatedAt),
		reminders,
		notes,
		seen: new Set(seenKeys.filter((k) => k.startsWith('s:')).map((k) => k.slice(2))),
		hidden: new Set(seenKeys.filter((k) => k.startsWith('h:')).map((k) => k.slice(2))),
		appliedThisWeek,
	};
}

export const saveProfile = (c: RocketRideClient, p: Profile) => redis(c, 'redis_user').setJson('profile', p, 0);
export const saveResume = (c: RocketRideClient, text: string) => redis(c, 'redis_user').set('resume', text.slice(0, 40000), 0);
export const savePrefs = (c: RocketRideClient, p: Prefs) => redis(c, 'redis_user').setJson('prefs', p, 0);

/** A gap longer than this between two moments of activity starts a new visit. */
const VISIT_GAP = 2 * 3600;

interface SessionState {
	/** "New" means first seen after this moment. */
	since?: number;
	/** Last time the app was open (load or refresh). */
	lastActive?: number;
	/** Older builds stored these instead. */
	lastVisit?: number;
	previousVisit?: number;
}

/**
 * Work out "new since" for this visit. Reloading, or opening a second tab,
 * within the same visit keeps the same baseline, so New does not empty itself.
 * Coming back after a break starts a new visit: New is then everything first
 * seen since you were last here. A brand-new user starts 3 days back.
 */
export async function startSession(c: RocketRideClient): Promise<number> {
	const user = redis(c, 'redis_user');
	const state = (await user.getJson<SessionState>('state')) ?? {};
	const now = nowSec();
	const lastActive = state.lastActive ?? state.lastVisit;
	let since: number;
	if (lastActive === undefined) since = now - 3 * DAY;
	else if (now - lastActive > VISIT_GAP) since = lastActive;
	else since = state.since ?? state.previousVisit ?? lastActive;
	await user.setJson('state', { since, lastActive: now }, 0);
	return since;
}

/** Keep the visit alive while the app is open (called on every refresh). */
export async function touchSession(c: RocketRideClient, since: number): Promise<void> {
	await redis(c, 'redis_user').setJson('state', { since, lastActive: nowSec() }, 0);
}

export async function markAllSeen(c: RocketRideClient): Promise<number> {
	const now = nowSec();
	await redis(c, 'redis_user').setJson('state', { since: now, lastActive: now }, 0);
	return now;
}

export const markSeen = (c: RocketRideClient, fp: string) => redis(c, 'redis_seen').set(`s:${fp}`, '1', SEEN_TTL, 'NX');
export const hideJob = (c: RocketRideClient, fp: string) => redis(c, 'redis_seen').set(`h:${fp}`, '1', HIDDEN_TTL);
export const unhideJob = (c: RocketRideClient, fp: string) => redis(c, 'redis_seen').delete([`h:${fp}`]);

// =============================================================================
// TRACKER
// =============================================================================

export async function track(c: RocketRideClient, job: Pick<ScoredJob, 'fp' | 'title' | 'company' | 'url' | 'locations'>, status: Status, existing?: TrackItem): Promise<TrackItem> {
	const user = redis(c, 'redis_user');
	const now = nowSec();
	const item: TrackItem = existing
		? { ...existing, status, updatedAt: now, history: [...existing.history, { status, at: now }] }
		: { fp: job.fp, title: job.title, company: job.company, url: job.url, location: job.locations.slice(0, 2).join(', '), status, createdAt: now, updatedAt: now, history: [{ status, at: now }], notes: '' };
	if (status === 'applied' && !item.appliedAt) {
		item.appliedAt = now;
		await user.incr(`stat:applied:${isoWeek()}`);
		await user.expire(`stat:applied:${isoWeek()}`, 120 * DAY);
	}
	await user.setJson(`app:${job.fp}`, item, 0);

	// Follow-up reminders: 7 days after applying, 2 days after an interview.
	const followIn = status === 'applied' ? 7 : status === 'interview' ? 2 : status === 'assessment' ? 5 : 0;
	if (followIn) {
		const due = localDate(new Date(Date.now() + followIn * DAY * 1000));
		const text = status === 'applied' ? `Follow up on your ${job.company} application` : status === 'interview' ? `Send a thank-you note to ${job.company}` : `Check the ${job.company} assessment deadline`;
		await user.setJson(`remind:${job.fp}`, { fp: job.fp, text, due }, (followIn + 14) * DAY);
	} else if (status === 'offer' || status === 'closed') {
		await user.delete([`remind:${job.fp}`]);
	}
	await redis(c, 'redis_seen').set(`s:${job.fp}`, '1', SEEN_TTL);
	return item;
}

export async function updateTrackItem(c: RocketRideClient, item: TrackItem): Promise<void> {
	await redis(c, 'redis_user').setJson(`app:${item.fp}`, { ...item, updatedAt: nowSec() }, 0, 'XX');
}

export const untrack = (c: RocketRideClient, fp: string) => redis(c, 'redis_user').delete([`app:${fp}`, `remind:${fp}`, `fit:${fp}`]);

export async function snoozeReminder(c: RocketRideClient, r: Reminder, days: number): Promise<void> {
	const user = redis(c, 'redis_user');
	// Push from the due date if it is still ahead, otherwise from today.
	const [y, m, d] = r.due.split('-').map(Number);
	const dueMs = y ? new Date(y, m - 1, d).getTime() : 0;
	const base = Math.max(Date.now(), dueMs);
	const due = localDate(new Date(base + days * DAY * 1000));
	const ttl = Math.ceil((base - Date.now()) / 1000) + (days + 14) * DAY;
	const current = (await user.getJson<Record<string, unknown>>(r.id)) ?? { text: r.text };
	await user.setJson(r.id, { ...current, due }, ttl);
}

export const dismissReminder = (c: RocketRideClient, id: string) => redis(c, 'redis_user').delete([id]);

// =============================================================================
// CACHES
// =============================================================================

export async function cachedDescription(c: RocketRideClient, fp: string): Promise<string | null> {
	const r = await redis(c, 'redis_jobs').get(`desc:${fp}`);
	return r.found ? r.value : null;
}
export const cacheDescription = (c: RocketRideClient, fp: string, text: string) => redis(c, 'redis_jobs').set(`desc:${fp}`, text.slice(0, 30000), DESC_TTL);

export async function cachedFit(c: RocketRideClient, fp: string): Promise<string | null> {
	const r = await redis(c, 'redis_user').get(`fit:${fp}`);
	return r.found ? r.value : null;
}
export const cacheFit = (c: RocketRideClient, fp: string, text: string) => redis(c, 'redis_user').set(`fit:${fp}`, text.slice(0, 30000), FIT_TTL);

// =============================================================================
// REFRESH
// =============================================================================

type Shard = Record<string, { f: number; l: number }>;

async function bump(c: RocketRideClient, metric: string, by: number): Promise<number> {
	const node = redis(c, 'redis_jobs');
	const key = `stat:${today()}:${metric}`;
	if (by > 0) {
		const r = await node.incr(key, by);
		if (r.value_decimal === String(by)) await node.expire(key, STAT_TTL);
		return Number(r.value_decimal);
	}
	return Number((await node.get(key)).value ?? 0);
}

/**
 * Fetch every source, merge duplicates, then reconcile with the first-seen
 * index in Redis. Only the tab that wins the lock writes the index; another
 * tab refreshing at the same moment still gets correct results read-only.
 */
export async function refresh(c: RocketRideClient, user: UserData): Promise<RefreshResult> {
	const jobsNode = redis(c, 'redis_jobs');
	const report = await fetchJobs({ levels: user.prefs.levels, watched: user.prefs.watched, maxAgeDays: user.prefs.maxAgeDays });
	const now = nowSec();

	const lock = await jobsNode.set('lock:refresh', String(now), 120, 'NX');
	const initialized = (await jobsNode.get('meta:initialized')).found;
	const shardIds = Array.from({ length: SHARDS }, (_, i) => i);
	const shards = await Promise.all(shardIds.map((i) => jobsNode.getJson<Shard>(`idx:${i}`).then((s) => s ?? {})));
	const before = shards.map((s) => JSON.stringify(s));

	const firstSeen = new Map<string, number>();
	const brandNew = new Set<string>();
	for (const job of report.jobs) {
		const shard = shards[shardOf(job.fp)];
		const entry = shard[job.fp];
		if (entry) {
			firstSeen.set(job.fp, entry.f);
			if (now - entry.l > 6 * 3600) entry.l = now;
		} else {
			// First run: back-date to the posting so "new" means newly posted.
			const f = initialized ? now : Math.min(now, job.posted);
			shard[job.fp] = { f, l: now };
			firstSeen.set(job.fp, f);
			if (initialized) brandNew.add(job.fp);
		}
	}

	let wroteIndex = false;
	if (lock.stored) {
		try {
			await Promise.all(
				shards.map(async (s, i) => {
					for (const [fp, e] of Object.entries(s)) if (now - e.l > INDEX_KEEP) delete s[fp];
					if (JSON.stringify(s) !== before[i]) await jobsNode.setJson(`idx:${i}`, s, 0);
				}),
			);
			if (!initialized) await jobsNode.set('meta:initialized', String(now), 0, 'NX');
			wroteIndex = true;
		} finally {
			await jobsNode.delete(['lock:refresh']);
		}
	}

	const entries: Entry[] = report.jobs.map((job) => ({ ...job, firstSeen: firstSeen.get(job.fp) ?? now }));

	const [scannedToday, newToday, dupesToday] = wroteIndex
		? await Promise.all([bump(c, 'scanned', report.scanned), bump(c, 'new', brandNew.size), bump(c, 'duplicates', report.duplicates)])
		: await Promise.all([bump(c, 'scanned', 0), bump(c, 'new', 0), bump(c, 'duplicates', 0)]);

	return { entries, brandNew, scanned: report.scanned, duplicates: report.duplicates, errors: report.errors, openFps: report.openFps, closedFps: report.closedFps, boardsChecked: report.boardsChecked, stats: { scannedToday, newToday, dupesToday }, wroteIndex, firstRun: !initialized, at: now };
}

/**
 * Mark tracked jobs closed, but only on positive evidence: a list that answered
 * this time shows the posting as closed, or a watched board that answered no
 * longer has its URL. A failed fetch, a level you turned off or a company you
 * stopped watching is not evidence. A posting that comes back is reopened.
 */
export async function detectClosed(c: RocketRideClient, user: UserData, r: Pick<RefreshResult, 'openFps' | 'closedFps' | 'boardsChecked'>): Promise<{ closed: TrackItem[]; reopened: TrackItem[] }> {
	const closed: TrackItem[] = [];
	const reopened: TrackItem[] = [];
	for (const t of user.tracker) {
		if (t.status === 'closed' || t.status === 'offer') continue;
		if (t.outcome === 'posting_closed') {
			if (r.openFps.has(t.fp)) {
				const item: TrackItem = { ...t, outcome: undefined };
				await updateTrackItem(c, item);
				reopened.push(item);
			}
			continue;
		}
		if (r.openFps.has(t.fp)) continue;
		const gone =
			r.closedFps.has(t.fp) ||
			r.boardsChecked.some((b) => {
				if (!isOnBoard(t.url, b)) return false;
				const key = postingKey(t.url, b.slug);
				return key !== '' && !b.urls.has(key);
			});
		if (!gone) continue;
		const item: TrackItem = { ...t, outcome: 'posting_closed' };
		await updateTrackItem(c, item);
		closed.push(item);
	}
	return { closed, reopened };
}

/** "Forget" the last N hours of the index so the next refresh replays those postings as new. */
export async function replayRecent(c: RocketRideClient, hours: number): Promise<number> {
	const node = redis(c, 'redis_jobs');
	const cutoff = nowSec() - hours * 3600;
	let removed = 0;
	await Promise.all(
		Array.from({ length: SHARDS }, async (_, i) => {
			const s = await node.getJson<Shard>(`idx:${i}`);
			if (!s) return;
			let changed = false;
			for (const [fp, e] of Object.entries(s))
				if (e.f >= cutoff) {
					delete s[fp];
					removed++;
					changed = true;
				}
			if (changed) await node.setJson(`idx:${i}`, s, 0);
		}),
	);
	await redis(c, 'redis_user').setJson('state', { since: cutoff, lastActive: nowSec() }, 0);
	return removed;
}

/** Score and flag every entry for this user. Cheap enough to redo after every action. */
export function scoreAll(entries: Entry[], user: UserData, since: number): ScoredJob[] {
	const now = nowSec();
	const tracked = new Set(user.tracker.map((t) => t.fp));
	const jobs: ScoredJob[] = [];
	for (const e of entries) {
		if (!passesFilters(e, user.prefs)) continue;
		const isNew = e.firstSeen > since && !user.seen.has(e.fp) && !user.hidden.has(e.fp) && !tracked.has(e.fp);
		jobs.push(scoreJob(e, user.profile, user.prefs, isNew, now));
	}
	return jobs.sort((a, b) => b.score - a.score || b.posted - a.posted);
}

// =============================================================================
// DIGEST FOR THE ASSISTANT
// =============================================================================

export async function writeDigest(c: RocketRideClient, user: UserData, jobs: ScoredJob[], stats: RefreshResult['stats']): Promise<void> {
	const fmt = (j: ScoredJob) => ({
		fp: j.fp,
		title: j.title,
		company: j.company,
		locations: j.locations.slice(0, 3),
		score: j.score,
		why: j.reasons,
		warnings: j.warnings,
		posted: localDate(new Date(j.posted * 1000)),
		flags: j.flags,
		url: j.url,
	});
	const tracked = new Set(user.tracker.map((t) => t.fp));
	// The model is bad at date arithmetic: hand it the next two weeks by weekday.
	const upcoming: Record<string, string> = {};
	for (let i = 0; i < 14; i++) {
		const d = new Date(Date.now() + i * DAY * 1000);
		const label = i === 0 ? 'today' : i === 1 ? 'tomorrow' : `${i < 8 ? 'this coming' : 'the following'} ${d.toLocaleDateString('en-US', { weekday: 'long' })}`;
		upcoming[label] = localDate(d);
	}
	const digest = {
		today: `${today()} (${new Date().toLocaleDateString('en-US', { weekday: 'long' })})`,
		calendar: upcoming,
		profile: user.profile && { name: user.profile.name, headline: user.profile.headline, level: user.profile.level, graduation: user.profile.graduation, target_roles: user.profile.target_roles, skills: user.profile.skills.slice(0, 15), locations: user.profile.locations, evidence: user.profile.evidence.slice(0, 8) },
		preferences: { roles: user.prefs.roles, locations: user.prefs.locations, remote_ok: user.prefs.remoteOk, needs_sponsorship: user.prefs.needsSponsorship, min_score: user.prefs.minScore },
		new_matches: jobs.filter((j) => j.flags.includes('new') && j.score >= user.prefs.minScore).slice(0, 15).map(fmt),
		top_matches: jobs.filter((j) => !tracked.has(j.fp) && !user.hidden.has(j.fp)).slice(0, 12).map(fmt),
		tracker: user.tracker.map((t) => ({ fp: t.fp, title: t.title, company: t.company, status: t.status, outcome: t.outcome ?? null, applied: t.appliedAt ? localDate(new Date(t.appliedAt * 1000)) : null, updated: localDate(new Date(t.updatedAt * 1000)), notes: t.notes || null, url: t.url })),
		reminders: user.reminders.map((r) => ({ text: r.text, due: r.due })),
		notes: user.notes.map((n) => n.text).slice(0, 20),
		stats: { matches: jobs.filter((j) => j.score >= user.prefs.minScore).length, scanned_today: stats.scannedToday, new_today: stats.newToday, duplicates_merged_today: stats.dupesToday, applied_this_week: user.appliedThisWeek },
	};
	let body = JSON.stringify(digest);
	if (body.length > 60000) body = JSON.stringify({ ...digest, top_matches: digest.top_matches.slice(0, 5), notes: [] });
	await redis(c, 'redis_user').set('digest', body, DAY);
}

/** Wipe all JobRadar keys for a clean demo. */
export async function resetAll(c: RocketRideClient): Promise<number> {
	let n = 0;
	for (const node of ['redis_jobs', 'redis_user', 'redis_seen'] as const) {
		const r = redis(c, node);
		n += await r.deleteMany(await r.scanAll());
	}
	return n;
}
