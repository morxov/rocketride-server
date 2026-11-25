import React, { useEffect, useRef, useState } from 'react';
import { Banner, Button } from 'shell';
import { useJobActions } from '../actions';
import { write } from '../lib/ai';
import { connectConfiguredGmail, disconnectGmail, possibleApplications, readMail, readMailAnalysis, restoreGmail, searchMail, startGmailConnection, type MailAnalysis, type MailMessage } from '../lib/email';
import { STATUSES } from '../lib/store';
import { useApp } from '../state';
import { Icon } from '../icons';
import { PageHeader, Panel, s } from '../ui';

const CLOUD_APP = 'https://cloud.rocketride.ai/?appid=aidenbuck.jobradar';
const DEFAULT_QUERY = 'newer_than:180d {"application" "interview" "assessment" "offer" "recruiter"}';
export const Email: React.FC = () => {
	const { client, isConnected, user, setView } = useApp();
	const { setStatus } = useJobActions();
	const [token, setToken] = useState<string | null>(null);
	const [query, setQuery] = useState(DEFAULT_QUERY);
	const [messages, setMessages] = useState<MailMessage[]>([]);
	const [selected, setSelected] = useState<MailMessage | null>(null);
	const [body, setBody] = useState('');
	const [fp, setFp] = useState('');
	const [analysis, setAnalysis] = useState<MailAnalysis | null>(null);
	const [busy, setBusy] = useState('connecting');
	const [error, setError] = useState('');
	const generation = useRef(0);
	const localHost = ['localhost', '127.0.0.1', '[::1]'].includes(window.location.hostname);
	useEffect(() => {
		let alive = true;
		if (!client || !isConnected) return;
		void restoreGmail(client)
			.then((value) => {
				if (alive) {
					setToken(value);
					if (value) setView('email');
				}
			})
			.catch((e: unknown) => {
				if (alive) {
					setError(String(e));
					setView('email');
				}
			})
			.finally(() => alive && setBusy(''));
		return () => {
			alive = false;
		};
	}, [client, isConnected]);
	const fail = (e: unknown) => setError(e instanceof Error ? e.message : String(e));
	const search = async () => {
		if (!client || !token || !query.trim()) return;
		generation.current++;
		setBusy('search');
		setError('');
		setSelected(null);
		setBody('');
		setAnalysis(null);
		try {
			setMessages(await searchMail(client, token, query));
		} catch (e) {
			fail(e);
		} finally {
			setBusy('');
		}
	};
	const open = async (message: MailMessage) => {
		if (!client || !token) return;
		const version = ++generation.current;
		setSelected(message);
		setBody('');
		setAnalysis(null);
		setError('');
		setBusy('reading');
		const matches = possibleApplications(message, user?.tracker ?? []);
		setFp(matches.length === 1 ? matches[0].fp : '');
		try {
			const text = await readMail(client, token, message.id);
			if (generation.current === version) setBody(text);
		} catch (e) {
			if (generation.current === version) fail(e);
		} finally {
			if (generation.current === version) setBusy('');
		}
	};
	const review = async () => {
		const item = user?.tracker.find((t) => t.fp === fp);
		if (!client || !selected || !item || !body) return;
		setBusy('review');
		setError('');
		try {
			setAnalysis(readMailAnalysis(await write(client, 'mail', { email: { subject: selected.headers?.subject, from: selected.headers?.from, text: body.slice(0, 16000) }, application: { title: item.title, company: item.company, status: item.status } })));
		} catch (e) {
			fail(e);
		} finally {
			setBusy('');
		}
	};
	const applyUpdate = async () => {
		const item = user?.tracker.find((t) => t.fp === fp);
		if (!item || !analysis?.suggested_status) return;
		setBusy('saving');
		setError('');
		try {
			const saved = await setStatus({ ...item, locations: item.location ? [item.location] : [] }, analysis.suggested_status);
			if (!saved) throw new Error('The tracker update did not save. Please retry.');
			setAnalysis(null);
		} catch (e) {
			fail(e);
		} finally {
			setBusy('');
		}
	};
	return (
		<div className="jr-email-page">
			<PageHeader
				title="Your application inbox"
				subtitle="Keep recruiting conversations close to your job search."
				actions={
					token ? (
						<Button
							variant="secondary"
							small
							disabled={!!busy}
							onClick={() => {
								if (!client) return;
								setBusy('disconnect');
								void disconnectGmail(client, token)
									.then(() => {
										setToken(null);
										setMessages([]);
										setSelected(null);
										setBody('');
										setAnalysis(null);
									})
									.catch(fail)
									.finally(() => setBusy(''));
							}}
						>
							Disconnect Gmail
						</Button>
					) : undefined
				}
			/>
			{error && <Banner variant="error">{error}</Banner>}
			{!token ? (
				<Panel>
					<div className="jr-connect-card">
						<span className="jr-connect-icon">
							<Icon name="mail" size={32} />
						</span>
						<span className="jr-eyebrow">Email, connected</span>
						<h2>One place for your next opportunity.</h2>
						<p>Connect Gmail to find application updates, read recruiter messages, and review suggested tracker changes.</p>
						<Button
							disabled={!!busy || !isConnected}
							onClick={() => {
								if (localHost) window.open(CLOUD_APP, '_blank', 'noopener');
								else startGmailConnection();
							}}
						>
							{busy ? 'Checking connection...' : localHost ? 'Connect Gmail on Cloud' : 'Connect Gmail'}
						</Button>
						{localHost && (
							<>
								<p style={s.small}>RocketRide's Google sign-in requires its hosted cloud page. You can also use an existing Gmail connection configured on your local engine.</p>
								<Button
									variant="secondary"
									small
									disabled={!!busy || !isConnected}
									onClick={() => {
										if (!client) return;
										setBusy('connecting');
										setError('');
										void connectConfiguredGmail(client)
											.then(setToken)
											.catch(fail)
											.finally(() => setBusy(''));
									}}
								>
									Use configured local Gmail
								</Button>
							</>
						)}
						<p className="jr-connect-note">
							<Icon name="shield" size={15} /> Read-only access. You choose every tracker update.
						</p>
						<p style={s.small}>Google sign-in opens next. This app never sends, deletes, or marks your emails as read. Disconnect ends this session; Google account permissions can also be revoked in your Google account.</p>
					</div>
				</Panel>
			) : (
				<>
					<form
						className="jr-email-search"
						onSubmit={(e) => {
							e.preventDefault();
							void search();
						}}
					>
						<label className="jr-field-label" htmlFor="mail-query">
							Search recruiting emails
						</label>
						<div style={s.row}>
							<input id="mail-query" className="jr-email-input" style={{ flex: 1 }} value={query} onChange={(e) => setQuery(e.target.value)} />
							<Button disabled={!!busy || !query.trim()} onClick={() => void search()}>
								{busy === 'search' ? 'Searching...' : 'Search Gmail'}
							</Button>
						</div>
						<p style={s.small}>Gmail search syntax supported. Shows up to 25 messages per search.</p>
					</form>
					<div className="jr-email-grid">
						<Panel>
							<div className="jr-mail-list">
								{messages.length ? (
									messages.map((message) => (
										<button key={message.id} className="jr-mail-row" type="button" aria-pressed={selected?.id === message.id} disabled={!!busy} onClick={() => void open(message)}>
											<strong>{message.headers?.subject || '(No subject)'}</strong>
											<span>{message.headers?.from}</span>
											<p>{message.snippet}</p>
											<small>{message.internalDate ? new Date(Number(message.internalDate)).toLocaleDateString() : message.headers?.date}</small>
										</button>
									))
								) : (
									<div className="jr-mail-empty">
										<Icon name="mail" size={28} />
										<h3>Ready when you are.</h3>
										<p>Search Gmail for your recent application updates.</p>
									</div>
								)}
							</div>
						</Panel>
						<Panel>
							{selected ? (
								<div className="jr-mail-detail">
									<h3>{selected.headers?.subject || '(No subject)'}</h3>
									<p style={s.small}>{selected.headers?.from}</p>
									<a href={`https://mail.google.com/mail/u/0/#all/${encodeURIComponent(selected.threadId || selected.id)}`} target="_blank" rel="noreferrer" style={s.link}>
										Open in Gmail
									</a>
									<pre className="jr-mail-body">{busy === 'reading' ? 'Reading message...' : body}</pre>
									<label className="jr-field-label" htmlFor="mail-application">
										Related tracked application
									</label>
									<select
										id="mail-application"
										className="jr-email-input"
										value={fp}
										disabled={!!busy}
										onChange={(e) => {
											setFp(e.target.value);
											setAnalysis(null);
										}}
									>
										<option value="">Choose an application</option>
										{user?.tracker.map((item) => (
											<option key={item.fp} value={item.fp}>
												{item.company}: {item.title}
											</option>
										))}
									</select>
									<div style={{ marginTop: 12 }}>
										<Button small disabled={!!busy || !fp || !body} onClick={() => void review()}>
											{busy === 'review' ? 'Reviewing...' : 'Review application update'}
										</Button>
									</div>
									<p style={s.small}>Review sends this message and the chosen application details to the Gemini writer.</p>
									{analysis && (
										<div className="jr-mail-analysis">
											<p>{analysis.summary}</p>
											<blockquote>{analysis.reason}</blockquote>
											{analysis.suggested_status ? (
												<Button small disabled={!!busy} onClick={() => void applyUpdate()}>
													Confirm tracker update: {STATUSES.find((status) => status.id === analysis.suggested_status)?.label}
												</Button>
											) : (
												<p>No clear status change found.</p>
											)}
										</div>
									)}
								</div>
							) : (
								<div className="jr-mail-empty">
									<h3>Select a conversation</h3>
									<p>Read a message and link it to a tracked application.</p>
								</div>
							)}
						</Panel>
					</div>
				</>
			)}
		</div>
	);
};
