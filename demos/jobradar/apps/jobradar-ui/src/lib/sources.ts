/**
 * Job sources, all public and CORS-open, fetched straight from the browser:
 *  - SimplifyJobs' community-maintained internship and new-grad lists on GitHub
 *  - any company's own ATS board on Greenhouse, Lever or Ashby (watched companies)
 *
 * Every listing is reduced to one shape and given a fingerprint
 * (company + normalized title) so the same role from several sources, or
 * reposted under a new id, collapses into one Job.
 */

// =============================================================================
// TYPES
// =============================================================================

export type Level = 'intern' | 'new_grad';
export type Ats = 'greenhouse' | 'lever' | 'ashby';

export interface WatchedCompany {
	ats: Ats;
	slug: string;
	name?: string;
}

export interface Listing {
	sourceId: string; // unique per source, e.g. simplify:<uuid>, gh:scaleai:123
	source: string; // human label: "Simplify internships", "Greenhouse"
	company: string;
	title: string;
	locations: string[];
	url: string;
	posted: number; // epoch seconds
	level: Level;
	category?: string;
	terms?: string[];
	sponsorship?: string;
	active: boolean;
	remote: boolean;
	ats?: { kind: Ats; slug: string; id: string };
	description?: string; // plain text when the source provides it
}

export interface Job {
	fp: string;
	company: string;
	title: string;
	locations: string[];
	url: string; // canonical link, preferring the company's own ATS
	posted: number; // latest posting date across sources
	firstPosted: number; // earliest date this role was posted (any id)
	postCount: number; // distinct postings of this role seen in source history
	level: Level;
	category?: string;
	terms?: string[];
	sponsorship?: string;
	remote: boolean;
	sources: { label: string; url: string }[];
	ats?: { kind: Ats; slug: string; id: string };
	description?: string;
}

export interface FetchReport {
	jobs: Job[];
	scanned: number; // raw listings read
	duplicates: number; // listings merged into another card
	errors: string[];
	/** Fingerprints that are open right now at any age. */
	openFps: Set<string>;
	/** Fingerprints a source that answered lists as closed, with no open posting anywhere: positive evidence of closing. */
	closedFps: Set<string>;
	/** Watched boards that answered this time, so a tracked role missing from one of them really closed. */
	boardsChecked: { slug: string; ats: Ats; urls: Set<string> }[];
}

const ATS_HOSTS: Record<Ats, RegExp> = { greenhouse: /greenhouse\.io$/, lever: /lever\.co$/, ashby: /ashbyhq\.com$/ };

const PATH_NOISE = new Set(['apply', 'application', 'jobs', 'job', 'embed', 'j']);

/**
 * The posting's own ID from an ATS URL (Greenhouse number, Lever or Ashby UUID),
 * so the same posting matches across hosts (boards. vs job-boards.greenhouse.io)
 * and suffixes (/apply). Empty when the URL has no ID after the company slug.
 */
export function postingKey(url: string, slug: string): string {
	try {
		const parts = new URL(url).pathname.toLowerCase().split('/').filter((p) => p && !PATH_NOISE.has(p));
		const at = parts.indexOf(slug);
		return at >= 0 ? (parts.slice(at + 1).pop() ?? '') : '';
	} catch {
		return '';
	}
}

/** True when this URL is a posting on that watched board (same ATS and company slug). */
export function isOnBoard(url: string, board: { slug: string; ats: Ats }): boolean {
	try {
		const u = new URL(url);
		return ATS_HOSTS[board.ats].test(u.hostname) && u.pathname.toLowerCase().split('/').includes(board.slug);
	} catch {
		return false;
	}
}

// =============================================================================
// NORMALIZING
// =============================================================================

const SEASON = /\b(summer|fall|autumn|winter|spring)\s*(20\d\d)?\b|\b20\d\d\b/gi;
const NOISE = /\b(intern(ship)?|co-?op|new grad(uate)?|early career|university grad(uate)?|entry level|i{1,3}|iv|level \d)\b/gi;

export function normalizeCompany(s: string): string {
	return s
		.toLowerCase()
		.replace(/[,.]|\b(inc|llc|ltd|corp|corporation|co|technologies|technology|labs)\b/g, ' ')
		.replace(/[^a-z0-9]+/g, ' ')
		.trim();
}

export function normalizeTitle(s: string): string {
	return s
		.toLowerCase()
		.replace(SEASON, ' ')
		.replace(NOISE, ' ')
		.replace(/[^a-z0-9+#]+/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();
}

/** Small stable hash (FNV-1a, base36) so fingerprints are short cache keys. */
export function hash(s: string): string {
	let h = 0x811c9dc5;
	for (let i = 0; i < s.length; i++) {
		h ^= s.charCodeAt(i);
		h = Math.imul(h, 0x01000193);
	}
	return (h >>> 0).toString(36);
}

export function fingerprint(company: string, title: string, level: Level): string {
	return hash(`${normalizeCompany(company)}|${normalizeTitle(title)}|${level}`);
}

const REMOTE = /\bremote\b/i;
const DIRECT_ATS = /greenhouse\.io|lever\.co|ashbyhq\.com|myworkdayjobs\.com|smartrecruiters\.com|icims\.com|jobvite\.com/i;

function stripHtml(html: string): string {
	const decoded = html.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ');
	return decoded
		.replace(/<(br|\/p|\/li|\/h\d)>/gi, '\n')
		.replace(/<li>/gi, '- ')
		.replace(/<[^>]+>/g, ' ')
		.replace(/[ \t]+/g, ' ')
		.replace(/\n\s+/g, '\n')
		.trim();
}

// =============================================================================
// SOURCES
// =============================================================================

const simplifyUrl = (repo: string) => `https://raw.githubusercontent.com/SimplifyJobs/${repo}/dev/.github/scripts/listings.json`;

/**
 * Simplify renames its internship repo every season (Summer2026 became
 * Summer2027 in November 2026), so each list has candidates tried in order.
 */
export const SIMPLIFY_SOURCES: Record<Level, { label: string; urls: string[] }> = {
	intern: {
		label: 'Simplify internships',
		urls: (() => {
			const y = new Date().getFullYear();
			return [...new Set([y + 1, y, y + 2].map((n) => simplifyUrl(`Summer${n}-Internships`)))];
		})(),
	},
	new_grad: { label: 'Simplify new grad', urls: [simplifyUrl('New-Grad-Positions')] },
};

interface SimplifyRow {
	id: string;
	company_name: string;
	title: string;
	locations?: string[];
	url: string;
	date_posted: number;
	active: boolean;
	is_visible?: boolean;
	category?: string;
	terms?: string[];
	sponsorship?: string;
}

/** Rows from both lists, including closed ones: their history powers repost detection. */
async function fetchSimplify(level: Level): Promise<{ rows: SimplifyRow[]; level: Level }> {
	const { label, urls } = SIMPLIFY_SOURCES[level];
	const failures: string[] = [];
	for (const url of urls) {
		try {
			const res = await fetch(url, { cache: 'no-cache' });
			if (!res.ok) {
				failures.push(`HTTP ${res.status}`);
				continue;
			}
			const rows = (await res.json()) as SimplifyRow[];
			if (Array.isArray(rows) && rows.length) return { rows, level };
			failures.push('empty list');
		} catch (e) {
			failures.push((e as Error).message);
		}
	}
	throw new Error(`${label} could not be loaded (${failures.join(', ')}). The list may have moved; see SIMPLIFY_SOURCES in src/lib/sources.ts.`);
}

const EARLY = /\b(intern(ship)?s?|co-?op|student|university|new grad(uate)?|early career|graduate|entry[- ]level|junior|associate|apprentice|residency|fellow(ship)?)\b/i;
const SENIOR = /\b(senior|sr\.?|staff|principal|lead|manager|director|head of|vp|phd)\b/i;
const INTERN = /\b(intern(ship)?s?|co-?op|student)\b/i;

function levelOf(title: string): Level | null {
	if (!EARLY.test(title) || SENIOR.test(title)) return null;
	return INTERN.test(title) ? 'intern' : 'new_grad';
}

async function fetchWatched(w: WatchedCompany): Promise<Listing[]> {
	const out: Listing[] = [];
	const now = Date.now() / 1000;
	if (w.ats === 'greenhouse') {
		const res = await fetch(`https://boards-api.greenhouse.io/v1/boards/${w.slug}/jobs?content=true`);
		if (!res.ok) throw new Error(`Greenhouse ${w.slug}: HTTP ${res.status}`);
		const data = (await res.json()) as { jobs?: Array<{ id: number; title: string; absolute_url: string; updated_at?: string; first_published?: string; location?: { name?: string }; company_name?: string; content?: string }> };
		for (const j of data.jobs ?? []) {
			const level = levelOf(j.title);
			if (!level) continue;
			const loc = j.location?.name ?? '';
			out.push({
				sourceId: `gh:${w.slug}:${j.id}`,
				source: 'Greenhouse',
				company: j.company_name || w.name || w.slug,
				title: j.title.trim(),
				locations: loc ? loc.split(/;|\|/).map((s) => s.trim()) : [],
				url: j.absolute_url.split('?')[0],
				posted: Date.parse(j.first_published ?? j.updated_at ?? '') / 1000 || now,
				level,
				active: true,
				remote: REMOTE.test(loc),
				ats: { kind: 'greenhouse', slug: w.slug, id: String(j.id) },
				description: j.content ? stripHtml(j.content).slice(0, 20000) : undefined,
			});
		}
	} else if (w.ats === 'lever') {
		const res = await fetch(`https://api.lever.co/v0/postings/${w.slug}?mode=json`);
		if (!res.ok) throw new Error(`Lever ${w.slug}: HTTP ${res.status}`);
		const data = (await res.json()) as Array<{ id: string; text: string; hostedUrl: string; createdAt?: number; categories?: { location?: string; allLocations?: string[] }; workplaceType?: string; descriptionPlain?: string; additionalPlain?: string; lists?: Array<{ text: string; content: string }> }>;
		for (const j of data) {
			const level = levelOf(j.text);
			if (!level) continue;
			const locs = j.categories?.allLocations?.length ? j.categories.allLocations : j.categories?.location ? [j.categories.location] : [];
			const lists = (j.lists ?? []).map((l) => `${l.text}\n${stripHtml(l.content)}`).join('\n');
			out.push({
				sourceId: `lever:${w.slug}:${j.id}`,
				source: 'Lever',
				company: w.name || w.slug,
				title: j.text.trim(),
				locations: locs,
				url: j.hostedUrl,
				posted: (j.createdAt ?? now * 1000) / 1000,
				level,
				active: true,
				remote: j.workplaceType === 'remote' || locs.some((l) => REMOTE.test(l)),
				ats: { kind: 'lever', slug: w.slug, id: j.id },
				description: [j.descriptionPlain, lists, j.additionalPlain].filter(Boolean).join('\n\n').slice(0, 20000),
			});
		}
	} else {
		const res = await fetch(`https://api.ashbyhq.com/posting-api/job-board/${w.slug}`);
		if (!res.ok) throw new Error(`Ashby ${w.slug}: HTTP ${res.status}`);
		const data = (await res.json()) as { jobs?: Array<{ id: string; title: string; jobUrl: string; publishedAt?: string; location?: string; secondaryLocations?: Array<{ location: string }>; isRemote?: boolean; isListed?: boolean; descriptionPlain?: string }> };
		for (const j of data.jobs ?? []) {
			if (j.isListed === false) continue;
			const level = levelOf(j.title);
			if (!level) continue;
			const locs = [j.location, ...(j.secondaryLocations ?? []).map((s) => s.location)].filter(Boolean) as string[];
			out.push({
				sourceId: `ashby:${w.slug}:${j.id}`,
				source: 'Ashby',
				company: w.name || w.slug,
				title: j.title.trim(),
				locations: locs,
				url: j.jobUrl,
				posted: Date.parse(j.publishedAt ?? '') / 1000 || now,
				level,
				active: true,
				remote: !!j.isRemote,
				ats: { kind: 'ashby', slug: w.slug, id: j.id },
				description: j.descriptionPlain?.slice(0, 20000),
			});
		}
	}
	return out;
}

/**
 * Find which ATS hosts a company's board. A company can have a dormant board
 * on one ATS and its real one on another, so the busiest board wins.
 */
export async function detectBoard(slug: string): Promise<WatchedCompany | null> {
	const s = slug.trim().toLowerCase().replace(/^https?:\/\/[^/]+\//, '').split(/[/?#]/)[0];
	const probe = async (ats: Ats): Promise<{ w: WatchedCompany; jobs: number } | null> => {
		try {
			if (ats === 'greenhouse') {
				const [board, jobs] = await Promise.all([
					fetch(`https://boards-api.greenhouse.io/v1/boards/${s}`).then((r) => (r.ok ? r.json() : null)),
					fetch(`https://boards-api.greenhouse.io/v1/boards/${s}/jobs`).then((r) => (r.ok ? r.json() : null)),
				]);
				if (!jobs) return null;
				return { w: { ats, slug: s, name: (board as { name?: string } | null)?.name || s }, jobs: ((jobs as { jobs?: unknown[] }).jobs ?? []).length };
			}
			if (ats === 'lever') {
				const r = await fetch(`https://api.lever.co/v0/postings/${s}?mode=json`);
				if (!r.ok) return null;
				const list = (await r.json()) as unknown[];
				return Array.isArray(list) ? { w: { ats, slug: s, name: s }, jobs: list.length } : null;
			}
			const r = await fetch(`https://api.ashbyhq.com/posting-api/job-board/${s}`);
			if (!r.ok) return null;
			const d = (await r.json()) as { jobs?: unknown[] };
			return { w: { ats, slug: s, name: s }, jobs: (d.jobs ?? []).length };
		} catch {
			return null;
		}
	};
	const found = (await Promise.all((['greenhouse', 'lever', 'ashby'] as Ats[]).map(probe))).filter(Boolean) as { w: WatchedCompany; jobs: number }[];
	found.sort((a, b) => b.jobs - a.jobs);
	if (!found[0]?.jobs) return null;
	// Only Greenhouse publishes a display name; otherwise title-case the slug.
	const named = found.find((f) => f.w.name && f.w.name !== s)?.w.name;
	return { ...found[0].w, name: named ?? s.charAt(0).toUpperCase() + s.slice(1) };
}

// =============================================================================
// FETCH + MERGE
// =============================================================================

export interface FetchOptions {
	levels: Level[];
	watched: WatchedCompany[];
	maxAgeDays: number;
}

export async function fetchJobs(opts: FetchOptions): Promise<FetchReport> {
	const errors: string[] = [];
	const now = Date.now() / 1000;
	const minPosted = now - opts.maxAgeDays * 86400;
	const listings: Listing[] = [];
	const openFps = new Set<string>();
	const listedClosed = new Set<string>();
	const boardsChecked: FetchReport['boardsChecked'] = [];
	// fp -> every posting id this role has had, open or closed, with its date
	const history = new Map<string, Map<string, number>>();
	let scanned = 0;

	const simplify = await Promise.all(
		opts.levels.map((lvl) =>
			fetchSimplify(lvl).catch((e: Error) => {
				errors.push(e.message);
				return null;
			}),
		),
	);
	for (const part of simplify) {
		if (!part) continue;
		const label = SIMPLIFY_SOURCES[part.level].label;
		for (const row of part.rows) {
			if (row.is_visible === false) continue;
			const fp = fingerprint(row.company_name, row.title, part.level);
			const h = history.get(fp) ?? new Map<string, number>();
			h.set(row.id, row.date_posted);
			history.set(fp, h);
			if (!row.active) {
				listedClosed.add(fp);
				continue;
			}
			openFps.add(fp);
			if (row.date_posted < minPosted) continue;
			scanned++;
			const locs = row.locations ?? [];
			listings.push({
				sourceId: `simplify:${row.id}`,
				source: label,
				company: row.company_name,
				title: row.title,
				locations: locs,
				url: row.url,
				posted: row.date_posted,
				level: part.level,
				category: row.category,
				terms: row.terms?.filter((t) => t && t !== 'N/A'),
				sponsorship: row.sponsorship && row.sponsorship !== 'Other' ? row.sponsorship : undefined,
				active: true,
				remote: locs.some((l) => REMOTE.test(l)),
			});
		}
	}

	await Promise.all(
		opts.watched.map(async (w) => {
			try {
				const rows = await fetchWatched(w);
				boardsChecked.push({ slug: w.slug.toLowerCase(), ats: w.ats, urls: new Set(rows.map((r) => postingKey(r.url, w.slug.toLowerCase())).filter(Boolean)) });
				for (const r of rows) {
					openFps.add(fingerprint(r.company, r.title, r.level));
					scanned++;
					if (r.posted < minPosted - 60 * 86400) continue; // long-open ATS roles still show, within reason
					listings.push(r);
				}
			} catch (e) {
				errors.push((e as Error).message);
			}
		}),
	);

	// Merge by fingerprint. Prefer a direct ATS link and keep every source.
	const byFp = new Map<string, Job>();
	let duplicates = 0;
	for (const l of listings) {
		const fp = fingerprint(l.company, l.title, l.level);
		const h = recentPostings(history.get(fp), l.posted);
		const existing = byFp.get(fp);
		if (!existing) {
			byFp.set(fp, {
				fp,
				company: l.company,
				title: l.title,
				locations: [...l.locations],
				url: l.url,
				posted: l.posted,
				firstPosted: Math.min(h.first, l.posted),
				postCount: h.count,
				level: l.level,
				category: l.category,
				terms: l.terms,
				sponsorship: l.sponsorship,
				remote: l.remote,
				sources: [{ label: l.source, url: l.url }],
				ats: l.ats,
				description: l.description,
			});
			continue;
		}
		duplicates++;
		existing.posted = Math.max(existing.posted, l.posted);
		existing.firstPosted = Math.min(existing.firstPosted, l.posted);
		for (const loc of l.locations) if (!existing.locations.includes(loc)) existing.locations.push(loc);
		existing.remote ||= l.remote;
		existing.sponsorship ||= l.sponsorship;
		existing.category ||= l.category;
		existing.terms ||= l.terms;
		if (!existing.sources.some((s) => s.url === l.url)) existing.sources.push({ label: l.source, url: l.url });
		if (l.ats && !existing.ats) {
			existing.ats = l.ats;
			existing.description ||= l.description;
		}
		if (!DIRECT_ATS.test(existing.url) && DIRECT_ATS.test(l.url)) existing.url = l.url;
	}
	const closedFps = new Set([...listedClosed].filter((fp) => !openFps.has(fp)));
	return { jobs: [...byFp.values()], scanned, duplicates, errors, openFps, closedFps, boardsChecked };
}

/**
 * Postings of the same role within a season of the latest one. Season words are
 * stripped from the fingerprint, so last year's run of an annual internship has
 * the same fingerprint; counting it would wrongly flag the program as reposted.
 */
const SEASON_WINDOW = 150 * 86400;
function recentPostings(h: Map<string, number> | undefined, posted: number): { count: number; first: number } {
	if (!h?.size) return { count: 1, first: posted };
	const latest = Math.max(posted, ...h.values());
	const recent = [...h.values(), posted].filter((d) => latest - d <= SEASON_WINDOW).sort((a, b) => a - b);
	// Lists often carry several identical rows posted together (one per opening
	// or city). Those are one posting; only a new wave days later is a repost.
	let waves = 1;
	for (let i = 1; i < recent.length; i++) if (recent[i] - recent[i - 1] > REPOST_GAP) waves++;
	return { count: waves, first: recent[0] };
}
const REPOST_GAP = 3 * 86400;

/** Fetch the full description for a job from its ATS, when it has one. */
export async function fetchAtsDescription(job: Job): Promise<string | null> {
	if (job.description) return job.description;
	if (job.ats?.kind === 'greenhouse') {
		const res = await fetch(`https://boards-api.greenhouse.io/v1/boards/${job.ats.slug}/jobs/${job.ats.id}`).catch(() => null);
		if (res?.ok) {
			const j = (await res.json()) as { content?: string };
			if (j.content) return stripHtml(j.content).slice(0, 20000);
		}
	}
	const gh = job.url.match(/boards\.greenhouse\.io\/(?:embed\/job_app\?for=)?([a-z0-9_-]+)\/jobs\/(\d+)/i) ?? job.url.match(/job-boards\.greenhouse\.io\/([a-z0-9_-]+)\/jobs\/(\d+)/i);
	if (gh) {
		const res = await fetch(`https://boards-api.greenhouse.io/v1/boards/${gh[1]}/jobs/${gh[2]}`).catch(() => null);
		if (res?.ok) {
			const j = (await res.json()) as { content?: string };
			if (j.content) return stripHtml(j.content).slice(0, 20000);
		}
	}
	return null;
}
