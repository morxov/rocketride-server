/**
 * Job details drawer: description, fit explanation, drafts, tracker actions.
 */

import React, { useEffect, useId, useState } from 'react';
import { Banner, Button, DetailPanel, LabelValue, MarkdownRenderer, PanelTabBody, Section, StatusBadge } from 'shell';
import { useJobActions } from '../actions';
import { profileFacts, write } from '../lib/ai';
import { ago, type ScoredJob } from '../lib/match';
import { scrapePage } from '../lib/pipelines';
import { fetchAtsDescription } from '../lib/sources';
import { STATUSES, cacheDescription, cacheFit, cachedDescription, cachedFit, patchTracked, type Status, type TrackItem, localDate } from '../lib/store';
import { toast, useApp } from '../state';
import { JobFlags, s, scoreColor } from '../ui';
import { Icon } from '../icons';
import { ResumeEditor } from './ResumeEditor';
import { ApplicationPlan } from './CareerForms';

type Tab = 'overview' | 'fit' | 'resume' | 'write' | 'track';

const ps: Record<string, React.CSSProperties> = {
	scoreBig: { width: 42, height: 42, borderRadius: 21, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700 },
	chips: { display: 'flex', gap: 6, flexWrap: 'wrap', margin: '4px 0 12px' },
	list: { margin: '4px 0 0', paddingLeft: 18, fontSize: 13, lineHeight: 1.55 },
	desc: { fontSize: 13, lineHeight: 1.55, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', maxHeight: 420, overflowY: 'auto', border: '1px solid var(--rr-border)', borderRadius: 6, padding: '10px 12px', background: 'var(--rr-bg-surface)' },
	statusRow: { display: 'flex', gap: 6, flexWrap: 'wrap' },
};

/** A job that is tracked but no longer in the live feed still opens, from its tracker record. */
function fromTrack(t: TrackItem): ScoredJob {
	return { fp: t.fp, title: t.title, company: t.company, url: t.url, locations: t.location ? [t.location] : [], posted: t.createdAt, firstPosted: t.createdAt, postCount: 1, level: 'intern', remote: false, sources: [{ label: 'Tracker', url: t.url }], score: 0, reasons: [], warnings: t.outcome === 'posting_closed' ? ['Posting is no longer listed'] : [], flags: [], firstSeen: t.createdAt };
}

/** The same job actions appear in the job board's split view and other screens' drawer. */
const JobFrame: React.FC<React.ComponentProps<typeof DetailPanel> & { embedded?: boolean }> = ({ embedded, ...props }) => {
	const detailId = useId();
	if (!embedded) return <DetailPanel {...props} />;
	return (
		<section className="jr-detail" aria-label="Job details">
			<div className="jr-detail-heading">
				<span className="jr-company">
					<Icon name="jobs" />
				</span>
				<div>
					<h2>{props.title}</h2>
					<p>{props.subtitle}</p>
				</div>
				<button type="button" className="jr-detail-close" onClick={props.onClose} aria-label="Close job details">
					×
				</button>
			</div>
			<div className="jr-detail-tabs" role="tablist" aria-label="Job details">
				{props.tabs?.map((tab, index) => (
					<button
						key={tab.id}
						type="button"
						role="tab"
						id={`${detailId}-${tab.id}`}
						aria-controls={`${detailId}-panel`}
						aria-selected={props.activeTab === tab.id}
						tabIndex={props.activeTab === tab.id ? 0 : -1}
						onClick={() => props.onTabSelect?.(tab.id)}
						onKeyDown={(event) => {
							const tabs = props.tabs ?? [];
							if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
							event.preventDefault();
							const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
							props.onTabSelect?.(tabs[next].id);
							event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus();
						}}
					>
						{tab.label}
					</button>
				))}
			</div>
			<div className="jr-detail-body" role="tabpanel" id={`${detailId}-panel`} aria-labelledby={`${detailId}-${props.activeTab}`} tabIndex={0}>
				{props.children}
			</div>
			<div className="jr-detail-footer">{props.footer}</div>
		</section>
	);
};

export const JobPanel: React.FC<{ embedded?: boolean }> = ({ embedded }) => {
	const app = useApp();
	const { setStatus, hide, seen } = useJobActions();
	const { client, user, jobs, openFp } = app;
	const [tab, setTab] = useState<Tab>('overview');
	const [desc, setDesc] = useState<{ text: string; from: string } | null>(null);
	const [descBusy, setDescBusy] = useState(false);
	const [fit, setFit] = useState<string | null>(null);
	const [draft, setDraft] = useState<{ kind: string; text: string } | null>(null);
	const [busy, setBusy] = useState<string | null>(null);
	const [notes, setNotes] = useState('');

	const tracked = user?.tracker.find((t) => t.fp === openFp);
	const job = jobs.find((j) => j.fp === openFp) ?? (tracked ? fromTrack(tracked) : undefined);
	const manual = tracked?.fp.startsWith('manual-') ?? false;

	useEffect(() => {
		setTab('overview');
		setDesc(null);
		setFit(null);
		setDraft(null);
		setNotes(tracked?.notes ?? '');
		if (!openFp || !client) return;
		void seen(openFp);
		void cachedFit(client, openFp)
			.then((f) => f && setFit(f))
			.catch(() => undefined);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [openFp, client]);

	if (!job || !user || !client)
		return (
			<DetailPanel open={false} title="" onClose={() => app.openJob(null)}>
				{null}
			</DetailPanel>
		);

	/** Description: ATS API first, then the Posting cache, then Firecrawl (cached for 7 days). */
	const loadDescription = async (): Promise<string> => {
		if (desc) return desc.from === 'error' ? '' : desc.text;
		if (tracked?.description?.trim()) {
			setDesc({ text: tracked.description, from: 'saved posting' });
			return tracked.description;
		}
		setDescBusy(true);
		try {
			const ats = await fetchAtsDescription(job);
			if (ats) {
				await cacheDescription(client, job.fp, ats);
				setDesc({ text: ats, from: 'company job board' });
				return ats;
			}
			const cached = await cachedDescription(client, job.fp);
			if (cached) {
				setDesc({ text: cached, from: 'Posting cache (fetched earlier with Firecrawl)' });
				return cached;
			}
			const page = await scrapePage(client, job.url);
			const text = page.trim() || 'The page returned no readable text.';
			await cacheDescription(client, job.fp, text);
			setDesc({ text, from: 'Firecrawl, now cached in the file store for 7 days' });
			return text;
		} catch (e) {
			const msg = `Could not load the posting: ${e instanceof Error ? e.message : String(e)}`;
			setDesc({ text: msg, from: 'error' });
			return '';
		} finally {
			setDescBusy(false);
		}
	};

	const jobFacts = (description: string) => ({ job: { title: job.title, company: job.company, locations: job.locations.slice(0, 4), posted: manual ? null : localDate(new Date(job.posted * 1000)), description: description.slice(0, 12000) } });

	const explain = async () => {
		setBusy('fit');
		try {
			const d = await loadDescription();
			const text = await write(client, 'fit', { ...profileFacts(user.profile, user.resume), ...jobFacts(d) });
			setFit(text);
			await cacheFit(client, job.fp, text);
		} catch (e) {
			toast({ variant: 'error', title: 'Explain fit failed', body: e instanceof Error ? e.message : String(e) });
		} finally {
			setBusy(null);
		}
	};

	const draftText = async (kind: 'cover' | 'followup') => {
		setBusy(kind);
		try {
			const d = kind === 'cover' ? await loadDescription() : '';
			const facts: Record<string, unknown> = { ...profileFacts(user.profile, user.resume), ...jobFacts(d) };
			if (kind === 'followup') facts.application = { status: tracked?.status ?? 'applied', applied_on: tracked?.appliedAt ? localDate(new Date(tracked.appliedAt * 1000)) : null, today: localDate(), notes: tracked?.notes ?? '' };
			setDraft({ kind, text: await write(client, kind, facts) });
		} catch (e) {
			toast({ variant: 'error', title: 'Draft failed', body: e instanceof Error ? e.message : String(e) });
		} finally {
			setBusy(null);
		}
	};

	const saveNotes = async () => {
		if (!tracked) return;
		setBusy('notes');
		try {
			const item = await patchTracked(client, tracked.fp, { notes });
			app.patchUser((u) => ({ ...u, tracker: u.tracker.map((t) => (t.fp === item.fp ? item : t)) }));
			toast({ variant: 'success', title: 'Notes saved', body: job.company }, 3000);
		} catch (e) {
			toast({ variant: 'error', title: 'Notes did not save', body: e instanceof Error ? e.message : String(e) });
		} finally {
			setBusy(null);
		}
	};
	const copy = (text: string) => void navigator.clipboard.writeText(text).then(() => toast({ variant: 'success', title: 'Copied', body: 'Paste it into your email or application.' }, 3000));

	const tabs = [
		{ id: 'overview', label: 'Overview' },
		{ id: 'fit', label: 'Explain fit' },
		{ id: 'resume', label: 'Resume' },
		{ id: 'write', label: 'Drafts' },
		{ id: 'track', label: tracked ? `Tracker: ${STATUSES.find((x) => x.id === tracked.status)?.label}` : 'Track' },
	];

	return (
		<JobFrame
			embedded={embedded}
			open
			title={job.title}
			subtitle={`${job.company}${job.locations.length ? ` · ${job.locations.slice(0, 3).join(', ')}` : ''}`}
			avatar={job.score ? <div style={{ ...ps.scoreBig, ...scoreColor(job.score) }}>{job.score}</div> : undefined}
			tabs={tabs}
			activeTab={tab}
			onTabSelect={(id) => setTab(id as Tab)}
			onClose={() => app.openJob(null)}
			width={620}
			persistKey="jobradar.jobpanel"
			footer={
				<>
					<Button variant="secondary" onClick={() => window.open(job.url, '_blank', 'noopener')}>
						Open posting
					</Button>
					{!tracked && (
						<Button
							variant="ghost"
							onClick={() => {
								void hide(job);
								app.openJob(null);
							}}
						>
							Hide
						</Button>
					)}
					{!tracked ? <Button onClick={() => void setStatus(job, 'saved')}>Save to tracker</Button> : tracked.status === 'saved' ? <Button onClick={() => void setStatus(job, 'applied')}>Mark applied</Button> : null}
				</>
			}
		>
			{tab === 'overview' && (
				<PanelTabBody>
					<div style={ps.chips}>
						<JobFlags job={job} />
					</div>
					{job.reasons.length > 0 && (
						<Section label="Why it matches">
							<ul style={ps.list}>
								{job.reasons.map((r) => (
									<li key={r}>{r}</li>
								))}
							</ul>
						</Section>
					)}
					{job.warnings.length > 0 && (
						<Section label="Watch out">
							<ul style={{ ...ps.list, color: 'var(--rr-color-warning)' }}>
								{job.warnings.map((r) => (
									<li key={r}>{r}</li>
								))}
							</ul>
						</Section>
					)}
					<Section label="Freshness">
						<LabelValue label="Posted">{manual ? 'Posting date not recorded' : `${new Date(job.posted * 1000).toLocaleDateString()} (${ago(job.posted)})`}</LabelValue>
						<LabelValue label="First posted">{manual ? 'Posting history not recorded' : job.postCount > 1 ? `${new Date(job.firstPosted * 1000).toLocaleDateString()}, posted ${job.postCount} times` : 'Only posting of this role'}</LabelValue>
						<LabelValue label={manual ? 'Added to tracker' : 'JobRadar saw it'}>{ago(job.firstSeen)}</LabelValue>
					</Section>
					<Section label="Details">
						{job.terms?.length ? <LabelValue label="Term">{job.terms.join(', ')}</LabelValue> : null}
						{job.category ? <LabelValue label="Category">{job.category}</LabelValue> : null}
						{job.sponsorship ? <LabelValue label="Sponsorship">{job.sponsorship}</LabelValue> : null}
						<LabelValue label="Sources">
							{job.sources.map((src, i) => (
								<span key={src.url}>
									{i > 0 && ' · '}
									<a style={s.link} href={src.url} target="_blank" rel="noreferrer">
										{src.label}
									</a>
								</span>
							))}
						</LabelValue>
					</Section>
					<Section label="Posting">
						{desc ? (
							<>
								<div style={{ ...s.small, marginBottom: 6 }}>From {desc.from}</div>
								<div style={ps.desc}>{desc.text}</div>
							</>
						) : (
							<Button variant="secondary" small disabled={descBusy} onClick={() => void loadDescription()}>
								{descBusy ? 'Loading...' : 'Load the full posting'}
							</Button>
						)}
					</Section>
				</PanelTabBody>
			)}

			{tab === 'fit' && (
				<PanelTabBody>
					{!user.profile && <Banner variant="info">Add your resume on Profile so the explanation can use your experience.</Banner>}
					<div style={{ ...s.row, margin: '8px 0 12px' }}>
						<Button small disabled={busy === 'fit'} onClick={() => void explain()}>
							{busy === 'fit' ? 'Reading the posting...' : fit ? 'Explain again' : 'Explain my fit'}
						</Button>
						<span style={s.small}>Pairs each requirement with evidence from your resume. It never invents experience.</span>
					</div>
					{fit && (
						<div style={s.text}>
							<MarkdownRenderer content={fit} />
						</div>
					)}
				</PanelTabBody>
			)}

			{tab === 'resume' && (
				<PanelTabBody>
					<ResumeEditor key={job.fp} fp={job.fp} title={job.title} company={job.company} loadDescription={loadDescription} />
				</PanelTabBody>
			)}

			{tab === 'write' && (
				<PanelTabBody>
					<div style={{ ...s.row, margin: '8px 0 12px' }}>
						<Button small disabled={!!busy} onClick={() => void draftText('cover')}>
							{busy === 'cover' ? 'Writing...' : 'Cover note'}
						</Button>
						<Button variant="secondary" small disabled={!!busy} onClick={() => void draftText('followup')}>
							{busy === 'followup' ? 'Writing...' : 'Follow-up email'}
						</Button>
					</div>
					{draft ? (
						<>
							<pre style={s.pre}>{draft.text}</pre>
							<div style={{ ...s.row, marginTop: 8 }}>
								<Button variant="secondary" small onClick={() => copy(draft.text)}>
									Copy
								</Button>
								<span style={s.small}>JobRadar never sends anything for you.</span>
							</div>
						</>
					) : (
						<div style={s.muted}>Drafts use only facts from your resume and this posting.</div>
					)}
				</PanelTabBody>
			)}

			{tab === 'track' && (
				<PanelTabBody>
					<Section label="Status">
						<div style={ps.statusRow}>
							{STATUSES.map((st) => (
								<Button key={st.id} small variant={tracked?.status === st.id ? 'primary' : 'secondary'} pressed={tracked?.status === st.id} onClick={() => void setStatus(job, st.id as Status)}>
									{st.label}
								</Button>
							))}
						</div>
					</Section>
					{tracked ? (
						<>
							<Section label="History">
								{tracked.history.map((h, i) => (
									<LabelValue key={i} label={new Date(h.at * 1000).toLocaleDateString()}>
										{STATUSES.find((x) => x.id === h.status)?.label ?? h.status}
									</LabelValue>
								))}
								{tracked.outcome === 'posting_closed' && <StatusBadge variant="warning">Posting no longer listed</StatusBadge>}
							</Section>
							<ApplicationPlan key={tracked.fp} item={tracked} />
							<Section label="Notes">
								<textarea style={{ ...s.textarea, width: '100%', boxSizing: 'border-box' }} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Recruiter name, referral, interview dates..." />
								<div style={{ marginTop: 6 }}>
									<Button variant="secondary" small disabled={!!busy || notes === tracked.notes} onClick={() => void saveNotes()}>
										Save notes
									</Button>
								</div>
							</Section>
						</>
					) : (
						<div style={s.muted}>Pick a status to start tracking this job. Applied sets a follow-up reminder for 7 days later.</div>
					)}
				</PanelTabBody>
			)}
		</JobFrame>
	);
};
