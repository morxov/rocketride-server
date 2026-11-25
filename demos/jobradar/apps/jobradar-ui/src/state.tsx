/**
 * Shared app state. The shell renders the sidebar outside the app's React
 * tree, so state lives in a module store both halves subscribe to.
 */

import React, { useCallback, useEffect, useRef, useSyncExternalStore } from 'react';
import type { RocketRideClient } from 'rocketride';
import { useShellConnection } from 'shell';
import type { ScoredJob } from './lib/match';
import { detectClosed, loadUser, markAllSeen, refresh, scoreAll, startSession, touchSession, writeDigest, type Entry, type RefreshResult, type TrackItem, type UserData } from './lib/store';

export type View = 'dashboard' | 'jobs' | 'tracker' | 'assistant' | 'profile' | 'email';

export interface Toast {
	id: number;
	title: string;
	body: string;
	fp?: string;
	variant: 'info' | 'success' | 'warning' | 'error';
}

interface State {
	user: UserData | null;
	since: number;
	entries: Entry[];
	jobs: ScoredJob[];
	result: Omit<RefreshResult, 'entries' | 'closedFps' | 'boardsChecked'> | null;
	refreshing: boolean;
	status: string;
	error: string | null;
	toasts: Toast[];
	closedAlerts: TrackItem[];
	view: View;
	openFp: string | null;
}

let state: State = {
	user: null,
	since: 0,
	entries: [],
	jobs: [],
	result: null,
	refreshing: false,
	status: '',
	error: null,
	toasts: [],
	closedAlerts: [],
	view: 'dashboard',
	openFp: null,
};
const listeners = new Set<() => void>();

function update(patch: Partial<State>) {
	state = { ...state, ...patch };
	listeners.forEach((l) => l());
}
const subscribe = (l: () => void) => {
	listeners.add(l);
	return () => {
		listeners.delete(l);
	};
};
const getState = () => state;

let toastId = 0;
export function toast(t: Omit<Toast, 'id'>, ms = 9000) {
	const id = ++toastId;
	update({ toasts: [...state.toasts, { ...t, id }].slice(-4) });
	setTimeout(() => update({ toasts: state.toasts.filter((x) => x.id !== id) }), ms);
}
export const dismissToast = (id: number) => update({ toasts: state.toasts.filter((x) => x.id !== id) });

function rescore(user = state.user, since = state.since) {
	if (!user) return;
	update({ user, since, jobs: scoreAll(state.entries, user, since) });
}

// =============================================================================
// ACTIONS
// =============================================================================

let booted = false;
let refreshing = false;

async function doRefresh(client: RocketRideClient, opts: { quiet?: boolean } = {}) {
	if (refreshing || !state.user) return;
	refreshing = true;
	update({ refreshing: true, status: 'Checking job sources...', error: null });
	try {
		const user = state.user;
		const r = await refresh(client, user);
		const { entries, closedFps: _c, boardsChecked: _b, ...rest } = r;
		state.entries = entries;
		// First scan ever: there is no "last visit" worth comparing to, so show the last 3 days as new.
		if (r.firstRun) state.since = Math.min(state.since, Math.floor(Date.now() / 1000) - 3 * 86400);
		const jobs = scoreAll(entries, user, state.since);
		const fresh = jobs.filter((j) => r.brandNew.has(j.fp) && j.score >= user.prefs.minScore);
		const { closed, reopened } = await detectClosed(client, user, r);
		const changed = [...closed, ...reopened];
		const tracker = changed.length ? user.tracker.map((t) => changed.find((c) => c.fp === t.fp) ?? t) : user.tracker;
		void touchSession(client, state.since).catch(() => undefined);
		const nextUser = { ...user, tracker };
		update({ user: nextUser, since: state.since, jobs, result: rest, closedAlerts: [...closed, ...state.closedAlerts.filter((a) => !reopened.some((o) => o.fp === a.fp))].slice(0, 5), status: '' });
		await writeDigest(client, nextUser, jobs, r.stats);

		if (fresh.length) {
			const top = fresh[0];
			toast({ variant: 'success', title: fresh.length === 1 ? 'New match' : `${fresh.length} new matches`, body: `${top.title} at ${top.company} (score ${top.score})${fresh.length > 1 ? ` and ${fresh.length - 1} more` : ''}`, fp: top.fp }, 15000);
		} else if (!opts.quiet) {
			toast({ variant: 'info', title: 'Up to date', body: `Checked ${r.scanned.toLocaleString()} postings. Nothing new since the last check.` }, 5000);
		}
		for (const c of closed) toast({ variant: 'warning', title: 'Posting closed', body: `${c.title} at ${c.company} is no longer listed.`, fp: c.fp }, 15000);
		if (r.errors.length) toast({ variant: 'warning', title: 'Some sources failed', body: r.errors.slice(0, 2).join('; ') }, 10000);
	} catch (e) {
		update({ error: e instanceof Error ? e.message : String(e), status: '' });
	} finally {
		refreshing = false;
		update({ refreshing: false });
	}
}

async function boot(client: RocketRideClient) {
	if (booted) return;
	booted = true;
	update({ status: 'Loading your data from your workspace...' });
	try {
		const [user, since] = await Promise.all([loadUser(client), startSession(client)]);
		update({ user, since, status: '' });
		if (user.profile) await doRefresh(client, { quiet: true });
		else update({ view: 'profile' });
	} catch (e) {
		booted = false;
		update({ error: e instanceof Error ? e.message : String(e), status: '' });
	}
}

async function reloadUser(client: RocketRideClient) {
	const user = await loadUser(client);
	rescore(user);
}

// =============================================================================
// HOOK
// =============================================================================

export function useApp() {
	const { client, isConnected } = useShellConnection();
	const s = useSyncExternalStore(subscribe, getState);
	const c = client as unknown as RocketRideClient | null;
	return {
		...s,
		client: c,
		isConnected,
		setView: (view: View) => update({ view }),
		openJob: (fp: string | null) => update({ openFp: fp }),
		refreshNow: useCallback(() => (c ? doRefresh(c) : Promise.resolve()), [c]),
		reloadUser: useCallback(() => (c ? reloadUser(c) : Promise.resolve()), [c]),
		/** Apply a local change to user data and rescore immediately (the file-store write is done by the caller). */
		patchUser: (fn: (u: UserData) => UserData) => state.user && rescore(fn(state.user)),
		markAllSeen: useCallback(async () => {
			if (!c) return;
			const since = await markAllSeen(c);
			rescore(state.user, since);
		}, [c]),
		setSince: (since: number) => rescore(state.user, since),
		dismissClosed: (fp?: string) => update({ closedAlerts: fp ? state.closedAlerts.filter((a) => a.fp !== fp) : [] }),
	};
}

const POLL_MS = 10 * 60 * 1000;

/** Mount once: boots the app, then re-checks sources every 10 minutes while open. */
export const Poller: React.FC = () => {
	// Older cloud shells expose a structural client type. Its public calls are the same.
	const { client: shellClient, isConnected } = useShellConnection();
	const client = shellClient as unknown as RocketRideClient | null;
	const timer = useRef<ReturnType<typeof setInterval> | null>(null);
	useEffect(() => {
		if (!client || !isConnected) return;
		void boot(client);
		timer.current = setInterval(() => void doRefresh(client, { quiet: true }), POLL_MS);
		return () => {
			if (timer.current) clearInterval(timer.current);
		};
	}, [client, isConnected]);
	return null;
};
