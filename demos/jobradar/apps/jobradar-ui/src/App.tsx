// =============================================================================
// MIT License
// Copyright (c) 2026 Aparavi Software AG
// =============================================================================

/**
 * JobRadar — a job-search dashboard that surfaces what is new and worth your
 * time: merged duplicates, freshness and ghost checks, a tracker with
 * follow-ups, and a Gemini assistant over your own data in Redis.
 */

import React from 'react';
import type { ShellAppProps } from 'shell';
import { AppLayout, Banner, SidebarMenu } from 'shell';
import { Assistant } from './screens/Assistant';
import { Dashboard } from './screens/Dashboard';
import { JobPanel } from './screens/JobPanel';
import { Jobs } from './screens/Jobs';
import { Profile } from './screens/Profile';
import { Tracker } from './screens/Tracker';
import { localDate } from './lib/store';
import { Poller, useApp, type View } from './state';
import { Toasts } from './ui';

const styles: Record<string, React.CSSProperties> = {
	nav: { padding: '10px 8px' },
	content: { position: 'relative', height: '100%', overflow: 'hidden', background: 'var(--rr-bg-default)' },
	status: { fontSize: 12, color: 'var(--rr-text-secondary)' },
};

const SidebarNav: React.FC = () => {
	const { view, setView, jobs, user } = useApp();
	const min = user?.prefs.minScore ?? 45;
	const fresh = user ? jobs.filter((j) => j.flags.includes('new') && j.score >= min && !user.hidden.has(j.fp)).length : 0;
	const todayIso = localDate();
	const due = user?.reminders.filter((r) => r.due <= todayIso).length ?? 0;
	const menu = {
		entries: [
			{ id: 'dashboard', label: 'Dashboard' },
			{ id: 'jobs', label: 'Jobs', count: fresh || undefined },
			{ id: 'tracker', label: 'Tracker', count: due || undefined, severity: due ? ('error' as const) : undefined },
			{ id: 'assistant', label: 'Assistant' },
			{ id: 'profile', label: 'Profile and sources' },
		],
	};
	return (
		<div style={styles.nav}>
			<SidebarMenu menu={menu} activeId={view} onSelect={(id) => setView(id as View)} />
		</div>
	);
};

const StatusSlot: React.FC = () => {
	const { refreshing, status } = useApp();
	return <span style={styles.status}>{refreshing ? status || 'Checking sources...' : ''}</span>;
};

const Content: React.FC = () => {
	const { client, isConnected, view, toasts, openJob } = useApp();
	return (
		<div style={styles.content}>
			{client && !isConnected && (
				<div style={{ padding: 16 }}>
					<Banner variant="warning">Not connected to the RocketRide engine. JobRadar resumes when the connection returns.</Banner>
				</div>
			)}
			<div style={{ height: '100%', display: view === 'dashboard' ? 'block' : 'none' }}>
				<Dashboard />
			</div>
			{view === 'jobs' && <Jobs />}
			{view === 'tracker' && <Tracker />}
			<div style={{ height: '100%', display: view === 'assistant' ? 'block' : 'none' }}>
				<Assistant />
			</div>
			{view === 'profile' && <Profile />}
			<JobPanel />
			<Toasts toasts={toasts} onOpen={(fp) => openJob(fp)} />
		</div>
	);
};

const App: React.FC<ShellAppProps> = () => (
	<AppLayout sidebar={<SidebarNav />} status={<StatusSlot />}>
		<Poller />
		<Content />
	</AppLayout>
);

export default App;
