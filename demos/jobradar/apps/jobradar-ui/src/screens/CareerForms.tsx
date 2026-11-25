import React, { useEffect, useState } from 'react';
import { Banner, Button } from 'shell';
import { calendarDate, DEFAULT_CHECKLIST, keywordCoverage, manualJob, webUrl, type ChecklistItem } from '../lib/career';
import { scrapePage } from '../lib/pipelines';
import { dataStore } from '../lib/storage';
import { patchTracked, type TrackItem } from '../lib/store';
import { toast, useApp } from '../state';
import { Panel, s } from '../ui';

export const CareerField: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
	<label className="jr-career-field">
		<span>{label}</span>
		{children}
	</label>
);
export const JobCapture: React.FC<{ onClose: () => void }> = ({ onClose }) => {
	const { client, user, patchUser, openJob } = useApp();
	const [draft, setDraft] = useState({ title: '', company: '', url: '', location: '', description: '' });
	const [busy, setBusy] = useState('');
	const [error, setError] = useState('');
	const field = (key: keyof typeof draft) => ({ value: draft[key], onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setDraft((current) => ({ ...current, [key]: event.target.value })) });
	const read = async () => {
		if (!client) return;
		setBusy('read');
		setError('');
		try {
			const text = await scrapePage(client, webUrl(draft.url));
			if (!text.trim()) throw new Error('No readable posting found. Paste the description below.');
			setDraft((current) => ({ ...current, description: text.slice(0, 40000) }));
		} catch (e) {
			setError(e instanceof Error ? e.message : String(e));
		} finally {
			setBusy('');
		}
	};
	const save = async (event: React.FormEvent) => {
		event.preventDefault();
		if (!client || !user) return;
		setBusy('save');
		setError('');
		try {
			const item = manualJob(draft);
			const duplicate = user.tracker.find((job) => {
				try {
					return webUrl(job.url) === item.url;
				} catch {
					return false;
				}
			});
			if (duplicate) throw new Error('That posting is already in your tracker.');
			await dataStore(client, 'user').setJson(`app:${item.fp}`, item, 0, 'NX');
			patchUser((current) => ({ ...current, tracker: [item, ...current.tracker] }));
			onClose();
			openJob(item.fp);
			toast({ variant: 'success', title: 'Job added', body: `${item.company}: posting details saved in your workspace.` });
		} catch (e) {
			setError(e instanceof Error ? e.message : String(e));
		} finally {
			setBusy('');
		}
	};
	return (
		<Panel
			header="Save a job from anywhere"
			headerActions={
				<Button variant="ghost" small disabled={!!busy} onClick={onClose}>
					Cancel
				</Button>
			}
		>
			<p style={s.muted}>Add a role from a company site or another job board. Its saved description stays available if the posting disappears.</p>
			{error && <Banner variant="error">{error}</Banner>}
			<form onSubmit={(event) => void save(event)}>
				<fieldset className="jr-career-form" disabled={!!busy}>
					<div className="jr-career-grid">
						<CareerField label="Job title">
							<input required maxLength={250} autoFocus {...field('title')} />
						</CareerField>
						<CareerField label="Company">
							<input required maxLength={200} {...field('company')} />
						</CareerField>
					</div>
					<CareerField label="Posting URL">
						<input required type="url" maxLength={2000} placeholder="https://company.com/careers/role" {...field('url')} />
					</CareerField>
					<CareerField label="Location">
						<input maxLength={500} placeholder="City or remote" {...field('location')} />
					</CareerField>
					<div style={s.row}>
						<Button small variant="secondary" disabled={!!busy || !draft.url} onClick={() => void read()}>
							{busy === 'read' ? 'Reading posting...' : 'Read posting with Firecrawl'}
						</Button>
						<span style={s.small}>Review the text before saving.</span>
					</div>
					<CareerField label="Saved job description">
						<textarea rows={7} maxLength={40000} placeholder="Paste the full posting, or read it from the URL above." {...field('description')} />
					</CareerField>
					<div>
						<button className="jr-career-primary" type="submit" disabled={!!busy}>
							{busy === 'save' ? 'Saving...' : 'Add to tracker'}
						</button>
					</div>
				</fieldset>
			</form>
		</Panel>
	);
};

export const ApplicationPlan: React.FC<{ item: TrackItem }> = ({ item }) => {
	const { client, patchUser } = useApp();
	const [deadline, setDeadline] = useState(item.deadline ?? '');
	const [priority, setPriority] = useState(item.priority ?? 'normal');
	const [tasks, setTasks] = useState<ChecklistItem[]>(item.checklist ?? DEFAULT_CHECKLIST.map((label, index) => ({ id: `default-${index}`, label, done: false })));
	const [newTask, setNewTask] = useState('');
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState('');
	useEffect(() => {
		setDeadline(item.deadline ?? '');
		setPriority(item.priority ?? 'normal');
		setTasks(item.checklist ?? DEFAULT_CHECKLIST.map((label, index) => ({ id: `default-${index}`, label, done: false })));
	}, [item.fp, item.deadline, item.priority, item.checklist]);
	const save = async () => {
		if (!client) return;
		setBusy(true);
		setError('');
		try {
			if (deadline && !calendarDate(deadline)) throw new Error('Choose a valid deadline date.');
			const next = await patchTracked(client, item.fp, { deadline, priority, checklist: tasks });
			patchUser((current) => ({ ...current, tracker: current.tracker.map((row) => (row.fp === next.fp ? next : row)) }));
			toast({ variant: 'success', title: 'Application plan saved', body: item.company }, 3000);
		} catch (e) {
			setError(e instanceof Error ? e.message : String(e));
		} finally {
			setBusy(false);
		}
	};
	return (
		<div className="jr-application-plan">
			<h3>Application plan</h3>
			{error && <Banner variant="error">{error}</Banner>}
			<div className="jr-career-grid">
				<CareerField label="Application deadline">
					<input type="date" value={deadline} onChange={(event) => setDeadline(event.target.value)} />
				</CareerField>
				<CareerField label="Priority">
					<select value={priority} onChange={(event) => setPriority(event.target.value as typeof priority)}>
						<option value="low">Low</option>
						<option value="normal">Normal</option>
						<option value="high">High</option>
					</select>
				</CareerField>
			</div>
			<p style={s.small}>
				{tasks.filter((task) => task.done).length} of {tasks.length} preparation steps complete. Save the plan to keep edits.
			</p>
			<div className="jr-checklist">
				{tasks.map((task) => (
					<div key={task.id}>
						<label>
							<input type="checkbox" checked={task.done} onChange={(event) => setTasks((current) => current.map((row) => (row.id === task.id ? { ...row, done: event.target.checked } : row)))} />
							{task.label}
						</label>
						<button type="button" className="jr-career-text-button" aria-label={`Remove task: ${task.label}`} onClick={() => setTasks((current) => current.filter((row) => row.id !== task.id))}>
							×
						</button>
					</div>
				))}
			</div>
			<div style={s.row}>
				<input className="jr-career-input" aria-label="New preparation step" maxLength={150} placeholder="Add a preparation step" value={newTask} onChange={(event) => setNewTask(event.target.value)} />
				<Button
					small
					variant="secondary"
					disabled={!newTask.trim() || tasks.length >= 20}
					onClick={() => {
						setTasks((current) => [...current, { id: crypto.randomUUID(), label: newTask.trim(), done: false }]);
						setNewTask('');
					}}
				>
					Add step
				</Button>
			</div>
			<div style={{ marginTop: 12 }}>
				<Button small disabled={busy} onClick={() => void save()}>
					{busy ? 'Saving...' : 'Save application plan'}
				</Button>
			</div>
		</div>
	);
};

export const KeywordAudit: React.FC<{ resume: string; loadDescription: () => Promise<string> }> = ({ resume, loadDescription }) => {
	const [posting, setPosting] = useState('');
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState('');
	const coverage = posting ? keywordCoverage(posting, resume) : null;
	return (
		<div className="jr-keyword-audit">
			<div style={s.row}>
				<h3>Resume keyword coverage</h3>
				<Button
					small
					variant="secondary"
					disabled={busy || !resume}
					onClick={() => {
						setBusy(true);
						setError('');
						void loadDescription()
							.then((value) => {
								if (!value.trim()) throw new Error('Load or save a readable job description first.');
								setPosting(value);
							})
							.catch((e: unknown) => setError(String(e)))
							.finally(() => setBusy(false));
					}}
				>
					{busy ? 'Checking...' : 'Check keywords'}
				</Button>
			</div>
			<p style={s.small}>Checks skill terms in the posting against the current resume text. This is text coverage, not an ATS score or a hiring prediction.</p>
			{error && <Banner variant="error">{error}</Banner>}
			{coverage && (
				<>
					<strong>{coverage.percent === null ? 'No dictionary skill terms found' : `${coverage.matched.length} of ${coverage.total} skill terms appear (${coverage.percent}%)`}</strong>
					<div className="jr-keyword-groups">
						<div>
							<h4>Present in resume</h4>
							{coverage.matched.map((term) => (
								<span className="jr-keyword-chip jr-keyword-present" key={term}>
									{term}
								</span>
							))}
							{!coverage.matched.length && <p style={s.small}>No matching terms found.</p>}
						</div>
						<div>
							<h4>Not found in resume</h4>
							{coverage.missing.map((term) => (
								<span className="jr-keyword-chip jr-keyword-missing" key={term}>
									{term}
								</span>
							))}
							{!coverage.missing.length && <p style={s.small}>No missing terms detected.</p>}
						</div>
					</div>
					<p style={s.small}>Only add a missing term when your experience supports it. The fixed dictionary can miss other requirements or count a negated mention.</p>
				</>
			)}
		</div>
	);
};
