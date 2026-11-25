/**
 * Tracker: a board of every job you are pursuing, plus follow-ups and notes.
 */

import React, { useState } from 'react';
import { Button, ConfirmDialog, EmptyState, StatusBadge } from 'shell';
import { useJobActions } from '../actions';
import { JobCapture } from './CareerForms';
import { downloadFile, trackerCsv } from '../lib/career';
import { ago } from '../lib/match';
import { STATUSES, dismissReminder, snoozeReminder, type Reminder, type TrackItem, localDate } from '../lib/store';
import { toast, useApp } from '../state';
import { Panel as Card, PageHeader as ContentHeader, s } from '../ui';

const tk: Record<string, React.CSSProperties> = {
	board: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 170px), 1fr))', gap: 14, paddingBottom: 6 },
	col: { background: 'var(--rr-bg-surface-alt)', border: '1px solid var(--rr-border)', borderRadius: 12, padding: 12, display: 'flex', flexDirection: 'column', gap: 10, minHeight: 220 },
	colHead: { display: 'flex', justifyContent: 'space-between', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--rr-text-secondary)', padding: '2px 4px' },
	card: { background: 'var(--rr-bg-paper)', border: '1px solid var(--rr-border)', borderRadius: 9, padding: '13px', cursor: 'pointer' },
	cardTitle: { fontSize: 12.5, fontWeight: 600, lineHeight: 1.3 },
	cardMeta: { fontSize: 11.5, color: 'var(--rr-text-secondary)', marginTop: 2 },
	cardRow: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 6, gap: 4 },
	move: { display: 'flex', gap: 2 },
};

export const Tracker: React.FC = () => {
	const app = useApp();
	const { setStatus, remove } = useJobActions();
	const { user, client } = app;
	const [adding, setAdding] = useState(false);
	const [removing, setRemoving] = useState<TrackItem | null>(null);
	if (!user || !client) return null;

	const todayIso = localDate();
	const reminderFor = (fp: string) => user.reminders.find((r) => r.fp === fp);

	const move = (t: TrackItem, dir: -1 | 1) => {
		const i = STATUSES.findIndex((x) => x.id === t.status);
		const next = STATUSES[i + dir];
		if (next) void setStatus({ fp: t.fp, title: t.title, company: t.company, url: t.url, locations: t.location ? [t.location] : [] }, next.id);
	};

	const snooze = async (r: Reminder, days: number) => {
		await snoozeReminder(client, r, days);
		await app.reloadUser();
		toast({ variant: 'info', title: 'Snoozed', body: `${r.text}: moved ${days} days later.` }, 3000);
	};
	const done = async (r: Reminder) => {
		await dismissReminder(client, r.id);
		await app.reloadUser();
	};

	return (
		<div style={s.page}>
			<div style={s.inner}>
				<ContentHeader
					title="Job Tracker"
					subtitle="Every role and next step in one place. High-priority roles and nearest deadlines come first."
					actions={
						<>
							<Button small variant="secondary" disabled={!user.tracker.length} onClick={() => downloadFile(trackerCsv(user.tracker), `jobradar-applications-${localDate()}.csv`, 'text/csv;charset=utf-8')}>
								Export CSV
							</Button>
							<Button small onClick={() => setAdding(!adding)}>
								{adding ? 'Close job form' : 'Add any job'}
							</Button>
						</>
					}
				/>
				<div style={s.stack}>
					{adding && <JobCapture onClose={() => setAdding(false)} />}
					{user.tracker.length === 0 ? (
						<EmptyState
							title="Nothing tracked yet"
							description="Save a job from the dashboard or the Jobs screen and it lands here."
							action={
								<Button small onClick={() => app.setView('jobs')}>
									Find jobs
								</Button>
							}
						/>
					) : (
						<div style={tk.board}>
							{STATUSES.map((col, ci) => {
								const priorityRank = { low: 0, normal: 1, high: 2 };
								const items = user.tracker.filter((t) => t.status === col.id).sort((a, b) => priorityRank[b.priority ?? 'normal'] - priorityRank[a.priority ?? 'normal'] || (a.deadline || '9999').localeCompare(b.deadline || '9999') || b.updatedAt - a.updatedAt);
								return (
									<div key={col.id} style={tk.col}>
										<div style={tk.colHead}>
											<span>{col.label}</span>
											<span>{items.length}</span>
										</div>
										{items.map((t) => {
											const r = reminderFor(t.fp);
											return (
												<div key={t.fp} style={tk.card}>
													<button type="button" className="jr-track-open" onClick={() => app.openJob(t.fp)} aria-label={`View ${t.title} at ${t.company}`}>
														<div style={tk.cardTitle}>{t.title}</div>
														<div style={tk.cardMeta}>{t.company}</div>
														<div style={tk.cardMeta}>{t.appliedAt ? `Applied ${ago(t.appliedAt)}` : `Added ${ago(t.createdAt)}`}</div>
													</button>
													{t.priority === 'high' && <StatusBadge variant="info">High priority</StatusBadge>}
													{t.deadline && (
														<div style={tk.cardMeta} className={t.deadline < todayIso && t.status === 'saved' ? 'jr-overdue' : ''}>
															Deadline {t.deadline}
														</div>
													)}
													{!!t.checklist?.length && (
														<div style={tk.cardMeta}>
															Prepared {t.checklist.filter((step) => step.done).length}/{t.checklist.length}
														</div>
													)}
													{t.outcome === 'posting_closed' && (
														<div style={{ marginTop: 4 }}>
															<StatusBadge variant="warning">Posting closed</StatusBadge>
														</div>
													)}
													{r && (
														<div style={{ marginTop: 4 }}>
															<StatusBadge variant={r.due <= todayIso ? 'warning' : 'muted'}>{r.due <= todayIso ? 'Reminder due' : `Reminder ${r.due}`}</StatusBadge>
														</div>
													)}
													<div style={tk.cardRow} onClick={(e) => e.stopPropagation()}>
														<div style={tk.move}>
															<Button variant="ghost" mini disabled={ci === 0} onClick={() => move(t, -1)} title="Move left">
																{'<'}
															</Button>
															<Button variant="ghost" mini disabled={ci === STATUSES.length - 1} onClick={() => move(t, 1)} title="Move right">
																{'>'}
															</Button>
														</div>
														<Button variant="ghost" mini onClick={() => setRemoving(t)} title="Stop tracking">
															Remove
														</Button>
													</div>
												</div>
											);
										})}
									</div>
								);
							})}
						</div>
					)}

					<div style={s.grid2}>
						<Card header={`Reminders (${user.reminders.length})`} noBodyPadding>
							{user.reminders.length === 0 ? (
								<div style={{ padding: 14, ...s.muted }}>No follow-up reminders. Mark a role Applied or Interview to schedule one.</div>
							) : (
								user.reminders.map((r) => (
									<div key={r.id} style={s.listRow}>
										<div>
											<div style={s.text}>{r.text}</div>
											<div style={s.small}>
												{r.source === 'assistant' ? 'Saved by the assistant' : 'Automatic follow-up'} · due {r.due}
											</div>
										</div>
										<div style={s.row}>
											{r.due <= todayIso && <StatusBadge variant="warning">Due</StatusBadge>}
											<Button variant="ghost" small onClick={() => void snooze(r, 3)}>
												Snooze 3d
											</Button>
											<Button variant="secondary" small onClick={() => void done(r)}>
												Done
											</Button>
										</div>
									</div>
								))
							)}
						</Card>
						<Card header={`Saved notes (${user.notes.length})`} noBodyPadding>
							{user.notes.length === 0 ? (
								<div style={{ padding: 14, ...s.muted }}>Application notes are available on each role's Track tab.</div>
							) : (
								user.notes.map((n) => (
									<div key={n.id} style={s.listRow}>
										<span style={s.text}>{n.text}</span>
										<Button variant="ghost" small onClick={() => void done({ id: n.id, text: n.text, due: '', source: 'assistant' })}>
											Delete
										</Button>
									</div>
								))
							)}
						</Card>
					</div>
				</div>
			</div>
			{removing && (
				<ConfirmDialog
					title="Stop tracking this job?"
					message={`${removing.title} at ${removing.company} will be removed from the tracker with its notes and reminder.`}
					confirmLabel="Remove"
					destructive
					onConfirm={() => {
						void remove(removing);
						setRemoving(null);
					}}
					onCancel={() => setRemoving(null)}
				/>
			)}
		</div>
	);
};
