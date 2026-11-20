/**
 * Jobs inbox: New by default; All matches and Hidden when you want them.
 */

import React, { useMemo, useState } from 'react';
import { Banner, Button, Card, ContentHeader, EmptyState, InputField, TabControl, ToggleGroup, useDebouncedValue } from 'shell';
import { useJobActions } from '../actions';
import type { ScoredJob } from '../lib/match';
import { useApp } from '../state';
import { JobRow, s } from '../ui';

type Tab = 'new' | 'all' | 'hidden';
type Sort = 'score' | 'newest';

const PAGE = 40;

export const Jobs: React.FC = () => {
	const app = useApp();
	const { setStatus, hide, unhide } = useJobActions();
	const { user, jobs, refreshing } = app;
	const [tab, setTab] = useState<Tab>('new');
	const [sort, setSort] = useState<Sort>('score');
	const [query, setQuery] = useState('');
	const [fresh, setFresh] = useState<'any' | '3' | '7'>('any');
	const [remoteOnly, setRemoteOnly] = useState(false);
	const [hideStale, setHideStale] = useState(true);
	const [limit, setLimit] = useState(PAGE);
	const q = useDebouncedValue(query, 200).trim().toLowerCase();

	const lists = useMemo(() => {
		if (!user) return { new: [], all: [], hidden: [] } as Record<Tab, ScoredJob[]>;
		const min = user.prefs.minScore;
		const tracked = new Set(user.tracker.map((t) => t.fp));
		return {
			new: jobs.filter((j) => j.flags.includes('new') && j.score >= min && !user.hidden.has(j.fp)),
			all: jobs.filter((j) => j.score >= min && !user.hidden.has(j.fp) && !tracked.has(j.fp)),
			hidden: jobs.filter((j) => user.hidden.has(j.fp)),
		};
	}, [jobs, user]);

	const shown = useMemo(() => {
		const now = Date.now() / 1000;
		let list = lists[tab];
		if (q) list = list.filter((j) => `${j.title} ${j.company} ${j.locations.join(' ')}`.toLowerCase().includes(q));
		if (fresh !== 'any') list = list.filter((j) => now - j.posted < Number(fresh) * 86400);
		if (remoteOnly) list = list.filter((j) => j.remote);
		if (hideStale && tab !== 'hidden') list = list.filter((j) => !j.flags.includes('stale'));
		if (sort === 'newest') list = [...list].sort((a, b) => b.posted - a.posted);
		return list;
	}, [lists, tab, q, fresh, remoteOnly, hideStale, sort]);

	if (!user) return null;

	const menu = {
		entries: [
			{ id: 'new', label: 'New', count: lists.new.length },
			{ id: 'all', label: 'All matches', count: lists.all.length },
			{ id: 'hidden', label: 'Hidden', count: lists.hidden.length },
		],
	};

	return (
		<div style={s.page}>
			<TabControl menu={menu} activeId={tab} onSelect={(id) => { setTab(id as Tab); setLimit(PAGE); }} />
			<div style={s.inner}>
				<ContentHeader
					title={tab === 'new' ? 'New for you' : tab === 'all' ? 'All matches' : 'Hidden'}
					subtitle={
						tab === 'new'
							? 'Only postings JobRadar first saw since your last check. Open one, save it, or hide it and it leaves this list.'
							: tab === 'all'
								? `Every open match above your score threshold (${user.prefs.minScore}), duplicates merged, not yet tracked.`
								: 'Jobs you hid. They stay hidden for 90 days.'
					}
					actions={
						<div style={s.row}>
							{tab === 'new' && lists.new.length > 0 && (
								<Button variant="ghost" small onClick={() => void app.markAllSeen()}>
									Mark all seen
								</Button>
							)}
							<Button variant="secondary" small disabled={refreshing} onClick={() => void app.refreshNow()}>
								{refreshing ? 'Checking...' : 'Check now'}
							</Button>
						</div>
					}
				/>
				<div style={s.stack}>
					{!user.profile && <Banner variant="info">Scores are rough until you add a resume on the Profile screen.</Banner>}
					<div style={s.row}>
						<div style={{ width: 260 }}>
							<InputField placeholder="Search title, company, city" value={query} onChange={(e) => setQuery(e.target.value)} />
						</div>
						<ToggleGroup options={[{ id: 'score', label: 'Best fit' }, { id: 'newest', label: 'Newest' }]} value={sort} onChange={(v) => setSort(v as Sort)} />
						<ToggleGroup options={[{ id: 'any', label: 'Any age' }, { id: '3', label: '3 days' }, { id: '7', label: '7 days' }]} value={fresh} onChange={(v) => setFresh(v as typeof fresh)} />
						<Button variant={remoteOnly ? 'primary' : 'secondary'} small pressed={remoteOnly} onClick={() => setRemoteOnly(!remoteOnly)}>
							Remote only
						</Button>
						<Button variant={hideStale ? 'primary' : 'secondary'} small pressed={hideStale} onClick={() => setHideStale(!hideStale)} title="Hide roles that were reposted repeatedly or have been open for months">
							Hide stale
						</Button>
					</div>
					<Card header={`${shown.length} ${shown.length === 1 ? 'job' : 'jobs'}`} noBodyPadding>
						{shown.length === 0 ? (
							<EmptyState
								title={tab === 'new' ? 'Nothing new right now' : 'No jobs here'}
								description={tab === 'new' ? 'You will get a notification when a new match appears. Browse older matches under All matches.' : 'Try clearing the search or filters.'}
								action={tab === 'new' ? <Button small onClick={() => setTab('all')}>Browse all matches</Button> : undefined}
							/>
						) : (
							<>
								{shown.slice(0, limit).map((j) => (
									<JobRow
										key={j.fp}
										job={j}
										onOpen={() => app.openJob(j.fp)}
										actions={
											tab === 'hidden' ? (
												<Button variant="secondary" small onClick={() => void unhide(j)}>
													Unhide
												</Button>
											) : (
												<>
													<Button variant="secondary" small onClick={() => void setStatus(j, 'saved')}>
														Save
													</Button>
													<Button variant="secondary" small onClick={() => void setStatus(j, 'applied')}>
														Applied
													</Button>
													<Button variant="ghost" small onClick={() => void hide(j)}>
														Hide
													</Button>
												</>
											)
										}
									/>
								))}
								{shown.length > limit && (
									<div style={{ padding: 12 }}>
										<Button variant="ghost" small onClick={() => setLimit(limit + PAGE)}>
											Show {Math.min(PAGE, shown.length - limit)} more
										</Button>
									</div>
								)}
							</>
						)}
					</Card>
				</div>
			</div>
		</div>
	);
};
