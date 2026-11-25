/** Career workspace records and deterministic analysis. No external calls. */
import type { TrackItem } from './store';

export interface Contact {
	id: string;
	name: string;
	company: string;
	role: string;
	email: string;
	link: string;
	jobFp: string;
	notes: string;
	lastContact: string;
	followUp: string;
}
export interface Interview {
	id: string;
	jobFp: string;
	title: string;
	start: string;
	minutes: number;
	location: string;
	notes: string;
}
export interface SavedAnswer {
	id: string;
	question: string;
	text: string;
	updatedAt: number;
}
export interface CareerData {
	contacts: Contact[];
	interviews: Interview[];
	answers: SavedAnswer[];
	weeklyGoal: number;
}
export interface ChecklistItem {
	id: string;
	label: string;
	done: boolean;
}
export interface InterviewPrep {
	questions: { question: string; focus: string }[];
	stories: { headline: string; evidence: string; angle: string }[];
	askEmployer: string[];
	createdAt: number;
}
export const EMPTY_CAREER: CareerData = { contacts: [], interviews: [], answers: [], weeklyGoal: 5 };
export const DEFAULT_CHECKLIST = ['Review the posting', 'Tailor my resume', 'Prepare application answers', 'Review before submitting'];
export function normalizeCareer(value: Partial<CareerData> | null): CareerData {
	return { contacts: Array.isArray(value?.contacts) ? value.contacts : [], interviews: Array.isArray(value?.interviews) ? value.interviews : [], answers: Array.isArray(value?.answers) ? value.answers : [], weeklyGoal: Number.isInteger(value?.weeklyGoal) && value!.weeklyGoal! >= 1 && value!.weeklyGoal! <= 100 ? value!.weeklyGoal! : 5 };
}
export function webUrl(value: string): string {
	const url = new URL(value.trim());
	if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) throw new Error('Use a public http or https URL without embedded credentials.');
	if (/^(localhost|127\.|10\.|192\.168\.|169\.254\.|\[::1\])/.test(url.hostname) || /^172\.(1[6-9]|2\d|3[01])\./.test(url.hostname)) throw new Error('Use a public job posting URL.');
	for (const key of [...url.searchParams.keys()]) if (/^utm_|^(fbclid|gclid)$/i.test(key)) url.searchParams.delete(key);
	return url.href;
}
export function calendarDate(value: string): boolean {
	if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
	const date = new Date(`${value}T12:00:00Z`);
	return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
export function manualJob(input: { title: string; company: string; url: string; location: string; description: string }, now = Date.now()): TrackItem {
	if (!input.title.trim() || !input.company.trim()) throw new Error('Add a job title and company.');
	if (input.title.length > 250 || input.company.length > 200 || input.description.length > 40000) throw new Error('Keep the title under 250 characters, company under 200, and description under 40,000.');
	const at = Math.floor(now / 1000);
	return { fp: `manual-${crypto.randomUUID()}`, title: input.title.trim(), company: input.company.trim(), url: webUrl(input.url), location: input.location.trim().slice(0, 500), description: input.description.trim(), status: 'saved', createdAt: at, updatedAt: at, history: [{ status: 'saved', at }], notes: '', priority: 'normal' };
}
const dayString = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
const appliedAt = (item: TrackItem) => item.appliedAt ?? item.history.find((event) => event.status === 'applied')?.at;
const reached = (item: TrackItem, stages: string[]) => stages.includes(item.status) || item.history.some((event) => stages.includes(event.status));
export function searchMetrics(items: TrackItem[], now = new Date()) {
	const applied = items.filter((item) => appliedAt(item) !== undefined);
	const interviews = items.filter((item) => reached(item, ['interview']));
	const offers = items.filter((item) => reached(item, ['offer']));
	const replied = (item: TrackItem) => reached(item, ['assessment', 'interview', 'offer']) || item.outcome === 'rejected';
	const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
	monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
	const weeks = Array.from({ length: 6 }, (_, index) => {
		const start = new Date(monday);
		start.setDate(start.getDate() - (5 - index) * 7);
		const end = new Date(start);
		end.setDate(end.getDate() + 7);
		return {
			start: dayString(start),
			label: start.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
			count: applied.filter((item) => {
				const time = appliedAt(item)! * 1000;
				return time >= start.getTime() && time < end.getTime() && time <= now.getTime();
			}).length,
		};
	});
	const responded = applied.filter(replied).length;
	return { saved: items.length, applied: applied.length, interviews: interviews.length, offers: offers.length, responded, responseRate: applied.length ? Math.round((responded / applied.length) * 100) : null, interviewRate: applied.length ? Math.round((applied.filter((item) => reached(item, ['interview'])).length / applied.length) * 100) : null, thisWeek: weeks[5].count, weeks, awaiting: applied.filter((item) => !replied(item) && item.status !== 'closed' && now.getTime() / 1000 - appliedAt(item)! >= 14 * 86400).length };
}
// Explicit skill dictionary, with aliases and word boundaries. This is text coverage, not an ATS prediction.
const SKILLS: [string, string[]][] = [
	['JavaScript', ['javascript']],
	['TypeScript', ['typescript']],
	['Python', ['python']],
	['Java', ['java']],
	['C++', ['c++', 'c++11', 'c++14', 'c++17', 'c++20', 'c++23']],
	['C#', ['c#']],
	['Go', ['golang', 'go programming', 'go language', 'Go']],
	['Rust', ['rust']],
	['SQL', ['sql']],
	['React', ['react', 'react.js', 'reactjs']],
	['Node.js', ['node.js', 'nodejs']],
	['Next.js', ['next.js', 'nextjs']],
	['Vue', ['vue', 'vue.js']],
	['Angular', ['angular']],
	['HTML', ['html']],
	['CSS', ['css']],
	['Swift', ['swift']],
	['Kotlin', ['kotlin']],
	['Django', ['django']],
	['Flask', ['flask']],
	['FastAPI', ['fastapi']],
	['Spring', ['spring boot']],
	['REST APIs', ['rest api', 'restful']],
	['GraphQL', ['graphql']],
	['PostgreSQL', ['postgresql', 'postgres']],
	['MySQL', ['mysql']],
	['MongoDB', ['mongodb']],
	['Redis', ['redis']],
	['Docker', ['docker']],
	['Kubernetes', ['kubernetes', 'k8s']],
	['AWS', ['aws', 'amazon web services']],
	['Azure', ['azure']],
	['Google Cloud', ['gcp', 'google cloud']],
	['Git', ['git']],
	['CI/CD', ['ci/cd', 'continuous integration']],
	['GitHub Actions', ['github actions']],
	['Jest', ['jest']],
	['Pytest', ['pytest']],
	['Playwright', ['playwright']],
	['Linux', ['linux']],
	['Figma', ['figma']],
	['Tableau', ['tableau']],
	['Power BI', ['power bi']],
	['Excel', ['excel']],
	['Salesforce', ['salesforce']],
	['PyTorch', ['pytorch']],
	['TensorFlow', ['tensorflow']],
	['OpenCV', ['opencv']],
	['Machine learning', ['machine learning']],
	['Data analysis', ['data analysis', 'data analytics']],
	['A/B testing', ['a/b testing']],
	['Product management', ['product management']],
	['Agile', ['agile']],
	['Scrum', ['scrum']],
	['Communication', ['communication']],
	['Leadership', ['leadership']],
	['Project management', ['project management']],
	['Distributed systems', ['distributed systems']],
	['Data structures', ['data structures']],
	['Algorithms', ['algorithms']],
	['Cybersecurity', ['cybersecurity', 'information security']],
	['ETL', ['etl']],
	['Spark', ['apache spark']],
	['R', ['r programming']],
	['MATLAB', ['matlab']],
	['SolidWorks', ['solidworks']],
	['CAD', ['cad']],
	['Robotics', ['robotics']],
	['ROS', ['ros2', 'robot operating system']],
	['Customer research', ['user research', 'customer research']],
	['SEO', ['seo', 'search engine optimization']],
	['Google Analytics', ['google analytics', 'ga4']],
];
const escapeRegex = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
function mentions(text: string, aliases: string[]) {
	return aliases.some((alias) => new RegExp(`(^|[^a-z0-9])${escapeRegex(alias)}(?=$|[^a-z0-9])`, alias === 'Go' ? '' : 'i').test(text));
}
export function keywordCoverage(description: string, resume: string) {
	const requested = SKILLS.filter(([, aliases]) => mentions(description, aliases));
	const matched = requested.filter(([, aliases]) => mentions(resume, aliases)).map(([label]) => label);
	const missing = requested.filter(([, aliases]) => !mentions(resume, aliases)).map(([label]) => label);
	return { matched, missing, total: requested.length, percent: requested.length ? Math.round((matched.length / requested.length) * 100) : null };
}
export function trackerCsv(items: TrackItem[]): string {
	const cell = (value: unknown) => {
		let text = String(value ?? '');
		if (/^\s*[=+\-@]/.test(text) || /^[\t\r]/.test(text)) text = `'${text}`;
		return `"${text.replace(/"/g, '""')}"`;
	};
	const rows: unknown[][] = [['Company', 'Role', 'Status', 'Priority', 'Deadline', 'Location', 'URL', 'Applied', 'Outcome', 'Notes']];
	for (const item of items) rows.push([item.company, item.title, item.status, item.priority ?? 'normal', item.deadline, item.location, item.url, appliedAt(item) !== undefined ? dayString(new Date(appliedAt(item)! * 1000)) : '', item.outcome, item.notes]);
	return '\uFEFF' + rows.map((row) => row.map(cell).join(',')).join('\r\n') + '\r\n';
}
const icsEscape = (text: string) =>
	text
		.replace(/\\/g, '\\\\')
		.replace(/\r\n|\r|\n/g, '\\n')
		.replace(/;/g, '\\;')
		.replace(/,/g, '\\,');
function foldLine(line: string) {
	const lines: string[] = [];
	let current = '';
	let size = 0;
	for (const char of line) {
		const bytes = new TextEncoder().encode(char).length;
		if (size + bytes > 75) {
			lines.push(current);
			current = ' ';
			size = 1;
		}
		current += char;
		size += bytes;
	}
	lines.push(current);
	return lines.join('\r\n');
}
export function interviewCalendar(event: Interview, job: Pick<TrackItem, 'title' | 'company'>, now = new Date()): string {
	const start = new Date(event.start);
	if (!Number.isFinite(start.getTime()) || !Number.isInteger(event.minutes) || event.minutes < 5 || event.minutes > 480) throw new Error('Choose a valid interview date and a duration between 5 and 480 minutes.');
	const stamp = (date: Date) =>
		date
			.toISOString()
			.replace(/[-:]/g, '')
			.replace(/\.\d{3}Z$/, 'Z');
	const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//JobRadar//Interviews//EN', 'CALSCALE:GREGORIAN', 'BEGIN:VEVENT', `UID:${icsEscape(event.id)}@jobradar`, `DTSTAMP:${stamp(now)}`, `DTSTART:${stamp(start)}`, `DTEND:${stamp(new Date(start.getTime() + event.minutes * 60000))}`, `SUMMARY:${icsEscape(`${event.title}: ${job.company}`)}`, `DESCRIPTION:${icsEscape(`${job.title}\n${event.notes}`)}`, `LOCATION:${icsEscape(event.location)}`, 'END:VEVENT', 'END:VCALENDAR'];
	return lines.map(foldLine).join('\r\n') + '\r\n';
}
export function downloadFile(text: string, filename: string, type: string) {
	const url = URL.createObjectURL(new Blob([text], { type }));
	const link = document.createElement('a');
	link.href = url;
	link.download = filename;
	link.click();
	setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function parseInterviewPrep(answer: string, sourceResume: string): InterviewPrep {
	const object = JSON.parse(answer.slice(answer.indexOf('{'), answer.lastIndexOf('}') + 1)) as Record<string, unknown>;
	const rows = (value: unknown) => (Array.isArray(value) ? value.filter((entry): entry is Record<string, unknown> => !!entry && typeof entry === 'object') : []);
	const clean = (value: unknown, max = 1500) => (typeof value === 'string' ? value.trim().slice(0, max) : '');
	const questions = rows(object.questions)
		.map((row) => ({ question: clean(row.question), focus: clean(row.focus) }))
		.filter((row) => row.question)
		.slice(0, 8);
	if (!questions.length) throw new Error('The writer did not return interview questions. Try again.');
	const normalize = (text: string) => text.toLowerCase().replace(/\s+/g, ' ').trim();
	const stories = rows(object.stories)
		.map((row) => ({ headline: clean(row.headline), evidence: clean(row.evidence), angle: clean(row.angle) }))
		.filter((row) => row.evidence.length > 10 && normalize(sourceResume).includes(normalize(row.evidence)))
		.slice(0, 4);
	return {
		questions,
		stories,
		askEmployer: Array.isArray(object.askEmployer)
			? object.askEmployer
					.filter((v): v is string => typeof v === 'string')
					.map((v) => v.slice(0, 800))
					.slice(0, 5)
			: [],
		createdAt: Date.now(),
	};
}
