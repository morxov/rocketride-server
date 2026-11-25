/**
 * Profile and sources: resume import, what to look for, where to look.
 */

import React, { useEffect, useState } from 'react';
import { Button, Chip, ChipAdd, ConfirmDialog, DropZone, InputField, LabelValue, Section, StatusBadge, ToggleGroup } from 'shell';
import { importResume, sampleResume } from '../lib/ai';
import { DEFAULT_PREFS, prefsFromProfile, type Prefs, type Profile as ProfileT } from '../lib/match';
import { detectBoard, SIMPLIFY_SOURCES, type Level } from '../lib/sources';
import { replayRecent, resetAll, savePrefs, saveProfile, saveResume } from '../lib/store';
import { toast, useApp } from '../state';
import { Panel as Card, PageHeader as ContentHeader, s } from '../ui';
import { Icon } from '../icons';

const pr: Record<string, React.CSSProperties> = {
	chips: { display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' },
	evidence: { margin: '2px 0 0', paddingLeft: 18, fontSize: 12.5, lineHeight: 1.5, color: 'var(--rr-text-secondary)' },
	inline: { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' },
};

/** Editable list of short strings: chips plus an inline add box. */
const ChipList: React.FC<{ items: string[]; onChange: (v: string[]) => void; addLabel: string }> = ({ items, onChange, addLabel }) => {
	const [adding, setAdding] = useState(false);
	const [value, setValue] = useState('');
	const add = () => {
		const v = value.trim();
		if (v && !items.includes(v)) onChange([...items, v]);
		setValue('');
		setAdding(false);
	};
	return (
		<div style={pr.chips}>
			{items.map((i) => (
				<Chip key={i} label={i} onRemove={() => onChange(items.filter((x) => x !== i))} />
			))}
			{adding ? (
				<div style={{ width: 200 }}>
					<InputField autoFocus value={value} onChange={(e) => setValue(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && add()} onBlur={add} placeholder="Type and press Enter" />
				</div>
			) : (
				<ChipAdd label={addLabel} onClick={() => setAdding(true)} />
			)}
		</div>
	);
};

export const Profile: React.FC = () => {
	const app = useApp();
	const { client, user } = app;
	const [importing, setImporting] = useState<string | null>(null);
	const [prefs, setPrefs] = useState<Prefs>(user?.prefs ?? DEFAULT_PREFS);
	const [slug, setSlug] = useState('');
	const [detecting, setDetecting] = useState(false);
	const [confirmReset, setConfirmReset] = useState(false);

	useEffect(() => {
		if (user) setPrefs(user.prefs);
	}, [user?.prefs]);

	if (!user || !client) return null;
	const dirty = JSON.stringify(prefs) !== JSON.stringify(user.prefs);

	const onFiles = async (files: FileList) => {
		const file = Array.from(files).find((f) => /\.(pdf|docx?|txt|md)$/i.test(f.name));
		if (!file) {
			toast({ variant: 'error', title: 'Unsupported file', body: 'Drop a PDF, DOCX or TXT resume.' });
			return;
		}
		setImporting(file.name);
		try {
			const { profile, text } = await importResume(client, file);
			const nextPrefs = user.profile ? { ...prefs, roles: profile.target_roles.length ? profile.target_roles : prefs.roles, levels: [profile.level] } : prefsFromProfile(profile, prefs);
			await Promise.all([saveProfile(client, profile), saveResume(client, text), savePrefs(client, nextPrefs)]);
			app.patchUser((u) => ({ ...u, profile, resume: text, prefs: nextPrefs }));
			setPrefs(nextPrefs);
			toast({ variant: 'success', title: 'Resume imported', body: `${profile.skills.length} skills and ${profile.target_roles.length} target roles found. Checking jobs for you now.` });
			void app.refreshNow();
		} catch (e) {
			toast({ variant: 'error', title: 'Import failed', body: e instanceof Error ? e.message : String(e) });
		} finally {
			setImporting(null);
		}
	};

	const savePrefsNow = async () => {
		const levelsChanged = JSON.stringify(prefs.levels) !== JSON.stringify(user.prefs.levels) || JSON.stringify(prefs.watched) !== JSON.stringify(user.prefs.watched) || prefs.maxAgeDays !== user.prefs.maxAgeDays;
		await savePrefs(client, prefs);
		app.patchUser((u) => ({ ...u, prefs }));
		toast({ variant: 'success', title: 'Preferences saved', body: levelsChanged ? 'Sources changed, checking them now.' : 'Scores updated.' }, 4000);
		if (levelsChanged) void app.refreshNow();
	};

	const saveProfileEdit = async (p: ProfileT) => {
		await saveProfile(client, p);
		app.patchUser((u) => ({ ...u, profile: p }));
	};

	const addCompany = async () => {
		if (!slug.trim()) return;
		setDetecting(true);
		try {
			const found = await detectBoard(slug);
			if (!found) {
				toast({ variant: 'warning', title: 'Board not found', body: `No public Greenhouse, Lever or Ashby board called "${slug}". Use the name from the company's careers URL, e.g. greenhouse.io/<name>.` });
				return;
			}
			if (prefs.watched.some((w) => w.slug === found.slug && w.ats === found.ats)) return;
			setPrefs({ ...prefs, watched: [...prefs.watched, found] });
			setSlug('');
		} finally {
			setDetecting(false);
		}
	};

	const replay = async () => {
		const n = await replayRecent(client, 24);
		app.setSince(Math.floor(Date.now() / 1000) - 24 * 3600);
		toast({ variant: 'info', title: 'Replaying the last 24 hours', body: `Forgot ${n} postings first seen in the last day. They will pop up as new on this check.` }, 5000);
		await app.refreshNow();
	};

	const toggleLevel = (lvl: Level) => {
		const has = prefs.levels.includes(lvl);
		const levels = has ? prefs.levels.filter((l) => l !== lvl) : [...prefs.levels, lvl];
		if (levels.length) setPrefs({ ...prefs, levels });
	};

	const p = user.profile;
	return (
		<div style={s.page}>
			<div style={s.inner}>
				<ContentHeader
					title="Profile and sources"
					subtitle="Your experience, your preferences, your next opportunity. Fine-tune what comes your way."
					actions={
						<Button disabled={!dirty} onClick={() => void savePrefsNow()}>
							Save preferences
						</Button>
					}
				/>
				<div style={s.stack}>
					{!p && (
						<section className="jr-onboarding">
							<div>
								<h2>Less searching. More finding your fit.</h2>
								<p>Add your resume and we’ll bring the relevant roles into focus, with clear reasons for every match.</p>
								<ol className="jr-steps">
									<li>
										<span>1</span>Add your resume
									</li>
									<li>
										<span>2</span>Set your preferences
									</li>
									<li>
										<span>3</span>Explore your matches
									</li>
								</ol>
							</div>
							<div className="jr-signal" aria-hidden="true">
								<div className="jr-signal-document">
									<Icon name="file" size={28} />
								</div>
								<i className="jr-signal-dot" />
							</div>
						</section>
					)}
					<div className="jr-profile-grid">
						<Card header="Your resume" headerActions={<span style={s.small}>{p ? 'Profile ready' : 'Start here'}</span>}>
							{importing ? (
								<div style={s.text}>Reading {importing}... this takes a few seconds.</div>
							) : (
								<>
									<div className="jr-upload">
										<DropZone title={p ? 'Drop a new resume to update' : 'Drop your resume here'} hint="or click to browse · PDF, DOCX or TXT" onFiles={(f) => void onFiles(f)} />
									</div>
									{!p && (
										<div className="jr-sample">
											<Button
												variant="ghost"
												onClick={() =>
													void sampleResume()
														.then((f) => {
															const dt = new DataTransfer();
															dt.items.add(f);
															return onFiles(dt.files);
														})
														.catch((e) => toast({ variant: 'error', title: 'Sample failed', body: String(e) }))
												}
											>
												Try it with a sample resume <Icon name="arrow" size={15} />
											</Button>
										</div>
									)}
								</>
							)}
							<div className="jr-upload-note">
								<Icon name="shield" size={16} />
								<span>Your resume is saved in your signed-in RocketRide workspace. The writer uses it to explain matches and tailor drafts.</span>
							</div>
							{p && (
								<div style={{ marginTop: 12 }}>
									<Section label="Profile">
										<LabelValue label="Name">{p.name || '-'}</LabelValue>
										<LabelValue label="Summary">{p.headline || '-'}</LabelValue>
										<LabelValue label="Level">
											{p.level === 'intern' ? 'Internships' : 'New grad'}
											{p.graduation ? ` · graduating ${p.graduation}` : ''}
										</LabelValue>
									</Section>
									<Section label="Skills">
										<ChipList items={p.skills} addLabel="Add skill" onChange={(skills) => void saveProfileEdit({ ...p, skills })} />
									</Section>
									<Section label="Evidence the AI may quote">
										<ul style={pr.evidence}>
											{p.evidence.map((e) => (
												<li key={e}>{e}</li>
											))}
										</ul>
									</Section>
								</div>
							)}
						</Card>

						<Card header="Your preferences">
							<Section label="Level">
								<div style={pr.chips}>
									{(['intern', 'new_grad'] as Level[]).map((lvl) => (
										<Button key={lvl} small variant={prefs.levels.includes(lvl) ? 'primary' : 'secondary'} pressed={prefs.levels.includes(lvl)} onClick={() => toggleLevel(lvl)}>
											{SIMPLIFY_SOURCES[lvl].label.replace('Simplify ', '')}
										</Button>
									))}
								</div>
							</Section>
							<Section label="Target roles">
								<ChipList items={prefs.roles} addLabel="Add role" onChange={(roles) => setPrefs({ ...prefs, roles })} />
							</Section>
							<Section label="Locations · leave empty for anywhere">
								<ChipList items={prefs.locations} addLabel="Add city" onChange={(locations) => setPrefs({ ...prefs, locations })} />
							</Section>
							<Section label="Options">
								<div style={{ ...s.row, marginBottom: 8 }}>
									<Button small variant={prefs.remoteOk ? 'primary' : 'secondary'} pressed={prefs.remoteOk} onClick={() => setPrefs({ ...prefs, remoteOk: !prefs.remoteOk })}>
										Remote counts as a location match
									</Button>
									<Button small variant={prefs.needsSponsorship ? 'primary' : 'secondary'} pressed={prefs.needsSponsorship} onClick={() => setPrefs({ ...prefs, needsSponsorship: !prefs.needsSponsorship })}>
										I need visa sponsorship
									</Button>
								</div>
								<div style={pr.inline}>
									<span style={s.small}>Minimum score</span>
									<ToggleGroup
										options={[
											{ id: '30', label: '30' },
											{ id: '45', label: '45' },
											{ id: '60', label: '60' },
											{ id: '75', label: '75' },
										]}
										value={String(prefs.minScore)}
										onChange={(v) => setPrefs({ ...prefs, minScore: Number(v) })}
									/>
								</div>
								<div style={{ ...pr.inline, marginTop: 8 }}>
									<span style={s.small}>Posted within</span>
									<ToggleGroup
										options={[
											{ id: '7', label: '7 days' },
											{ id: '14', label: '14 days' },
											{ id: '30', label: '30 days' },
											{ id: '60', label: '60 days' },
										]}
										value={String(prefs.maxAgeDays)}
										onChange={(v) => setPrefs({ ...prefs, maxAgeDays: Number(v) })}
									/>
								</div>
							</Section>
							<Section label="Skip companies">
								<ChipList items={prefs.excludeCompanies} addLabel="Skip a company" onChange={(excludeCompanies) => setPrefs({ ...prefs, excludeCompanies })} />
							</Section>
						</Card>
					</div>

					<Card header="Where we look" headerActions={<span style={s.small}>{prefs.levels.length + prefs.watched.length} active sources</span>}>
						<div className="jr-source-tags">
							{prefs.levels.map((level) => (
								<span className="jr-source-tag" key={level}>
									<Icon name="check" size={13} />
									{SIMPLIFY_SOURCES[level].label}
								</span>
							))}
						</div>
						<div style={{ ...s.muted, marginBottom: 10 }}>We check the SimplifyJobs lists for new roles. Follow a company to include its Greenhouse, Lever or Ashby careers board too.</div>
						<div style={pr.chips}>
							{prefs.watched.map((w) => (
								<Chip key={`${w.ats}:${w.slug}`} label={`${w.name ?? w.slug} (${w.ats})`} onRemove={() => setPrefs({ ...prefs, watched: prefs.watched.filter((x) => x !== w) })} />
							))}
						</div>
						<div style={{ ...s.row, marginTop: 10 }}>
							<div style={{ width: 320, maxWidth: '100%' }}>
								<InputField placeholder="Company board name, e.g. ramp, scaleai" value={slug} onChange={(e) => setSlug(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void addCompany()} />
							</div>
							<Button variant="secondary" small disabled={detecting || !slug.trim()} onClick={() => void addCompany()}>
								{detecting ? 'Looking...' : 'Watch company'}
							</Button>
							{dirty && <StatusBadge variant="warning">Unsaved changes</StatusBadge>}
						</div>
					</Card>

					<details className="jr-data-controls">
						<summary>Demo and data controls</summary>
						<div style={s.row}>
							<Button variant="secondary" small onClick={() => void replay()}>
								Replay the last 24 hours as new
							</Button>
							<span style={s.small}>Forgets which recent postings were already seen, so the next check pops them up again. Real postings, nothing invented.</span>
						</div>
						<div style={{ ...s.row, marginTop: 10 }}>
							<Button variant="danger" small onClick={() => setConfirmReset(true)}>
								Delete all JobRadar data
							</Button>
							<span style={s.small}>Removes your profile, tracker, reminders and the job index from your workspace.</span>
						</div>
					</details>
				</div>
			</div>
			{confirmReset && (
				<ConfirmDialog
					title="Delete all JobRadar data?"
					message="This removes your resume profile, every tracked application, reminders, notes and the job index from your workspace. It cannot be undone."
					confirmLabel="Delete everything"
					destructive
					onConfirm={() => {
						setConfirmReset(false);
						void resetAll(client).then((n) => {
							toast({ variant: 'info', title: 'Deleted', body: `${n} keys removed. Reloading.` }, 3000);
							setTimeout(() => window.location.reload(), 800);
						});
					}}
					onCancel={() => setConfirmReset(false)}
				/>
			)}
		</div>
	);
};
