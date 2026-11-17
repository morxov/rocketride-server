/**
 * Audit log: every proposal, approval, rejection, applied change and alert,
 * read from Postgres through the db_postgres node.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { Banner, Button, Card, ContentHeader, EmptyState, StatusBadge } from 'shell';
import { loadAudit, type AuditRow } from '../lib/guard';
import { useGuard } from '../state';
import { shared } from '../ui';

type Variant = 'success' | 'info' | 'warning' | 'error' | 'muted';

const EVENT_VARIANT: Record<string, Variant> = {
	proposed: 'info',
	approved: 'success',
	applied: 'success',
	rejected: 'muted',
	expired: 'warning',
	dry_run: 'warning',
	failed: 'error',
	alert: 'warning',
	extended: 'muted',
	setting: 'muted',
	demo_reset: 'muted',
};

export const Audit: React.FC = () => {
	const { client, isConnected, snapshot } = useGuard();
	const [rows, setRows] = useState<AuditRow[] | null>(null);
	const [error, setError] = useState<string | null>(null);

	const load = useCallback(async () => {
		if (!client || !isConnected) return;
		try {
			setRows(await loadAudit(client));
			setError(null);
		} catch (e) {
			setError(e instanceof Error ? e.message : String(e));
		}
	}, [client, isConnected]);

	// Reload whenever the live snapshot changes hands (every poll is too often
	// to matter; pending count and key count change when something happened).
	const stamp = `${snapshot?.pending.length ?? 0}:${snapshot?.keyCount ?? 0}`;
	useEffect(() => {
		void load();
	}, [load, stamp]);

	return (
		<div style={shared.page}>
			<ContentHeader
				title="Audit log"
				subtitle="Who proposed, approved or rejected what, and what was written to Redis. Stored in Postgres, newest first."
				actions={
					<Button variant="secondary" small onClick={() => void load()}>
						Refresh
					</Button>
				}
			/>
			<div style={shared.stack}>
				{error && <Banner variant="error">{error}</Banner>}
				<Card header={rows ? `Last ${rows.length} events` : 'Events'} noBodyPadding>
					{!rows || rows.length === 0 ? (
						<EmptyState title={rows ? 'No events yet' : 'Loading'} description="Events appear here as soon as something is proposed, approved or alerted." />
					) : (
						<table style={shared.table}>
							<thead>
								<tr>
									<th style={shared.th}>Time</th>
									<th style={shared.th}>Event</th>
									<th style={shared.th}>Who</th>
									<th style={shared.th}>What</th>
									<th style={shared.th}>Change id</th>
								</tr>
							</thead>
							<tbody>
								{rows.map((r) => (
									<tr key={r.id}>
										<td style={{ ...shared.td, whiteSpace: 'nowrap' }}>{new Date(r.at).toLocaleTimeString()}</td>
										<td style={shared.td}>
											<StatusBadge variant={EVENT_VARIANT[r.event] ?? 'muted'}>{r.event.replace('_', ' ')}</StatusBadge>
										</td>
										<td style={shared.td}>{r.actor}</td>
										<td style={shared.td}>{r.summary}</td>
										<td style={{ ...shared.td, ...shared.mono }}>{r.action_id ?? ''}</td>
									</tr>
								))}
							</tbody>
						</table>
					)}
				</Card>
			</div>
		</div>
	);
};
