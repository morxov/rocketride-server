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
