/**
 * Approvals: proposed changes waiting for a person. Each one is a Redis key
 * with an expiry, so the countdown here is Redis's own TTL.
 */

import React, { useEffect, useState } from 'react';
import { Banner, Button, Card, ConfirmDialog, ContentHeader, EmptyState, StatusBadge } from 'shell';
import { approve, extend, formatDuration, reject, type PendingChange } from '../lib/guard';
import { PENDING_TTL, keys } from '../lib/keys';
import { useGuard } from '../state';
import { shared } from '../ui';

const styles: Record<string, React.CSSProperties> = {
	item: { display: 'flex', gap: 16, alignItems: 'flex-start', justifyContent: 'space-between', padding: '14px 16px', borderBottom: '1px solid var(--rr-border)', flexWrap: 'wrap' },
	summary: { fontSize: 14, fontWeight: 600 },
	meta: { fontSize: 12, color: 'var(--rr-text-secondary)', marginTop: 4, lineHeight: 1.5 },
	buttons: { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' },
};

function clock(seconds: number): string {
	const s = Math.max(0, seconds);
	return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export const Approvals: React.FC = () => {
	const { client, actor, snapshot, refresh } = useGuard();
	const [confirming, setConfirming] = useState<PendingChange | null>(null);
	const [busy, setBusy] = useState(false);
	const [notice, setNotice] = useState<{ variant: 'info' | 'warning' | 'error'; text: string } | null>(null);
	const [, tick] = useState(0);

	// Count down locally between polls; each poll re-syncs with Redis's TTL.
	useEffect(() => {
		const timer = setInterval(() => tick((n) => n + 1), 1000);
		return () => clearInterval(timer);
	}, []);

	const pending = snapshot?.pending ?? [];
	const elapsed = snapshot ? Math.floor((Date.now() - snapshot.loadedAt) / 1000) : 0;

	const run = async (work: () => Promise<{ variant: 'info' | 'warning' | 'error'; text: string }>) => {
		if (busy) return;
		setBusy(true);
		try {
			setNotice(await work());
		} catch (e) {
			setNotice({ variant: 'error', text: e instanceof Error ? e.message : String(e) });
		} finally {
			setBusy(false);
			await refresh();
		}
	};

	const doApprove = (change: PendingChange) =>
		run(async () => {
			const r = await approve(client!, actor, change.id);
			return { variant: r.outcome === 'applied' ? 'info' : 'warning', text: r.detail };
		});

	const doReject = (change: PendingChange) =>
		run(async () => {
			const removed = await reject(client!, actor, change);
			return removed
				? { variant: 'info', text: `Rejected: ${change.summary}. Nothing was changed.` }
				: { variant: 'warning', text: 'That proposal was already gone: it expired or someone else handled it.' };
		});

	const doExtend = (change: PendingChange) =>
		run(async () => {
			const ok = await extend(client!, actor, keys.pending(change.id), PENDING_TTL, `Gave proposal ${change.id} another hour: ${change.summary}`);
			return ok ? { variant: 'info', text: 'The proposal now expires 1 hour from now.' } : { variant: 'warning', text: 'That proposal had already expired.' };
		});

	return (
		<div style={shared.page}>
			<ContentHeader title="Approvals" subtitle="Changes proposed in the app. Nothing is written to a customer's controls until someone approves it here." />
			<div style={shared.stack}>
				{snapshot && !snapshot.applyEnabled && <Banner variant="warning">Applying changes is switched off on the Setup screen. Approvals are recorded as dry runs and nothing is written.</Banner>}
				{notice && <Banner variant={notice.variant}>{notice.text}</Banner>}
				<Card header={`Waiting for approval (${pending.length})`} noBodyPadding>
					{pending.length === 0 ? (
						<EmptyState title="Nothing waiting" description="Open a customer and propose a budget change, an off switch or a cheaper model." />
					) : (
						pending.map((p) => {
							const left = p.ttl - elapsed;
							return (
								<div key={p.id} style={styles.item}>
									<div>
										<div style={styles.summary}>{p.summary}</div>
										<div style={styles.meta}>
											Proposed by {p.proposedBy} at {new Date(p.proposedAt).toLocaleTimeString()}
											{p.reason ? ` · Reason: ${p.reason}` : ''}
											<br />
											<span style={shared.mono}>pending:{p.id}</span>
										</div>
									</div>
									<div style={styles.buttons}>
										<StatusBadge variant={left < 300 ? 'warning' : 'muted'}>Expires in {clock(left)}</StatusBadge>
										<Button variant="ghost" small disabled={busy} onClick={() => void doExtend(p)} title="Redis EXPIRE: restart the countdown at 1 hour">
											Extend
										</Button>
										<Button variant="secondary" small disabled={busy} onClick={() => void doReject(p)}>
											Reject
										</Button>
										<Button small disabled={busy} onClick={() => setConfirming(p)}>
											Approve
										</Button>
									</div>
								</div>
							);
						})
					)}
				</Card>
				<div style={shared.muted}>
					Approving claims a one-time lock key before writing, so a change is applied once even if two people approve it at the same moment. Proposals nobody approves are removed by Redis when their {formatDuration(PENDING_TTL)} expiry passes.
				</div>
			</div>

			{confirming && (
				<ConfirmDialog
					title="Approve this change?"
					message={confirming.summary}
					confirmLabel="Approve and apply"
					onConfirm={() => {
						const change = confirming;
						setConfirming(null);
						void doApprove(change);
					}}
					onCancel={() => setConfirming(null)}
				/>
			)}
		</div>
	);
};
