import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from '../../apps/jobradar-ui/node_modules/typescript/lib/typescript.js';
async function source(name) {
	const code = readFileSync(new URL(`../../apps/jobradar-ui/src/lib/${name}.ts`, import.meta.url), 'utf8');
	const output = ts.transpileModule(code, {
		compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
	}).outputText;
	return import(`data:text/javascript;base64,${Buffer.from(output).toString('base64')}`);
}
const { dataStore } = await source('storage');
const { readTailoredResume, sourceHash } = await source('documents');
function fileClient({ readError } = {}) {
	const files = new Map();
	let fail = false;
	return {
		files,
		failNext() {
			fail = true;
		},
		async fsReadString(path) {
			if (readError) throw Error(readError);
			if (!files.has(path)) throw Error('File not found');
			return files.get(path);
		},
		async fsWriteString(path, value) {
			if (fail) {
				fail = false;
				throw Error('Connection lost');
			}
			files.set(path, value);
		},
	};
}
test('serialized concurrent updates survive reopening and preserve TTL conditions', async () => {
	const client = fileClient();
	const store = dataStore(client, 'user');
	await Promise.all(Array.from({ length: 20 }, () => store.incr('count')));
	assert.equal((await store.get('count')).value, '20');
	assert.equal((await store.set('count', 'wrong', 0, 'NX')).stored, false);
	assert.equal((await store.set('absent', 'wrong', 0, 'XX')).stored, false);
	const fresh = dataStore({ fsReadString: client.fsReadString, fsWriteString: client.fsWriteString }, 'user');
	assert.equal((await fresh.get('count')).value, '20');
	await store.set('expired', 'x', -1);
	await store.expire('expired', -1);
	assert.equal((await store.get('expired')).found, false);
	assert.equal((await store.set('expired', 'new', 0, 'NX')).stored, true);
});
test('a failed save rolls back without poisoning the next operation', async () => {
	const client = fileClient();
	const store = dataStore(client, 'user');
	await store.set('resume', 'original', 0);
	client.failNext();
	await assert.rejects(store.set('resume', 'failed', 0), /Connection lost/);
	assert.equal((await store.get('resume')).value, 'original');
	await store.set('resume', 'saved', 0);
	assert.equal((await store.get('resume')).value, 'saved');
});
test('failed initial reads never replace an unread workspace with an empty one', async () => {
	const client = fileClient({ readError: 'Not authorized' });
	await assert.rejects(dataStore(client, 'user').set('profile', 'x', 0), /Not authorized/);
	assert.equal(client.files.size, 0);
});
test('resume output validates structure and binds saved versions to the source', () => {
	const original = 'Source resume';
	const text = 'Jordan Lee\n' + 'Python data pipeline project. '.repeat(6);
	const version = readTailoredResume(
		JSON.stringify({ resume: text, changes: ['Emphasized Python'], gaps: ['No Go evidence'] }),
		original
	);
	assert.equal(version.text, text.trim());
	assert.equal(version.sourceHash, sourceHash(original));
	assert.notEqual(version.sourceHash, sourceHash('New source resume'));
	assert.throws(() => readTailoredResume('{"resume":""}', original), /complete resume/);
	assert.throws(() => readTailoredResume('Incomplete', original), /incomplete answer/);
});
test('runtime pipelines contain no Redis nodes and email is read-only', () => {
	for (const name of ['profile', 'writer', 'assistant', 'jobradar-tools', 'email']) {
		const pipeline = JSON.parse(
			readFileSync(new URL(`../../apps/jobradar-ui/src/pipelines/${name}.pipe`, import.meta.url))
		);
		assert.ok(pipeline.components.every((node) => node.provider !== 'tool_redis'));
		if (name === 'email')
			assert.equal(pipeline.components.find((node) => node.provider === 'tool_gmail').config.access, 'readonly');
	}
});

// Exercise OAuth callback handling with a small browser boundary, never real credentials.
import vm from 'node:vm';
function emailModule({
	nonce = 'pending',
	callbackNonce = nonce,
	tokens = {
		access_token: 'fixture-access',
		refresh_token: 'fixture-refresh',
		scope: 'https://www.googleapis.com/auth/gmail.readonly',
	},
} = {}) {
	const params = new URLSearchParams({
		tokens: JSON.stringify(tokens),
		state: JSON.stringify({ node_id: callbackNonce }),
		jr_gmail: callbackNonce,
	});
	const storage = new Map([['jobradar:gmail:pending', nonce]]);
	let cleanUrl;
	const context = {
		exports: {},
		URL,
		structuredClone,
		crypto: globalThis.crypto,
		window: {
			location: { href: `https://cloud.rocketride.ai/?appid=aidenbuck.jobradar&${params}` },
			history: {
				state: null,
				replaceState(_state, _title, url) {
					cleanUrl = String(url);
				},
			},
		},
		sessionStorage: {
			getItem: (key) => storage.get(key) ?? null,
			setItem: (key, value) => storage.set(key, value),
			removeItem: (key) => storage.delete(key),
		},
		require(name) {
			if (name.includes('email.pipe'))
				return {
					__esModule: true,
					default: JSON.parse(
						readFileSync(new URL('../../apps/jobradar-ui/src/pipelines/email.pipe', import.meta.url))
					),
				};
			if (name.includes('documents')) return { jsonAnswer: (text) => JSON.parse(text) };
			throw Error(`Unexpected import ${name}`);
		},
	};
	const code = readFileSync(new URL('../../apps/jobradar-ui/src/lib/email.ts', import.meta.url), 'utf8');
	vm.runInNewContext(
		ts.transpileModule(code, {
			compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
		}).outputText,
		context
	);
	return { api: context.exports, storage, cleanUrl: () => cleanUrl };
}
test('OAuth callback removes URL secrets and configures only the read-only Gmail task', async () => {
	const { api, storage, cleanUrl } = emailModule();
	let pipeline;
	const token = await api.restoreGmail({
		async use(options) {
			pipeline = options.pipeline;
			return { token: 'running-task' };
		},
		async tool() {
			return { connection_ok: true };
		},
	});
	assert.equal(token, 'running-task');
	assert.ok(!cleanUrl().includes('tokens='));
	assert.ok(!cleanUrl().includes('fixture-access'));
	assert.ok(cleanUrl().includes('appid=aidenbuck.jobradar'));
	assert.equal(storage.size, 1);
	assert.equal(storage.get('jobradar:gmail:task'), 'running-task');
	const gmail = pipeline.components.find((node) => node.provider === 'tool_gmail');
	assert.equal(gmail.config.access, 'readonly');
	assert.equal(JSON.parse(gmail.config.userToken).oauth_server_url, 'https://oauth2.rocketride.ai/refresh');
});
test('an unrelated OAuth callback is cleared and cannot start a Gmail task', async () => {
	const { api, cleanUrl } = emailModule({ callbackNonce: 'different-session' });
	let called = false;
	await assert.rejects(
		api.restoreGmail({
			use() {
				called = true;
			},
		}),
		/verified/
	);
	assert.equal(called, false);
	assert.ok(!cleanUrl().includes('tokens='));
});
test('expired Gmail sessions clear their task handle and ask for reconnection', async () => {
	const { api, storage } = emailModule();
	await assert.rejects(
		api.restoreGmail({
			async use() {
				return { token: 'expired' };
			},
			async tool() {
				throw Error('Task expired');
			},
			async terminate() {},
		}),
		/Reconnect Gmail/
	);
	assert.equal(storage.has('jobradar:gmail:task'), false);
});

const career = await source('career');
const tracked = (extra = {}) => ({
	fp: 'one',
	title: 'Engineer',
	company: 'Example',
	url: 'https://example.com/jobs/1',
	location: 'Remote',
	status: 'saved',
	createdAt: 1,
	updatedAt: 1,
	history: [{ status: 'saved', at: 1 }],
	notes: '',
	...extra,
});
test('manual capture preserves the posting and canonicalizes tracking links safely', () => {
	const job = career.manualJob({
		title: ' Engineer ',
		company: ' Example ',
		url: 'https://example.com/jobs/1?gh_jid=12&utm_source=board#details',
		location: 'Remote',
		description: 'Exact posting text',
	});
	assert.equal(job.title, 'Engineer');
	assert.equal(job.description, 'Exact posting text');
	assert.equal(job.url, 'https://example.com/jobs/1?gh_jid=12#details');
	assert.equal(job.status, 'saved');
	assert.ok(job.fp.startsWith('manual-'));
	for (const url of [
		'javascript:alert(1)',
		'file:///etc/passwd',
		'https://name:password@example.com/job',
		'http://127.0.0.1/job',
	])
		assert.throws(() => career.webUrl(url));
	assert.throws(() =>
		career.manualJob({ title: '', company: 'x', url: 'https://example.com', location: '', description: '' })
	);
});
test('keyword coverage uses aliases and boundaries rather than substring match scores', () => {
	const result = career.keywordCoverage(
		'JavaScript, React.js, C++17, PostgreSQL and AWS are used here.',
		'Built React apps with C++ and Postgres.'
	);
	assert.deepEqual(result.matched, ['C++', 'React', 'PostgreSQL']);
	assert.deepEqual(result.missing, ['JavaScript', 'AWS']);
	assert.equal(result.percent, 60);
	assert.equal(career.keywordCoverage('Nothing technical specified', '').percent, null);
	assert.equal(career.keywordCoverage('We go to the office.', '').total, 0);
	assert.deepEqual(career.keywordCoverage('Build services in Go.', 'Go developer').matched, ['Go']);
});
test('metrics preserve reached stages and do not treat posting closure as a rejection', () => {
	const at = (date) => Date.parse(date) / 1000;
	const items = [
		tracked({ fp: 'a', status: 'applied', appliedAt: at('2026-11-23T12:00:00Z') }),
		tracked({
			fp: 'b',
			status: 'closed',
			appliedAt: at('2026-11-24T12:00:00Z'),
			history: [
				{ status: 'applied', at: 1 },
				{ status: 'interview', at: 2 },
			],
		}),
		tracked({ fp: 'c', status: 'closed', outcome: 'posting_closed', appliedAt: at('2026-11-01T12:00:00Z') }),
		tracked({ fp: 'd', status: 'closed', outcome: 'rejected', appliedAt: at('2026-11-01T12:00:00Z') }),
		tracked({ fp: 'e', status: 'offer' }),
	];
	const metrics = career.searchMetrics(items, new Date('2026-11-25T20:00:00Z'));
	assert.equal(metrics.applied, 4);
	assert.equal(metrics.interviews, 1);
	assert.equal(metrics.offers, 1);
	assert.equal(metrics.responded, 2);
	assert.equal(metrics.responseRate, 50);
	assert.equal(metrics.thisWeek, 2);
	assert.equal(career.searchMetrics([]).responseRate, null);
});
test('tracker CSV quotes user data and neutralizes spreadsheet formula injection', () => {
	const csv = career.trackerCsv([
		tracked({
			company: '=HYPERLINK("https://bad.example")',
			title: 'Role, with comma',
			notes: '\t=1+1\nsecond line',
			appliedAt: 0,
		}),
	]);
	assert.ok(csv.startsWith('\uFEFF'));
	assert.ok(csv.includes('"\'=HYPERLINK(""https://bad.example"")"'));
	assert.ok(csv.includes('"Role, with comma"'));
	assert.ok(csv.includes('"\'\t=1+1\nsecond line"'));
	assert.ok(csv.includes('1969-12-31') || csv.includes('1970-01-01'));
});
test('calendar export uses UTC, escapes event data, and folds UTF-8 lines safely', () => {
	const event = {
		id: 'test-calendar',
		title: 'Technical interview',
		start: '2026-12-01T18:00:00Z',
		minutes: 45,
		location: 'Zoom; room, 2',
		notes: 'First line\nBEGIN:VEVENT\n' + 'Résumé 👋 '.repeat(20),
	};
	const ics = career.interviewCalendar(
		event,
		{ title: 'Engineer', company: 'Example' },
		new Date('2026-11-25T00:00:00Z')
	);
	assert.ok(ics.includes('DTSTART:20261201T180000Z\r\n'));
	assert.ok(ics.includes('DTEND:20261201T184500Z\r\n'));
	assert.ok(ics.includes('LOCATION:Zoom\\; room\\, 2'));
	assert.equal(ics.match(/\r\nBEGIN:VEVENT\r\n/g).length, 1);
	for (const line of ics.split('\r\n')) assert.ok(Buffer.byteLength(line, 'utf8') <= 75);
	assert.throws(() =>
		career.interviewCalendar({ ...event, start: 'invalid' }, { title: 'Engineer', company: 'Example' })
	);
});
test('career edits compose against the newest record instead of overwriting another form', async () => {
	const client = fileClient();
	const store = dataStore(client, 'user');
	await Promise.all([
		store.updateJson('career', (value) => ({ ...career.normalizeCareer(value), weeklyGoal: 9 })),
		store.updateJson('career', (value) => {
			const current = career.normalizeCareer(value);
			return { ...current, contacts: [{ id: 'contact' }, ...current.contacts] };
		}),
	]);
	const value = await store.getJson('career');
	assert.equal(value.weeklyGoal, 9);
	assert.equal(value.contacts.length, 1);
});
test('interview preparation only retains evidence actually present in the resume', () => {
	const answer = JSON.stringify({
		questions: [{ question: 'Tell me about your project.', focus: 'Technical ownership' }],
		stories: [
			{
				headline: 'Real',
				evidence: 'Built a React dashboard used by 200 students.',
				angle: 'Explain your implementation choices.',
			},
			{ headline: 'Invented', evidence: 'Managed 50 engineers at NASA.', angle: 'Leadership' },
		],
		askEmployer: ['What would success look like?'],
	});
	const prep = career.parseInterviewPrep(answer, 'Jordan Lee\nBuilt a React dashboard used by 200 students.');
	assert.equal(prep.questions.length, 1);
	assert.equal(prep.stories.length, 1);
	assert.equal(prep.stories[0].headline, 'Real');
	assert.throws(() => career.parseInterviewPrep('{"questions":[]}', ''));
	assert.equal(career.calendarDate('2026-02-31'), false);
	assert.equal(career.calendarDate('2028-02-29'), true);
});
