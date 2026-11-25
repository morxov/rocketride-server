// =============================================================================
// MIT License
// Copyright (c) 2026 Aparavi Software AG
// =============================================================================

/**
 * JobRadar — a job-search dashboard that surfaces what is new and worth your
 * time: merged duplicates, freshness and ghost checks, a tracker with
 * follow-ups, and a Gemini assistant over your own data in the file store.
 */

import React from 'react';
import type { ShellAppProps } from 'shell';
import { AppLayout, Banner } from 'shell';
import { Assistant } from './screens/Assistant';
import { Dashboard } from './screens/Dashboard';
import { JobPanel } from './screens/JobPanel';
import { Jobs } from './screens/Jobs';
import { Profile } from './screens/Profile';
import { Email } from './screens/Email';
import { Tracker } from './screens/Tracker';
import { localDate } from './lib/store';
import { Poller, useApp, type View } from './state';
import { Toasts } from './ui';
import { Brand, Icon, type IconName } from './icons';
import './design.css';

const styles: Record<string, React.CSSProperties> = {
	content: { position: 'relative', height: '100%', overflow: 'hidden', display: 'flex', flexDirection: 'column', background: 'var(--rr-bg-default)' },
	status: { fontSize: 12, color: 'var(--rr-text-secondary)' },
};

const TopNav: React.FC = () => {
	const { view, setView, jobs, user, openJob } = useApp();
	const min = user?.prefs.minScore ?? 45;
	const fresh = user ? jobs.filter((j) => j.flags.includes('new') && j.score >= min && !user.hidden.has(j.fp)).length : 0;
	const todayIso = localDate();
	const due = user?.reminders.filter((r) => r.due <= todayIso).length ?? 0;
	const entries: { id: View; label: string; icon: IconName; count?: number }[] = [
		{ id: 'dashboard', label: 'Home', icon: 'dashboard' },
		{ id: 'jobs', label: 'Job Matches', icon: 'jobs', count: fresh },
		{ id: 'tracker', label: 'Job Tracker', icon: 'tracker', count: due },
		{ id: 'assistant', label: 'Assistant', icon: 'assistant' },
		{ id: 'email', label: 'Email', icon: 'mail' },
		{ id: 'profile', label: 'Profile', icon: 'profile' },
	];
	return (
		<header className="jr-topbar">
			<button
				type="button"
				className="jr-home"
				aria-label="JobRadar home"
				onClick={() => {
					openJob(null);
					setView('dashboard');
				}}
			>
				<Brand />
			</button>
			<nav className="jr-topnav" aria-label="JobRadar">
				{entries.map((entry) => (
					<button
						key={entry.id}
						type="button"
						className="jr-nav-button"
						aria-current={view === entry.id ? 'page' : undefined}
						onClick={() => {
							openJob(null);
							setView(entry.id);
						}}
					>
						<Icon name={entry.icon} size={17} />
						<span>{entry.label}</span>
						{!!entry.count && <span className="jr-nav-count">{entry.count}</span>}
					</button>
				))}
			</nav>
			<button
				type="button"
				className="jr-avatar"
				aria-label="Open your profile"
				onClick={() => {
					openJob(null);
					setView('profile');
				}}
			>
				{user?.profile?.name
					?.split(/\s+/)
					.slice(0, 2)
					.map((w) => w[0])
					.join('') || 'JR'}
			</button>
		</header>
	);
};

const StatusSlot: React.FC = () => {
	const { refreshing, status } = useApp();
	return <span style={styles.status}>{refreshing ? status || 'Checking sources...' : ''}</span>;
};

const Content: React.FC = () => {
	const { client, isConnected, view, toasts, openJob } = useApp();
	return (
		<div className="jr-app" style={styles.content}>
			<TopNav />
			<div className="jr-content">
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
				<div style={{ height: '100%', display: view === 'email' ? 'block' : 'none' }}><Email /></div>
				{view !== 'jobs' && <JobPanel />}
				<Toasts toasts={toasts} onOpen={(fp) => openJob(fp)} />
			</div>
		</div>
	);
};

const App: React.FC<ShellAppProps> = () => (
	<AppLayout status={<StatusSlot />}>
		<Poller />
		<Content />
	</AppLayout>
);

export default App;
