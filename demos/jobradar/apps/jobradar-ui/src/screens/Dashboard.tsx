/**
 * Dashboard: what is new since your last check, what to do today.
 */

import React from 'react';
import { Banner, Button, Card, ContentHeader, EmptyState, StatusBadge } from 'shell';
import { useJobActions } from '../actions';
import { ago } from '../lib/match';
import { STATUSES, localDate } from '../lib/store';
import { useApp } from '../state';
import { JobRow, Tile, s } from '../ui';

const st: Record<string, React.CSSProperties> = {
	funnel: { display: 'flex', gap: 6, alignItems: 'flex-end', height: 90, padding: '4px 2px' },
	barCol: { flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, justifyContent: 'flex-end', height: '100%' },
	bar: { width: '100%', borderRadius: '4px 4px 0 0', background: 'var(--rr-brand)', opacity: 0.8, minHeight: 3, transition: 'height 400ms ease' },
	barLabel: { fontSize: 10.5, color: 'var(--rr-text-secondary)', textAlign: 'center', lineHeight: 1.2 },
	barValue: { fontSize: 12, fontWeight: 700 },
};

export const Dashboard: React.FC = () => {
	const app = useApp();
	const { setStatus, hide } = useJobActions();
	const { user, jobs, result, since, refreshing, status, error, closedAlerts } = app;

	if (!user) {
		return (
			<div style={s.page}>
				<div style={s.inner}>
					<ContentHeader title="Dashboard" subtitle={status || 'Starting...'} />
					{error && <Banner variant="error">{error}</Banner>}
				</div>
			</div>
		);
	}

	const min = user.prefs.minScore;
	const fresh = jobs.filter((j) => j.flags.includes('new') && j.score >= min && !user.hidden.has(j.fp));
	const tracked = new Set(user.tracker.map((t) => t.fp));
	const picks = jobs.filter((j) => !tracked.has(j.fp) && !user.hidden.has(j.fp) && !j.flags.includes('stale') && j.score >= min && Date.now() / 1000 - j.posted < 14 * 86400).slice(0, 5);
	const todayIso = localDate();
	const due = user.reminders.filter((r) => r.due <= todayIso);
	const upcoming = user.reminders.filter((r) => r.due > todayIso).slice(0, 3);
	const active = user.tracker.filter((t) => t.status !== 'closed');
	const responded = user.tracker.filter((t) => t.appliedAt && t.history.some((h) => ['assessment', 'interview', 'offer'].includes(h.status))).length;
	const applied = user.tracker.filter((t) => t.appliedAt).length;
	const stale = jobs.filter((j) => j.flags.includes('stale') && j.score >= min).length;
	const counts = STATUSES.map((st2) => ({ ...st2, n: user.tracker.filter((t) => t.status === st2.id).length }));
	const maxCount = Math.max(1, ...counts.map((c) => c.n));

	return (
		<div style={s.page}>
			<div style={s.inner}>
				<ContentHeader
					title={user.profile?.name ? `Hi ${user.profile.name.split(' ')[0]}` : 'Dashboard'}
					subtitle={result ? `Last checked ${ago(result.at)} · ${result.scanned.toLocaleString()} postings from ${user.prefs.levels.length + user.prefs.watched.length} ${user.prefs.levels.length + user.prefs.watched.length === 1 ? 'source' : 'sources'} · checks again every 10 minutes while open` : status || 'Checking sources...'}
					actions={
						<Button small disabled={refreshing} onClick={() => void app.refreshNow()}>
							{refreshing ? 'Checking...' : 'Check now'}
						</Button>
					}
				/>
				<div style={s.stack}>
					{error && <Banner variant="error">{error}</Banner>}
					{!user.profile && (
						<Banner variant="info">
							<div style={s.row}>
								<span>Add your resume so JobRadar can score jobs for you.</span>
								<Button small onClick={() => app.setView('profile')}>
									Add resume
								</Button>
							</div>
						</Banner>
					)}
					{closedAlerts.filter((c) => user.tracker.some((t) => t.fp === c.fp && t.outcome === 'posting_closed')).map((c) => (
						<Banner key={c.fp} variant="warning">
							<div style={s.row}>
								<span>
									{c.title} at {c.company} is no longer listed on any source. If you have not heard back, it may have been filled.
								</span>
								<Button variant="ghost" small onClick={() => app.dismissClosed(c.fp)}>
									Dismiss
								</Button>
							</div>
						</Banner>
					))}

					<div style={s.tiles}>
						<Tile label="New for you" value={fresh.length} note={`since ${ago(since)}`} onClick={() => app.setView('jobs')} />
						<Tile label="Follow-ups due" value={due.length} note={upcoming.length ? `next ${upcoming[0].due}` : 'nothing scheduled'} onClick={() => app.setView('tracker')} />
						<Tile label="Active applications" value={active.filter((t) => t.status !== 'saved').length} note={`${user.tracker.filter((t) => t.status === 'saved').length} saved to apply`} onClick={() => app.setView('tracker')} />
						<Tile label="Applied this week" value={user.appliedThisWeek} note={!applied ? 'no applications yet' : responded ? `${Math.round((responded / applied) * 100)}% got a response` : `${applied} sent, no responses yet`} />
						<Tile label="Open postings checked" value={(result?.scanned ?? 0).toLocaleString()} note={`${result?.duplicates ?? 0} duplicates merged · ${result?.stats.newToday ?? 0} new today`} />
						<Tile label="Likely stale" value={stale} note="reposted or open too long, ranked lower" />
					</div>

					<div style={s.grid2}>
						<Card
							header={`New since your last check (${fresh.length})`}
							headerActions={
								fresh.length > 0 ? (
									<Button variant="ghost" small onClick={() => void app.markAllSeen()}>
										Mark all seen
									</Button>
								) : undefined
							}
							noBodyPadding
						>
							{fresh.length === 0 ? (
								<EmptyState title="You are caught up" description="New postings that match you pop up here and as a notification. Older matches are under Jobs > All matches." />
							) : (
								<>
									{fresh.slice(0, 6).map((j) => (
										<JobRow
											key={j.fp}
											job={j}
											compact
											onOpen={() => app.openJob(j.fp)}
											actions={
												<>
													<Button variant="secondary" small onClick={() => void setStatus(j, 'saved')}>
														Save
													</Button>
													<Button variant="ghost" small onClick={() => void hide(j)}>
														Hide
													</Button>
												</>
											}
										/>
									))}
									{fresh.length > 6 && (
										<div style={{ padding: 10 }}>
											<Button variant="ghost" small onClick={() => app.setView('jobs')}>
												See all {fresh.length} new
											</Button>
										</div>
									)}
								</>
							)}
						</Card>

						<div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
							<Card header="Follow-ups" noBodyPadding>
								{due.length + upcoming.length === 0 ? (
									<div style={{ padding: 14, ...s.muted }}>Mark a job as Applied and JobRadar reminds you to follow up a week later.</div>
								) : (
									[...due, ...upcoming].map((r) => (
										<div key={r.id} style={s.listRow}>
											<span style={s.text}>{r.text}</span>
											<StatusBadge variant={r.due <= todayIso ? 'warning' : 'muted'}>{r.due <= todayIso ? 'Due' : r.due}</StatusBadge>
										</div>
									))
								)}
							</Card>
							<Card header="Pipeline" headerActions={<Button variant="ghost" small onClick={() => app.setView('tracker')}>Open tracker</Button>}>
								<div style={st.funnel}>
									{counts.map((c) => (
										<div key={c.id} style={st.barCol}>
											<div style={st.barValue}>{c.n}</div>
											<div style={{ ...st.bar, height: `${(c.n / maxCount) * 60}%` }} />
											<div style={st.barLabel}>{c.label}</div>
										</div>
									))}
								</div>
							</Card>
						</div>
					</div>

					<Card header="Worth applying to today" headerActions={<span style={s.small}>fresh, not stale, best fit</span>} noBodyPadding>
						{picks.length === 0 ? (
							<EmptyState title="No picks yet" description={user.profile ? 'Nothing fresh above your score threshold. Lower it on Profile, or add companies to watch.' : 'Add your resume first.'} />
						) : (
							picks.map((j) => (
								<JobRow
									key={j.fp}
									job={j}
									onOpen={() => app.openJob(j.fp)}
									actions={
										<>
											<Button small onClick={() => void setStatus(j, 'saved')}>
												Save
											</Button>
										</>
									}
								/>
							))
						)}
					</Card>
				</div>
			</div>
		</div>
	);
};
