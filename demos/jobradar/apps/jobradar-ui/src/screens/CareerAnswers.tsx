import React, { useState } from 'react';
import { Banner, Button } from 'shell';
import { write } from '../lib/ai';
import { downloadFile, type SavedAnswer } from '../lib/career';
import { Panel, s } from '../ui';
import { CareerField } from './CareerForms';
import { useCareer } from './careerHooks';
export const CareerAnswers: React.FC = () => {
	const { client, user, updateCareer } = useCareer();
	const [id, setId] = useState('');
	const [question, setQuestion] = useState('');
	const [answer, setAnswer] = useState('');
	const [notes, setNotes] = useState('');
	const [fp, setFp] = useState('');
	const [maxWords, setMaxWords] = useState(200);
	const [query, setQuery] = useState('');
	const [busy, setBusy] = useState('');
	const [error, setError] = useState('');
	const [notice, setNotice] = useState('');
	const [removing, setRemoving] = useState('');
	if (!client || !user) return null;
	const action = async (name: string, work: () => Promise<void>) => {
		setBusy(name);
		setError('');
		setNotice('');
		try {
			await work();
		} catch (e) {
			setError(e instanceof Error ? e.message : String(e));
		} finally {
			setBusy('');
		}
	};
	const reset = () => {
		setId('');
		setQuestion('');
		setAnswer('');
		setNotes('');
		setNotice('');
	};
	const words = answer.trim() ? answer.trim().split(/\s+/).length : 0;
	const answers = user.career.answers.filter((entry) => `${entry.question} ${entry.text}`.toLowerCase().includes(query.toLowerCase()));
	return (
		<div className="jr-career-stack">
			<div className="jr-career-toolbar">
				<div>
					<h2>Start with your own best words.</h2>
					<p>Keep reusable application answers and improve them for the role in front of you.</p>
				</div>
				<Button small variant="secondary" disabled={!!busy} onClick={reset}>
					New answer
				</Button>
			</div>
			{error && <Banner variant="error">{error}</Banner>}
			{notice && <Banner variant="info">{notice}</Banner>}
			<div className="jr-career-grid jr-career-wide-grid">
				<Panel header={id ? 'Edit saved answer' : 'Build an application answer'}>
					<fieldset className="jr-career-form" disabled={!!busy}>
						<CareerField label="Application question">
							<textarea rows={3} maxLength={1500} placeholder="Why are you interested in this role?" value={question} onChange={(event) => setQuestion(event.target.value)} />
						</CareerField>
						<CareerField label="Answer application (optional)">
							<select value={fp} disabled={!!busy} onChange={(event) => setFp(event.target.value)}>
								<option value="">General answer</option>
								{user.tracker.map((job) => (
									<option key={job.fp} value={job.fp}>
										{job.company}: {job.title}
									</option>
								))}
							</select>
						</CareerField>
						<CareerField label="Facts or details to include">
							<textarea rows={3} maxLength={4000} placeholder="Add specific facts the resume does not cover. Do not include facts you cannot support." value={notes} onChange={(event) => setNotes(event.target.value)} />
						</CareerField>
						<div className="jr-answer-limit">
							<CareerField label="Draft word limit">
								<input type="number" min={50} max={500} value={maxWords} onChange={(event) => setMaxWords(Number(event.target.value))} />
							</CareerField>
							<Button
								small
								disabled={!!busy || !question.trim() || !user.resume || !Number.isInteger(maxWords) || maxWords < 50 || maxWords > 500}
								onClick={() =>
									void action('draft', async () => {
										const job = user.tracker.find((item) => item.fp === fp);
										setAnswer(await write(client, 'application_answer', { source_resume: user.resume, question, user_notes: notes, max_words: maxWords, job: job && { title: job.title, company: job.company, description: job.description?.slice(0, 12000) ?? '' } }));
									})
								}
							>
								{busy === 'draft' ? 'Drafting...' : 'Draft from my experience'}
							</Button>
						</div>
						{!user.resume && <p style={s.small}>You can write and save answers manually, or add your resume on Profile to use the writer.</p>}
						<CareerField label="Your application answer">
							<textarea rows={9} maxLength={12000} value={answer} onChange={(event) => setAnswer(event.target.value)} />
						</CareerField>
						<p className={words > maxWords ? 'jr-overdue' : ''} style={s.small}>
							{words} words · target {maxWords}
							{words > maxWords ? '. Shorten this draft to meet the target.' : ''}
						</p>
						<div style={s.row}>
							<Button
								small
								disabled={!!busy || !question.trim() || !answer.trim()}
								onClick={() =>
									void action('save', async () => {
										const entry: SavedAnswer = { id: id || crypto.randomUUID(), question: question.trim(), text: answer.trim(), updatedAt: Date.now() };
										await updateCareer((current) => ({ ...current, answers: [entry, ...current.answers.filter((item) => item.id !== entry.id)] }));
										setId(entry.id);
										setNotice('Answer saved in your library.');
									})
								}
							>
								Save answer
							</Button>
							<Button small variant="secondary" disabled={!answer.trim()} onClick={() => void navigator.clipboard.writeText(answer).catch(() => setError('Copy failed. Select the text to copy manually.'))}>
								Copy answer
							</Button>
							<Button small variant="ghost" disabled={!answer.trim()} onClick={() => downloadFile(`${question}\n\n${answer}`, 'jobradar-application-answer.txt', 'text/plain;charset=utf-8')}>
								Download TXT
							</Button>
						</div>
						<p style={s.small}>Review every answer before using it. Drafting or saving never fills or submits an application.</p>
					</fieldset>
				</Panel>
				<Panel header={`Saved answers (${user.career.answers.length})`}>
					<CareerField label="Search saved answers">
						<input value={query} placeholder="Search questions and answers" onChange={(event) => setQuery(event.target.value)} />
					</CareerField>
					{answers.map((entry) => (
						<article className="jr-saved-answer" key={entry.id}>
							<h3>{entry.question}</h3>
							<p>{entry.text}</p>
							<small>Saved {new Date(entry.updatedAt).toLocaleDateString()}</small>
							<div style={s.row}>
								<Button
									small
									variant="secondary"
									disabled={!!busy}
									onClick={() => {
										setId(entry.id);
										setQuestion(entry.question);
										setAnswer(entry.text);
										setNotes('');
										setNotice('');
									}}
								>
									Edit answer
								</Button>
								<Button small variant="ghost" disabled={!!busy} onClick={() => setRemoving(entry.id)}>
									Remove
								</Button>
							</div>
							{removing === entry.id && (
								<div className="jr-career-inline-confirm">
									<p>Remove this saved answer?</p>
									<Button
										small
										variant="secondary"
										disabled={!!busy}
										onClick={() =>
											void action('remove', async () => {
												await updateCareer((current) => ({ ...current, answers: current.answers.filter((item) => item.id !== entry.id) }));
												setRemoving('');
												if (id === entry.id) reset();
											})
										}
									>
										Confirm remove answer
									</Button>
									<Button small variant="ghost" onClick={() => setRemoving('')}>
										Keep answer
									</Button>
								</div>
							)}
						</article>
					))}
					{!answers.length && (
						<div className="jr-career-empty">
							<h3>Your answer library is ready.</h3>
							<p>Write an answer, or save one from interview practice.</p>
						</div>
					)}
				</Panel>
			</div>
		</div>
	);
};
