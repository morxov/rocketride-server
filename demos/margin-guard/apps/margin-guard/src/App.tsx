// =============================================================================
// MIT License
// Copyright (c) 2026 Aparavi Software AG
// =============================================================================

/**
 * AI Margin Guard — root rendered by the RocketRide shell.
 *
 * A console over Redis: the customer's backend writes usage counters, this
 * app reads them through the tool_redis node, and every change a person
 * makes goes through propose -> approve -> apply once.
 */

import React from 'react';
import { AppLayout, Banner, SidebarMenu } from 'shell';
import { Advisor } from './screens/Advisor';
import { Approvals } from './screens/Approvals';
import { Audit } from './screens/Audit';
import { Customer } from './screens/Customer';
import { Overview } from './screens/Overview';
import { Setup } from './screens/Setup';
import { GuardPoller, useGuard, type View } from './state';
import { shared } from './ui';

// =============================================================================
// STYLES
// =============================================================================

const styles: Record<string, React.CSSProperties> = {
	nav: { padding: '10px 8px' },
	content: { height: '100%', overflowY: 'auto', background: 'var(--rr-bg-default)' },
	contentFill: { height: '100%', overflow: 'hidden', background: 'var(--rr-bg-default)' },
};

// =============================================================================
// COMPONENT
// =============================================================================

const SidebarNav: React.FC = () => {
	const { view, setView, snapshot } = useGuard();
	const menu = {
		entries: [
			{ id: 'overview', label: 'Overview' },
			{ id: 'approvals', label: 'Approvals', count: snapshot?.pending.length || undefined },
			{ id: 'audit', label: 'Audit log' },
			{ id: 'advisor', label: 'Advisor' },
			{ id: 'setup', label: 'Setup' },
		],
	};
	return (
		<div style={styles.nav}>
			<SidebarMenu menu={menu} activeId={view} onSelect={(id) => setView(id as View)} />
		</div>
	);
};

const Content: React.FC = () => {
	const { client, isConnected, view, customerId, snapshot } = useGuard();

	// `client === null` means not known yet, which is different from offline.
	if (client && !isConnected) {
		return (
			<div style={shared.page}>
				<Banner variant="warning">Not connected to the RocketRide engine. The dashboard resumes when the connection returns.</Banner>
			</div>
		);
	}

	if (view === 'advisor') {
		return (
			<div style={styles.contentFill}>
				<Advisor />
			</div>
		);
	}

	const customer = customerId ? snapshot?.customers.find((c) => c.id === customerId) : undefined;
	return (
		<div style={styles.content}>
			{view === 'overview' && (customer ? <Customer key={customer.id} customer={customer} /> : <Overview />)}
			{view === 'approvals' && <Approvals />}
			{view === 'audit' && <Audit />}
			{view === 'setup' && <Setup />}
		</div>
	);
};

/**
 * Root view — AppLayout declares the frame; GuardPoller polls Redis once
 * for every screen.
 */
const App: React.FC = () => (
	<AppLayout sidebar={<SidebarNav />} showStatus>
		<GuardPoller />
		<Content />
	</AppLayout>
);

export default App;
