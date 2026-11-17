/**
 * Shared live state: one poll of Redis feeds every screen.
 *
 * The shell renders the `sidebar` node outside the app's own React tree, so
 * a React context would not reach it. State lives in a module-level store
 * that both the sidebar and the content subscribe to.
 */

import React, { useCallback, useSyncExternalStore } from 'react';
import type { RocketRideClient } from 'rocketride';
import { useAuthUser, usePolling, useShellConnection } from 'shell';
import { fireAlerts, loadSnapshot, writeRollup, type FiredAlert, type Snapshot } from './lib/guard';

export type View = 'overview' | 'approvals' | 'audit' | 'advisor' | 'setup';

// =============================================================================
// STORE
// =============================================================================

interface StoreState {
	snapshot: Snapshot | null;
	error: string | null;
	/** Budget alerts recorded during this session, newest first. */
	alerts: FiredAlert[];
	view: View;
	/** Customer whose detail page is open, or null for the list. */
	customerId: string | null;
}

let state: StoreState = { snapshot: null, error: null, alerts: [], view: 'overview', customerId: null };
const listeners = new Set<() => void>();

function update(patch: Partial<StoreState>): void {
	state = { ...state, ...patch };
	listeners.forEach((notify) => notify());
}

const subscribe = (notify: () => void) => {
	listeners.add(notify);
	return () => {
		listeners.delete(notify);
	};
};
const getState = () => state;

let inflight: Promise<void> | null = null;
let queued: Promise<void> | null = null;

/** Read the live picture from Redis, record new alerts, refresh the rollup. */
async function readOnce(client: RocketRideClient): Promise<void> {
	try {
		const next = await loadSnapshot(client);
		const fired = await fireAlerts(client, next);
		update({ snapshot: next, error: null, alerts: fired.length ? [...fired.reverse(), ...state.alerts].slice(0, 6) : state.alerts });
		await writeRollup(client, next);
	} catch (e) {
		update({ error: e instanceof Error ? e.message : String(e) });
	}
}

/**
 * Refresh the store. If a read is already running it may have started before
 * the caller's write, so queue exactly one more read after it and resolve
 * when that one is done. Callers that just wrote always see their change.
 */
function refreshFrom(client: RocketRideClient | null, isConnected: boolean): Promise<void> {
	if (!client || !isConnected) return Promise.resolve();
	if (!inflight) {
		inflight = readOnce(client).finally(() => {
			inflight = null;
		});
		return inflight;
	}
	if (!queued) {
		queued = inflight.then(() => {
			queued = null;
			return refreshFrom(client, isConnected);
		});
	}
	return queued;
}

const setView = (view: View) => update({ view, customerId: null });
const openCustomer = (customerId: string | null) => update(customerId ? { customerId, view: 'overview' } : { customerId: null });
const dismissAlerts = () => update({ alerts: [] });

// =============================================================================
// HOOKS
// =============================================================================

export function useGuard() {
	const { client, isConnected } = useShellConnection();
	const user = useAuthUser();
	const store = useSyncExternalStore(subscribe, getState);
	const refresh = useCallback(() => refreshFrom(client, isConnected), [client, isConnected]);
	return {
		...store,
		client,
		isConnected,
		/** Name written to the audit log for actions taken in this session. */
		actor: user?.displayName || user?.email || 'local reviewer',
		refresh,
		setView,
		openCustomer,
		dismissAlerts,
	};
}

/** Mount exactly once (in the content area) to drive the 3-second poll. */
export const GuardPoller: React.FC = () => {
	const { client, isConnected } = useShellConnection();
	const poll = useCallback(() => refreshFrom(client, isConnected), [client, isConnected]);
	usePolling(poll, 3000);
	return null;
};
