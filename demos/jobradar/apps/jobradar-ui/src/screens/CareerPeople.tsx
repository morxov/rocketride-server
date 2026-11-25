import React, { useState } from 'react';
import { Banner, Button } from 'shell';
import { write } from '../lib/ai';
import { calendarDate, webUrl, type Contact } from '../lib/career';
import { localDate } from '../lib/store';
import { Panel, s } from '../ui';
import { CareerField } from './CareerForms';
import { useCareer } from './careerHooks';
const blankContact = (): Contact => ({ id: crypto.randomUUID(), name: '', company: '', role: '', email: '', link: '', jobFp: '', notes: '', lastContact: '', followUp: '' });
export const CareerPeople: React.FC = () => {
	const { client, user, updateCareer } = useCareer();
	const [edit, setEdit] = useState<Contact | null>(null);
	const [busy, setBusy] = useState('');
	const [error, setError] = useState('');
	const [query, setQuery] = useState('');
	const [draft, setDraft] = useState<{ id: string; text: string } | null>(null);
	const [removing, setRemoving] = useState('');
	if (!user || !client) return null;
	const action = async (work: () => Promise<void>, name = 'save') => {
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
	const save = async (event: React.FormEvent) => {
		event.preventDefault();
		if (!edit) return;
		void action(async () => {
			if (!edit.name.trim() || !edit.company.trim()) throw new Error('Add a name and company.');
			if ((edit.followUp && !calendarDate(edit.followUp)) || (edit.lastContact && !calendarDate(edit.lastContact))) throw new Error('Choose valid contact dates.');
			const contact = { ...edit, name: edit.name.trim(), company: edit.company.trim(), link: edit.link.trim() ? webUrl(edit.link) : '' };
			await updateCareer((current) => ({ ...current, contacts: [contact, ...current.contacts.filter((item) => item.id !== contact.id)] }));
			setEdit(null);
		});
	};
	const field = (key: keyof Contact) => ({ value: edit?.[key] ?? '', onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setEdit((current) => current && { ...current, [key]: event.target.value }) });
	const contacts = user.career.contacts.filter((contact) => `${contact.name} ${contact.company} ${contact.role} ${contact.notes}`.toLowerCase().includes(query.toLowerCase()));
	return (
		<div className="jr-career-stack">
			<div className="jr-career-toolbar">
				<div>
					<h2>People behind the opportunity</h2>
					<p>Keep recruiters, mentors, and referral conversations in one place.</p>
				</div>
				<Button
					small
					disabled={!!busy}
					onClick={() => {
						setEdit(blankContact());
						setError('');
					}}
				>
					Add contact
				</Button>
			</div>
			{error && <Banner variant="error">{error}</Banner>}
			{edit && (
				<Panel header={user.career.contacts.some((contact) => contact.id === edit.id) ? 'Edit contact' : 'New contact'}>
					<form onSubmit={(event) => void save(event)}>
						<fieldset className="jr-career-form" disabled={!!busy}>
							<div className="jr-career-grid">
								<CareerField label="Contact name">
									<input required maxLength={150} autoFocus {...field('name')} />
								</CareerField>
								<CareerField label="Company">
									<input required maxLength={200} {...field('company')} />
								</CareerField>
								<CareerField label="Role or connection">
									<input maxLength={200} placeholder="Recruiter, alumni, teammate..." {...field('role')} />
								</CareerField>
								<CareerField label="Email">
									<input type="email" maxLength={254} {...field('email')} />
								</CareerField>
							</div>
							<CareerField label="LinkedIn or website">
								<input type="url" maxLength={2000} {...field('link')} />
							</CareerField>
							<CareerField label="Related application">
								<select {...field('jobFp')}>
									<option value="">No linked application</option>
									{user.tracker.map((job) => (
										<option value={job.fp} key={job.fp}>
											{job.company}: {job.title}
										</option>
									))}
								</select>
							</CareerField>
							<div className="jr-career-grid">
								<CareerField label="Last contacted">
									<input type="date" {...field('lastContact')} />
								</CareerField>
								<CareerField label="Follow up on">
									<input type="date" {...field('followUp')} />
								</CareerField>
							</div>
							<CareerField label="Connection notes">
								<textarea rows={3} maxLength={3000} placeholder="How you know them and what you discussed" {...field('notes')} />
							</CareerField>
							<div style={s.row}>
								<button className="jr-career-primary" type="submit" disabled={!!busy}>
									Save contact
								</button>
								<Button small variant="ghost" disabled={!!busy} onClick={() => setEdit(null)}>
									Cancel
								</Button>
							</div>
						</fieldset>
					</form>
				</Panel>
			)}
			<CareerField label="Search contacts">
				<input placeholder="Name, company, or notes" value={query} onChange={(event) => setQuery(event.target.value)} />
			</CareerField>
			<div className="jr-career-card-grid">
				{contacts.map((contact) => (
					<Panel key={contact.id} header={contact.name} headerActions={<span className="jr-career-pill">{contact.company}</span>}>
						<p>{contact.role}</p>
						{contact.email && <p style={s.small}>{contact.email}</p>}
						{contact.link && (
							<a href={contact.link} target="_blank" rel="noreferrer" style={s.link}>
								Open contact profile
							</a>
						)}
						{contact.notes && <p className="jr-career-note">{contact.notes}</p>}
						{contact.jobFp && <p style={s.small}>Linked to {user.tracker.find((job) => job.fp === contact.jobFp)?.title ?? 'a previously tracked role'}</p>}
						<p style={s.small}>
							Last contact: {contact.lastContact || 'Not recorded'}
							{contact.followUp && <span className={contact.followUp <= localDate() ? 'jr-overdue' : ''}> · Follow up {contact.followUp}</span>}
						</p>
						<div style={s.row}>
							<Button small variant="secondary" disabled={!!busy} onClick={() => setEdit({ ...contact })}>
								Edit
							</Button>
							<Button
								small
								variant="secondary"
								disabled={!!busy}
								onClick={() =>
									void action(async () => {
										await updateCareer((current) => ({ ...current, contacts: current.contacts.map((item) => (item.id === contact.id ? { ...item, lastContact: localDate(), followUp: '' } : item)) }));
									})
								}
							>
								Mark contacted today
							</Button>
							<Button
								small
								disabled={!!busy}
								onClick={() =>
									void action(async () => {
										const job = user.tracker.find((item) => item.fp === contact.jobFp);
										const text = await write(client, 'outreach', { source_resume: user.resume, contact: { name: contact.name, company: contact.company, role: contact.role, connection_notes: contact.notes }, job: job && { title: job.title, company: job.company } });
										setDraft({ id: contact.id, text });
									}, `draft-${contact.id}`)
								}
							>
								{busy === `draft-${contact.id}` ? 'Drafting...' : 'Draft outreach'}
							</Button>
							<Button small variant="ghost" disabled={!!busy} onClick={() => setRemoving(contact.id)}>
								Remove
							</Button>
						</div>
						{removing === contact.id && (
							<div className="jr-career-inline-confirm">
								<p>Remove this contact from your workspace?</p>
								<Button
									small
									variant="secondary"
									disabled={!!busy}
									onClick={() =>
										void action(async () => {
											await updateCareer((current) => ({ ...current, contacts: current.contacts.filter((item) => item.id !== contact.id) }));
											setRemoving('');
										})
									}
								>
									Confirm remove contact
								</Button>
								<Button small variant="ghost" onClick={() => setRemoving('')}>
									Keep contact
								</Button>
							</div>
						)}
						{draft?.id === contact.id && (
							<div className="jr-career-form">
								<CareerField label={`Outreach draft for ${contact.name}`}>
									<textarea disabled={!!busy} rows={7} value={draft.text} onChange={(event) => setDraft({ id: contact.id, text: event.target.value })} />
								</CareerField>
								<Button small variant="secondary" onClick={() => void navigator.clipboard.writeText(draft.text).catch(() => setError('Could not copy. Select the draft text to copy it manually.'))}>
									Copy draft
								</Button>
								<p style={s.small}>Editable draft only. Nothing is sent, and drafting does not change your last-contact date.</p>
							</div>
						)}
					</Panel>
				))}
			</div>
			{!contacts.length && (
				<div className="jr-career-empty">
					<h3>Your network starts with one conversation.</h3>
					<p>Add a recruiter, mentor, or someone at a company you like.</p>
				</div>
			)}
		</div>
	);
};
