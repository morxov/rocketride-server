import React, { useEffect, useState } from 'react';
import { Banner, Button } from 'shell';
import { downloadFile, searchMetrics, trackerCsv } from '../lib/career';
import { localDate } from '../lib/store';
import { Panel, s } from '../ui';
import { CareerField } from './CareerForms';
import { useCareer } from './careerHooks';
export const CareerInsights: React.FC = () => {
	const { user, updateCareer, openJob } = useCareer();
	const [goal, setGoal] = useState(user?.career.weeklyGoal ?? 5);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState('');
	useEffect(() => setGoal(user?.career.weeklyGoal ?? 5), [user?.career.weeklyGoal]);
	if (!user) return null;
	const stats = searchMetrics(user.tracker);
	const today = localDate();
	const deadlines = user.tracker.filter((item) => item.deadline && item.status === 'saved').sort((a, b) => a.deadline!.localeCompare(b.deadline!));
	const dueContacts = user.career.contacts.filter((contact) => contact.followUp && contact.followUp <= today);
	const achieved = Math.min(100, Math.round((stats.thisWeek / user.career.weeklyGoal) * 100));
	const maxWeek = Math.max(1, ...stats.weeks.map((week) => week.count));
	return (
		<div className="jr-career-stack">
			{error && <Banner variant="error">{error}</Banner>}
			<div className="jr-career-stats">
				{[
					['Tracked roles', stats.saved],
					['Recorded applications', stats.applied],
					['Reached interview', stats.interviews],
					['Recorded offers', stats.offers],
				].map(([label, value]) => (
					<div key={label} className="jr-career-stat">
						<span>{label}</span>
						<strong>{value}</strong>
					</div>
				))}
			</div>
			<div className="jr-career-grid jr-career-wide-grid">
				<Panel header="Your search funnel">
					<p style={s.muted}>Based on recorded status history, including applications that have since closed.</p>
					<div className="jr-funnel">
						{[
							['Applied', stats.applied],
							['Interview', stats.interviews],
							['Offer', stats.offers],
						].map(([label, value]) => (
							<div key={label}>
								<span>{label}</span>
								<div>
									<i style={{ width: `${Math.min(100, (Number(value) / Math.max(1, stats.applied, stats.interviews, stats.offers)) * 100)}%` }} />
								</div>
								<strong>{value}</strong>
							</div>
						))}
					</div>
					<div className="jr-insight-rates">
						<p>
							<strong>{stats.responseRate === null ? 'No data yet' : `${stats.responseRate}%`}</strong> recorded response rate
						</p>
						<p>
							<strong>{stats.interviewRate === null ? 'No data yet' : `${stats.interviewRate}%`}</strong> application-to-interview rate
						</p>
					</div>
					<p style={s.small}>An assessment, interview, offer, or explicit rejection counts as a response. Closing a posting alone does not. Rates use only roles with a recorded application date.</p>
				</Panel>
				<Panel header="Build a steady rhythm">
					<div className="jr-weekly-goal">
						<strong>
							{stats.thisWeek}
							<span> / {user.career.weeklyGoal}</span>
						</strong>
						<p>applications recorded this week</p>
					</div>
					<progress aria-label="Weekly application goal" value={achieved} max={100} />
					<div className="jr-goal-form">
						<CareerField label="Weekly application goal">
							<input disabled={busy} type="number" min={1} max={100} value={goal} onChange={(event) => setGoal(Number(event.target.value))} />
						</CareerField>
						<Button
							small
							disabled={busy || goal === user.career.weeklyGoal}
							onClick={() => {
								if (!Number.isInteger(goal) || goal < 1 || goal > 100) {
									setError('Choose a weekly goal from 1 to 100.');
									return;
								}
								setBusy(true);
								setError('');
								void updateCareer((current) => ({ ...current, weeklyGoal: goal }))
									.catch((e: unknown) => setError(String(e)))
									.finally(() => setBusy(false));
							}}
						>
							{busy ? 'Saving...' : 'Save goal'}
						</Button>
					</div>
					<p style={s.small}>A planning target you control. JobRadar never submits applications.</p>
				</Panel>
			</div>
			<Panel
				header="Application cadence"
				headerActions={
					<Button small variant="secondary" disabled={!user.tracker.length} onClick={() => downloadFile(trackerCsv(user.tracker), `jobradar-applications-${today}.csv`, 'text/csv;charset=utf-8')}>
						Export tracker CSV
					</Button>
				}
			>
				<div className="jr-cadence" role="img" aria-label={`Weekly applications: ${stats.weeks.map((week) => `${week.label}: ${week.count}`).join(', ')}`}>
					{stats.weeks.map((week) => (
						<div key={week.start}>
							<strong>{week.count}</strong>
							<div className="jr-cadence-track">
								<i style={{ height: `${Math.max(week.count ? 5 : 0, (week.count / maxWeek) * 100)}%` }} />
							</div>
							<span>{week.label}</span>
						</div>
					))}
				</div>
				<p style={s.small}>Six calendar weeks, starting Monday. Each application is counted once using its first recorded applied date.</p>
			</Panel>
			<div className="jr-career-grid jr-career-wide-grid">
				<Panel header="Dates to keep in view">
					{deadlines.length ? (
						deadlines.map((item) => (
							<button className="jr-career-list-button" type="button" key={item.fp} onClick={() => openJob(item.fp)}>
								<span>
									<strong>{item.company}</strong>
									<small>{item.title}</small>
								</span>
								<span className={item.deadline! < today ? 'jr-overdue' : ''}>
									{item.deadline}
									{item.deadline! < today ? ' · overdue' : ''}
								</span>
							</button>
						))
					) : (
						<p style={s.muted}>Add a deadline to a saved role from its Track tab.</p>
					)}
				</Panel>
				<Panel header="Your next follow-ups">
					<p>
						{stats.awaiting} open {stats.awaiting === 1 ? 'application has' : 'applications have'} no recorded response after 14 days.
					</p>
					<p>
						{dueContacts.length} networking {dueContacts.length === 1 ? 'follow-up is' : 'follow-ups are'} due.
					</p>
					{dueContacts.map((contact) => (
						<div className="jr-career-list-row" key={contact.id}>
							<strong>{contact.name}</strong>
							<span>
								{contact.company} · {contact.followUp}
							</span>
						</div>
					))}
					<p style={s.small}>Update actual outcomes in your tracker. A lack of response does not mean rejection.</p>
				</Panel>
			</div>
		</div>
	);
};
