import React, { useEffect, useState } from 'react';
import { Banner, Button, MarkdownRenderer } from 'shell';
import { write, WRITER_VERSION } from '../lib/ai';
import { downloadFile, interviewCalendar, parseInterviewPrep, type Interview, type InterviewPrep } from '../lib/career';
import { careerPosting } from '../lib/careerApi';
import { sourceHash } from '../lib/documents';
import { dataStore } from '../lib/storage';
import { Panel, s } from '../ui';
import { CareerField } from './CareerForms';
import { useCareer } from './careerHooks';
const localTimeInput = (iso: string) => {
	const date = new Date(iso);
	return Number.isFinite(date.getTime()) ? new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16) : '';
};
export const CareerInterviews: React.FC = () => {
	const { client, user, updateCareer } = useCareer();
	const [fp, setFp] = useState(user?.tracker[0]?.fp ?? '');
	const [edit, setEdit] = useState<Interview | null>(null);
	const [startInput, setStartInput] = useState('');
	const [busy, setBusy] = useState('');
	const [error, setError] = useState('');
	const [notice, setNotice] = useState('');
	const [prep, setPrep] = useState<InterviewPrep | null>(null);
	const [questionIndex, setQuestionIndex] = useState(0);
	const [answer, setAnswer] = useState('');
	const [feedback, setFeedback] = useState('');
	const [removing, setRemoving] = useState('');
	const [answerSaved, setAnswerSaved] = useState(false);
	const resumeHash = sourceHash(user?.resume ?? '');
	useEffect(() => {
		let alive = true;
		setPrep(null);
		setQuestionIndex(0);
		setAnswer('');
		setFeedback('');
		setNotice('');
		setError('');
		if (client && fp)
			void dataStore(client, 'user')
				.getJson<InterviewPrep & { sourceHash: string; writerVersion: string }>(`prep:${fp}`)
				.then((value) => {
					if (alive && value?.sourceHash === resumeHash && value.writerVersion === WRITER_VERSION) setPrep(value);
				})
				.catch((e: unknown) => alive && setError(String(e)));
		return () => {
			alive = false;
		};
	}, [client, fp, resumeHash]);
	if (!client || !user) return null;
	const job = user.tracker.find((item) => item.fp === fp);
	const action = async (name: string, work: () => Promise<void>) => {
		setBusy(name);
		setError('');
		try {
			await work();
		} catch (e) {
			setError(e instanceof Error ? e.message : String(e));
		} finally {
			setBusy('');
		}
	};
	const schedule = (event: React.FormEvent) => {
		event.preventDefault();
		if (!edit) return;
		void action('schedule', async () => {
			const linked = user.tracker.find((item) => item.fp === edit.jobFp);
			if (!linked) throw new Error('Choose a tracked application.');
			const time = new Date(startInput);
			if (!startInput || !Number.isFinite(time.getTime())) throw new Error('Choose a valid interview date and time.');
			const next = { ...edit, start: time.toISOString(), title: edit.title.trim(), location: edit.location.trim() };
			interviewCalendar(next, linked);
			await updateCareer((current) => ({ ...current, interviews: [...current.interviews.filter((item) => item.id !== next.id), next] }));
			setEdit(null);
			setNotice('Interview saved. Download its calendar file to add it to your calendar.');
		});
	};
	const field = (key: 'title' | 'jobFp' | 'location' | 'notes') => ({ value: edit?.[key] ?? '', onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setEdit((current) => current && { ...current, [key]: event.target.value }) });
	const getDescription = async () => {
		if (!job) return '';
		try {
			return await careerPosting(client, job);
		} catch {
			setNotice('The posting could not be read. Practice uses the role title, company, and your resume; add a saved description for more specific questions.');
			return '';
		}
	};
	return (
		<div className="jr-career-stack">
			<div className="jr-career-toolbar">
				<div>
					<h2>Arrive with a plan.</h2>
					<p>Keep interview dates, practice questions, and evidence from your experience together.</p>
				</div>
				<Button
					small
					disabled={!!busy || !user.tracker.length}
					onClick={() => {
						setEdit({ id: crypto.randomUUID(), jobFp: fp || user.tracker[0].fp, title: 'Interview', start: '', minutes: 30, location: '', notes: '' });
						setStartInput('');
					}}
				>
					Schedule interview
				</Button>
			</div>
			{error && <Banner variant="error">{error}</Banner>}
			{notice && <Banner variant="info">{notice}</Banner>}
			{edit && (
				<Panel header="Interview details">
					<form onSubmit={schedule}>
						<fieldset className="jr-career-form" disabled={!!busy}>
							<CareerField label="Interview application">
								<select required {...field('jobFp')}>
									{user.tracker.map((item) => (
										<option key={item.fp} value={item.fp}>
											{item.company}: {item.title}
										</option>
									))}
								</select>
							</CareerField>
							<CareerField label="Interview type">
								<input required maxLength={150} {...field('title')} />
							</CareerField>
							<div className="jr-career-grid">
								<CareerField label="Date and time (your local time)">
									<input required type="datetime-local" value={startInput} onChange={(event) => setStartInput(event.target.value)} />
								</CareerField>
								<CareerField label="Duration in minutes">
									<input type="number" required min={5} max={480} value={edit.minutes} onChange={(event) => setEdit({ ...edit, minutes: Number(event.target.value) })} />
								</CareerField>
							</div>
							<CareerField label="Location or meeting link">
								<input maxLength={2000} {...field('location')} />
							</CareerField>
							<CareerField label="Interview notes">
								<textarea rows={3} maxLength={4000} {...field('notes')} />
							</CareerField>
							<div style={s.row}>
								<button className="jr-career-primary" disabled={!!busy} type="submit">
									Save interview
								</button>
								<Button variant="ghost" small disabled={!!busy} onClick={() => setEdit(null)}>
									Cancel
								</Button>
							</div>
						</fieldset>
					</form>
				</Panel>
			)}
			{user.career.interviews.length > 0 && (
				<Panel header="Interview calendar">
					{[...user.career.interviews]
						.sort((a, b) => a.start.localeCompare(b.start))
						.map((event) => {
							const linked = user.tracker.find((item) => item.fp === event.jobFp);
							return (
								<div className="jr-interview-event" key={event.id}>
									<div>
										<strong>
											{event.title} · {linked?.company ?? 'Previously tracked role'}
										</strong>
										<p>
											{new Date(event.start).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })} · {event.minutes} min
										</p>
										{event.location && <p style={s.small}>{event.location}</p>}
										{event.notes && <p className="jr-career-note">{event.notes}</p>}
									</div>
									<div style={s.row}>
										<Button
											small
											variant="secondary"
											onClick={() => {
												try {
													downloadFile(interviewCalendar(event, linked ?? { title: event.title, company: 'Interview' }), 'jobradar-interview.ics', 'text/calendar;charset=utf-8');
												} catch (e) {
													setError(String(e));
												}
											}}
										>
											Download calendar file
										</Button>
										<Button
											small
											variant="ghost"
											disabled={!!busy}
											onClick={() => {
												setEdit({ ...event });
												setStartInput(localTimeInput(event.start));
											}}
										>
											Edit
										</Button>
										<Button small variant="ghost" disabled={!!busy} onClick={() => setRemoving(event.id)}>
											Remove
										</Button>
									</div>
									{removing === event.id && (
										<div className="jr-career-inline-confirm">
											<p>Remove this interview from JobRadar? Existing calendar copies stay in your calendar.</p>
											<Button
												small
												variant="secondary"
												disabled={!!busy}
												onClick={() =>
													void action('remove', async () => {
														await updateCareer((current) => ({ ...current, interviews: current.interviews.filter((item) => item.id !== event.id) }));
														setRemoving('');
													})
												}
											>
												Confirm remove interview
											</Button>
											<Button variant="ghost" small onClick={() => setRemoving('')}>
												Keep interview
											</Button>
										</div>
									)}
								</div>
							);
						})}
				</Panel>
			)}
			<Panel header="Practice for a specific role">
				<div className="jr-career-form">
					<CareerField label="Practice application">
						<select value={fp} disabled={!!busy} onChange={(event) => setFp(event.target.value)}>
							<option value="">Choose a tracked job</option>
							{user.tracker.map((item) => (
								<option key={item.fp} value={item.fp}>
									{item.company}: {item.title}
								</option>
							))}
						</select>
					</CareerField>
					<div style={s.row}>
						<Button
							small
							disabled={!!busy || !job || !user.resume}
							onClick={() =>
								void action('prep', async () => {
									if (!job) return;
									const description = await getDescription();
									const next = parseInterviewPrep(await write(client, 'interview_prep', { source_resume: user.resume, job: { title: job.title, company: job.company, description: description.slice(0, 16000) } }), user.resume);
									await dataStore(client, 'user').setJson(`prep:${job.fp}`, { ...next, sourceHash: resumeHash, writerVersion: WRITER_VERSION }, 0);
									setPrep(next);
									setQuestionIndex(0);
									setAnswer('');
									setFeedback('');
								})
							}
						>
							{busy === 'prep' ? 'Preparing questions...' : prep ? 'Refresh practice plan' : 'Build practice plan'}
						</Button>
						<span style={s.small}>Uses your original resume and the saved posting. Questions are practice suggestions.</span>
					</div>
					{!user.resume && <p style={s.muted}>Add your resume on Profile before generating a practice plan.</p>}
					{!user.tracker.length && <p style={s.muted}>Save or add a role in Job Tracker to start practising.</p>}
				</div>
				{prep && (
					<div className="jr-career-stack">
						<div className="jr-question-list">
							{prep.questions.map((question, index) => (
								<button
									type="button"
									key={index}
									className={questionIndex === index ? 'is-selected' : ''}
									disabled={!!busy}
									onClick={() => {
										setQuestionIndex(index);
										setAnswer('');
										setFeedback('');
										setAnswerSaved(false);
									}}
								>
									<span>{index + 1}</span>
									<div>
										<strong>{question.question}</strong>
										<small>{question.focus}</small>
									</div>
								</button>
							))}
						</div>
						<CareerField label="Your practice answer">
							<textarea
								disabled={!!busy}
								rows={7}
								maxLength={8000}
								value={answer}
								placeholder="Use a real example. Explain the situation, your task, the action you took, and the actual result."
								onChange={(event) => {
									setAnswer(event.target.value);
									setFeedback('');
									setAnswerSaved(false);
								}}
							/>
						</CareerField>
						<div style={s.row}>
							<Button
								small
								disabled={!!busy || answer.trim().length < 30}
								onClick={() =>
									void action('feedback', async () => {
										setFeedback(await write(client, 'practice_feedback', { source_resume: user.resume, question: prep.questions[questionIndex].question, answer, job: { title: job?.title, company: job?.company } }));
									})
								}
							>
								{busy === 'feedback' ? 'Reviewing your answer...' : 'Get practice feedback'}
							</Button>
							<Button
								small
								variant="secondary"
								disabled={!!busy || !answer.trim() || answerSaved}
								onClick={() =>
									void action('answer', async () => {
										await updateCareer((current) => ({ ...current, answers: [{ id: crypto.randomUUID(), question: prep.questions[questionIndex].question, text: answer.trim(), updatedAt: Date.now() }, ...current.answers] }));
										setAnswerSaved(true);
									})
								}
							>
								{answerSaved ? 'Saved in answer bank' : 'Save answer to library'}
							</Button>
						</div>
						{feedback && (
							<div className="jr-practice-feedback">
								<MarkdownRenderer content={feedback} />
							</div>
						)}
						<div className="jr-career-grid jr-career-wide-grid">
							<div>
								<h3>Stories you can support</h3>
								{prep.stories.length ? (
									prep.stories.map((story, index) => (
										<div className="jr-story" key={index}>
											<strong>{story.headline}</strong>
											<blockquote>{story.evidence}</blockquote>
											<p>{story.angle}</p>
										</div>
									))
								) : (
									<p style={s.muted}>No exact source quotes were returned. Choose a real example from your resume.</p>
								)}
							</div>
							<div>
								<h3>Questions to ask the interviewer</h3>
								<ul className="jr-career-bullets">
									{prep.askEmployer.map((question, index) => (
										<li key={index}>{question}</li>
									))}
								</ul>
							</div>
						</div>
						<p style={s.small}>Practice plan saved {new Date(prep.createdAt).toLocaleString()}.</p>
					</div>
				)}
			</Panel>
		</div>
	);
};
