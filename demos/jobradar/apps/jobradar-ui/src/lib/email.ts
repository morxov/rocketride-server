/** Gmail access is exclusively through RocketRide's read-only tool_gmail node. */
import type { PipelineConfig, RocketRideClient } from 'rocketride';
import emailPipe from '../pipelines/email.pipe';
import { jsonAnswer } from './documents';
import type { Status, TrackItem } from './store';

const BROKER = 'https://oauth2.rocketride.ai';
const TASK_KEY = 'jobradar:gmail:task';
const PENDING_KEY = 'jobradar:gmail:pending';
export interface MailMessage {
	id: string;
	threadId?: string;
	snippet?: string;
	internalDate?: string;
	headers?: Record<string, string>;
}
export interface MailAnalysis {
	summary: string;
	suggested_status: Status | null;
	reason: string;
}
let callbackToken: string | null = null;
let callbackError = '';

/** Capture and remove credentials immediately when the app module loads. */
function captureCallback() {
	const url = new URL(window.location.href);
	const raw = url.searchParams.get('tokens');
	const oauthError = url.searchParams.get('oauth_error');
	if (!raw && !oauthError) return;
	const nonce = sessionStorage.getItem(PENDING_KEY);
	try {
		if (!nonce || url.searchParams.get('jr_gmail') !== nonce) throw new Error('Google sign-in could not be verified. Please connect again.');
		if (oauthError) throw new Error('Google sign-in was cancelled or denied. You can try again.');
		const state = JSON.parse(url.searchParams.get('state') || '{}') as Record<string, unknown>;
		if (state.node_id && state.node_id !== nonce) throw new Error('Google sign-in did not match this connection.');
		const tokens = JSON.parse(raw || '{}') as Record<string, unknown>;
		if (typeof tokens.access_token !== 'string' || !tokens.access_token) throw new Error('Google did not return a usable token. Please connect again.');
		callbackToken = JSON.stringify({ access_token: tokens.access_token, refresh_token: tokens.refresh_token, scope: tokens.scope, token_type: 'Bearer', expiry_date: tokens.expiry_date, oauth_server_url: `${BROKER}/refresh` });
	} catch (e) {
		callbackError = e instanceof Error ? e.message : 'Google sign-in failed.';
	} finally {
		for (const key of ['tokens', 'state', 'oauth_error', 'jr_gmail']) url.searchParams.delete(key);
		window.history.replaceState(window.history.state, '', url);
		sessionStorage.removeItem(PENDING_KEY);
	}
}
captureCallback();

export function startGmailConnection() {
	const nonce = crypto.randomUUID();
	sessionStorage.setItem(PENDING_KEY, nonce);
	const back = new URL(window.location.href);
	back.searchParams.set('jr_gmail', nonce);
	const url = new URL(`${BROKER}/google`);
	url.searchParams.set('service', JSON.stringify({ type: 'tool_gmail', authType: 'user', access: 'readonly' }));
	url.searchParams.set('type', 'user');
	url.searchParams.set('node_id', nonce);
	url.searchParams.set('baseURL', back.toString());
	url.searchParams.set('scope', 'https://www.googleapis.com/auth/gmail.readonly');
	window.location.assign(url);
}

async function call<T>(client: RocketRideClient, token: string, tool: string, input: Record<string, unknown> = {}): Promise<T> {
	const result = await client.tool<T & { success?: boolean; error?: string }>({ token, nodeId: 'gmail_1', tool, input, timeout: 30000 });
	if (result.success === false || result.error) throw new Error(result.error || 'Gmail could not complete the request.');
	return result;
}

export async function restoreGmail(client: RocketRideClient): Promise<string | null> {
	if (callbackError) {
		const message = callbackError;
		callbackError = '';
		throw new Error(message);
	}
	let token = sessionStorage.getItem(TASK_KEY);
	let created = false;
	if (callbackToken) {
		const credential = callbackToken;
		callbackToken = null;
		const pipeline = structuredClone(emailPipe) as unknown as PipelineConfig;
		pipeline.project_id = crypto.randomUUID();
		const gmail = pipeline.components.find((node) => node.provider === 'tool_gmail');
		if (!gmail) throw new Error('The Gmail node is missing from the email pipeline.');
		gmail.config = { ...gmail.config, userToken: credential };
		const started = await client.use({ pipeline, useExisting: false, ttl: 3600, name: 'JobRadar Gmail (read only)' });
		token = started.token;
		created = true;
	}
	if (!token) return null;
	try {
		const status = await call<{ connection_ok: boolean; error?: string }>(client, token, 'check_connection');
		if (status.connection_ok !== true) throw new Error(status.error || 'Gmail is not connected. Please reconnect your Google account.');
		sessionStorage.setItem(TASK_KEY, token);
		return token;
	} catch (e) {
		sessionStorage.removeItem(TASK_KEY);
		if (created) await client.terminate(token).catch(() => undefined);
		throw new Error(`Reconnect Gmail to continue. ${e instanceof Error ? e.message : ''}`);
	}
}

/** Local engines may receive an OAuth credential out of band in their .env. */
export async function connectConfiguredGmail(client: RocketRideClient): Promise<string> {
	const pipeline = { ...emailPipe, project_id: crypto.randomUUID() } as unknown as PipelineConfig;
	let token: string | null = null;
	try {
		const started = await client.use({ pipeline, useExisting: false, ttl: 3600, name: 'JobRadar configured Gmail (read only)' });
		token = started.token;
		const status = await call<{ connection_ok: boolean }>(client, token, 'check_connection');
		if (status.connection_ok !== true) throw new Error('Not connected');
		sessionStorage.setItem(TASK_KEY, token);
		return token;
	} catch {
		if (token) await client.terminate(token).catch(() => undefined);
		throw new Error('No configured Gmail connection was found on this engine. Open cloud JobRadar to sign in with Google, or follow the local Gmail setup in the README.');
	}
}

export async function disconnectGmail(client: RocketRideClient, token: string) {
	await client.terminate(token);
	sessionStorage.removeItem(TASK_KEY);
}

export async function searchMail(client: RocketRideClient, token: string, query: string): Promise<MailMessage[]> {
	const list = await call<{ messages?: { id: string }[] }>(client, token, 'message_search', { query, maxResults: 25 });
	const refs = list.messages ?? [];
	const out: MailMessage[] = [];
	// Keep the node's HTTP transport and Google's quota within a small bound.
	for (let i = 0; i < refs.length; i += 4) out.push(...(await Promise.all(refs.slice(i, i + 4).map((ref) => call<MailMessage>(client, token, 'message_get', { id: ref.id, format: 'metadata' })))));
	return out;
}

export async function readMail(client: RocketRideClient, token: string, id: string): Promise<string> {
	const body = await call<{ text?: string; snippet?: string }>(client, token, 'message_get_body', { id });
	return String(body.text || body.snippet || 'This message has no plain-text preview. Open it in Gmail to read the full message.');
}

export function possibleApplications(message: MailMessage, tracker: TrackItem[]): TrackItem[] {
	const text = `${message.headers?.from ?? ''} ${message.headers?.subject ?? ''} ${message.snippet ?? ''}`.toLowerCase();
	return tracker.filter((item) => {
		const company = item.company
			.toLowerCase()
			.replace(/\b(inc|llc|ltd|corporation)\b\.?/g, '')
			.trim();
		return company.length >= 3 && text.includes(company);
	});
}

export function readMailAnalysis(answer: string): MailAnalysis {
	const result = jsonAnswer(answer);
	const statuses: Status[] = ['applied', 'assessment', 'interview', 'offer', 'closed'];
	return { summary: String(result.summary ?? '').slice(0, 1200), reason: String(result.reason ?? '').slice(0, 1200), suggested_status: statuses.includes(result.suggested_status as Status) ? (result.suggested_status as Status) : null };
}
