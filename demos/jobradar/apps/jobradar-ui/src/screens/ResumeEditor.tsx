import React, { useEffect, useState } from 'react';
import { Banner, Button, Section } from 'shell';
import { write } from '../lib/ai';
import { dataStore } from '../lib/storage';
import { downloadText, printResume, readTailoredResume, sourceHash, type TailoredResume } from '../lib/documents';
import { toast, useApp } from '../state';
import { s } from '../ui';

export const ResumeEditor: React.FC<{ fp: string; title: string; company: string; loadDescription: () => Promise<string> }> = ({ fp, title, company, loadDescription }) => {
	const { client, user, setView, openJob } = useApp();
	const [saved, setSaved] = useState<TailoredResume | null>(null);
	const [text, setText] = useState('');
	const [busy, setBusy] = useState(false);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState('');
	const source = user?.resume ?? '';
	useEffect(() => {
		let alive = true;
		if (!client) return;
		void dataStore(client, 'user')
			.getJson<TailoredResume>(`tailored:${fp}`)
			.then((value) => {
				if (!alive) return;
				if (value?.sourceHash === sourceHash(source)) {
					setSaved(value);
					setText(value.text);
				}
			})
			.catch((e: unknown) => alive && setError(String(e)))
			.finally(() => alive && setLoading(false));
		return () => {
			alive = false;
		};
	}, [client, fp, source]);
	const generate = async () => {
		if (!client || !source) return;
		setBusy(true);
		setError('');
		try {
			const description = await loadDescription();
			const version = readTailoredResume(await write(client, 'resume', { source_resume: source, job: { title, company, description: description.slice(0, 16000) } }), source);
			await dataStore(client, 'user').setJson(`tailored:${fp}`, version, 0);
			setSaved(version);
			setText(version.text);
		} catch (e) {
			setError(e instanceof Error ? e.message : String(e));
		} finally {
			setBusy(false);
		}
	};
	const save = async () => {
		if (!client || !saved) return;
		setBusy(true);
		setError('');
		try {
			const next = { ...saved, text, updatedAt: Date.now() };
			await dataStore(client, 'user').setJson(`tailored:${fp}`, next, 0);
			setSaved(next);
			toast({ variant: 'success', title: 'Resume version saved', body: company }, 3000);
		} catch (e) {
			setError(String(e));
		} finally {
			setBusy(false);
		}
	};
	return (
		<div className="jr-resume-editor">
			<div className="jr-feature-intro">
				<span className="jr-eyebrow">A resume for this role</span>
				<h3>Make your experience relevant.</h3>
				<p>Emphasize experience you already have, with wording and priorities tailored to {company}.</p>
			</div>
			{error && <Banner variant="error">{error}</Banner>}
			{!source ? (
				<>
					<p>Add your resume before creating a tailored version.</p>
					<Button
						onClick={() => {
							openJob(null);
							setView('profile');
						}}
					>
						Add your resume
					</Button>
				</>
			) : (
				<>
					<div style={{ ...s.row, margin: '12px 0' }}>
						<Button disabled={busy || loading} onClick={() => void generate()}>
							{busy ? 'Working...' : saved ? 'Create a fresh version' : 'Tailor my resume'}
						</Button>
						<span style={s.small}>Your original stays in Profile.</span>
					</div>
					{saved && (
						<>
							<Section label="What changed">
								<ul>
									{saved.changes.map((change, i) => (
										<li key={i}>{change}</li>
									))}
								</ul>
							</Section>
							{saved.gaps.length > 0 && (
								<Section label="Requirements to review">
									<ul>
										{saved.gaps.map((gap, i) => (
											<li key={i}>{gap}</li>
										))}
									</ul>
								</Section>
							)}
							<label className="jr-field-label" htmlFor={`resume-${fp}`}>
								Review and edit your resume
							</label>
							<textarea id={`resume-${fp}`} className="jr-resume-text" value={text} onChange={(e) => setText(e.target.value)} spellCheck />
							<div style={{ ...s.row, marginTop: 12 }}>
								<Button small disabled={busy || !text.trim() || text === saved.text} onClick={() => void save()}>
									Save edits
								</Button>
								<Button small variant="secondary" disabled={!text.trim()} onClick={() => downloadText(text, `${company}-${title}-resume`)}>
									Download TXT
								</Button>
								<Button
									small
									variant="secondary"
									disabled={!text.trim()}
									onClick={() => {
										try {
											printResume(text, `${company} resume`);
										} catch (e) {
											setError(String(e));
										}
									}}
								>
									Print / Save PDF
								</Button>
							</div>
							<p style={s.small}>Check every claim before using this draft. Saved {new Date(saved.updatedAt).toLocaleString()}.</p>
						</>
					)}
				</>
			)}
		</div>
	);
};
