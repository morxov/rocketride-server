import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { AppLayout, useShellConnection } from 'shell';
import { createActionGate, DEFAULT_TTL_SECONDS, type GateSnapshot } from './actionGate';
import { syncSqlAudit } from './auditSink';
import { explainReview } from './explain';
import './gate.css';

const defaultSummary = 'The release checklist is complete. Ask the on-call team to review the rollout window.';
const timeFormatter = new Intl.DateTimeFormat(undefined, { dateStyle: 'short', timeStyle: 'short' });
const labels: Record<string, string> = {
	pending: 'Pending',
	approved: 'Approved',
	rejected: 'Rejected',
	expired: 'Expired',
	executed: 'Executed',
	claimed: 'Claimed',
	proposed: 'Proposed',
	completed: 'Executed',
	'policy-enabled': 'Policy enabled',
	'policy-disabled': 'Policy paused',
};

function time(value: string | number) {
	const date = new Date(value);
	return Number.isNaN(date.getTime()) ? 'Unavailable' : timeFormatter.format(date);
}

function statusLabel(status: string) {
	return labels[status] ?? status.replaceAll(/[-_]/g, ' ');
}

function App() {
	const { client, isConnected } = useShellConnection();
	const gate = useMemo(() => (client && isConnected ? createActionGate(client) : null), [client, isConnected]);
	const [snapshot, setSnapshot] = useState<GateSnapshot | null>(null);
	const [requestId, setRequestId] = useState<string>(() => crypto.randomUUID());
	const [target, setTarget] = useState('#ops');
	const [summary, setSummary] = useState(defaultSummary);
	const [lifetime, setLifetime] = useState(DEFAULT_TTL_SECONDS);
	const [selectedId, setSelectedId] = useState('');
	const [lastRefresh, setLastRefresh] = useState<number | null>(null);
	const [busy, setBusy] = useState('');
	const [error, setError] = useState('');
	const [notice, setNotice] = useState('');
	const [sqlMode, setSqlMode] = useState<'managed' | 'postgres'>('managed');
	const [explanation, setExplanation] = useState<{ id: string; policy: boolean; status: string; text: string } | null>(null);
	const running = useRef(false);
	const pending = snapshot?.counts.pending ?? 0;
	const approved = (snapshot?.counts.approved ?? 0) + (snapshot?.counts.executed ?? 0);
	const executed = snapshot?.counts.executed ?? 0;
	const selected = snapshot?.proposals.find(({ id }) => id === selectedId) ?? snapshot?.proposals[0];
	const policyEnabled = snapshot?.policyEnabled ?? false;
	const busyOrOffline = Boolean(busy) || !gate;

	useEffect(() => {
		if (!gate) return;
		let active = true;
		setBusy('Loading');
		void gate
			.list()
			.then((result) => {
				if (!active) return;
				setSnapshot(result);
				setLastRefresh(Date.now());
				setError('');
			})
			.catch((problem: unknown) => {
				if (active) setError(problem instanceof Error ? problem.message : 'Could not load the inbox.');
			})
			.finally(() => {
				if (active) setBusy('');
			});
		return () => {
			active = false;
		};
	}, [gate]);

	async function refresh() {
		if (!gate) return;
		setSnapshot(await gate.list());
		setLastRefresh(Date.now());
	}

	async function run(label: string, action: () => Promise<void>) {
		if (running.current || !gate) return;
		running.current = true;
		setBusy(label);
		setError('');
		setNotice('');
		try {
			await action();
		} catch (problem) {
			setError(problem instanceof Error ? problem.message : 'The action failed. Refresh and try again.');
		} finally {
			running.current = false;
			setBusy('');
		}
	}

	function propose(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		if (!gate) return;
		void run('Submitting proposal', async () => {
			const proposal = await gate.propose({ requestId, action: 'send-summary', target, summary, ttlSeconds: lifetime });
			setSelectedId(proposal.id);
			await refresh();
			setNotice('Proposal is in the inbox. Submitting this request ID again reuses the proposal.');
		});
	}

	function review(decision: 'approve' | 'reject') {
		if (!gate || !selected) return;
		void run(decision === 'approve' ? 'Approving' : 'Rejecting', async () => {
			const result = await gate.review(selected.id, decision);
			await refresh();
			setNotice(`Proposal status: ${statusLabel(result.status)}.`);
		});
	}

	const displayedExplanation = explanation && selected && explanation.id === selected.id && explanation.status === selected.status && explanation.policy === policyEnabled ? explanation.text : null;

	return (
		<AppLayout>
			<main className="gate">
				<div className="gate-shell">
					<header className="gate-header">
						<div>
							<p className="gate-workspace">
								<span aria-hidden="true">◈</span> Demo workspace
							</p>
							<h1>Agent Action Gate</h1>
							<p>Review an agent’s proposed action before it can run.</p>
						</div>
						<div className="gate-connection">
							<span data-connected={Boolean(gate)}>
								<i aria-hidden="true" /> {gate ? 'Engine connected' : 'Engine disconnected'}
							</span>
							<button type="button" onClick={() => void run('Refreshing', refresh)} disabled={busyOrOffline}>
								Refresh inbox
							</button>
							<small>Last refreshed {lastRefresh === null ? 'unavailable' : time(lastRefresh)}</small>
						</div>
					</header>

					<div className="gate-totals" aria-label="Proposal totals">
						<div>
							<span>Proposed</span>
							<strong>{snapshot?.proposals.length ?? 0}</strong>
						</div>
						<div>
							<span>Awaiting review</span>
							<strong>{pending}</strong>
						</div>
						<div>
							<span>Approved</span>
							<strong>{approved}</strong>
						</div>
						<div>
							<span>Executed</span>
							<strong>{executed}</strong>
						</div>
					</div>

					<div className="gate-feedback" role="status">
						{busy || notice}
					</div>
					{error && (
						<p role="alert" className="gate-error">
							{error}
						</p>
					)}
					<div className="gate-grid">
						<section className="gate-card gate-inbox" aria-labelledby="inbox-title">
							<div className="gate-card-title">
								<h2 id="inbox-title">Approval inbox</h2>
								<span>{pending} pending</span>
							</div>
							{snapshot?.proposals.length ? (
								<ul>
									{snapshot.proposals.map((proposal) => (
										<li key={proposal.id}>
											<button type="button" aria-pressed={selected?.id === proposal.id} onClick={() => setSelectedId(proposal.id)}>
												<span>
													<strong>Send status summary</strong>
													<small>{proposal.target}</small>
												</span>
												<span className="gate-badge" data-status={proposal.status}>
													{statusLabel(proposal.status)}
												</span>
											</button>
										</li>
									))}
								</ul>
							) : (
								<p className="gate-empty">No proposals yet. Add a sample proposal to try the approval flow.</p>
							)}
						</section>

						<section className="gate-card gate-detail" aria-labelledby="review-title">
							<div className="gate-card-title">
								<h2 id="review-title">Review proposal</h2>
								{selected && (
									<span className="gate-badge" data-status={selected.status}>
										{statusLabel(selected.status)}
									</span>
								)}
							</div>
							{selected ? (
								<>
									<dl>
										<div>
											<dt>Action</dt>
											<dd>Send status summary</dd>
										</div>
										<div>
											<dt>Destination</dt>
											<dd>{selected.target}</dd>
										</div>
										<div>
											<dt>Expires at</dt>
											<dd>{time(selected.expiresAt)}</dd>
										</div>
										<div>
											<dt>Request ID</dt>
											<dd className="gate-mono">{selected.requestId}</dd>
										</div>
									</dl>
									<p className="gate-summary">{selected.summary}</p>
									<p className="gate-note">Running this proposal creates a receipt in Redis. The destination is a preview label.</p>
									{selected.receipt && <p className="gate-receipt">Simulation receipt recorded in Redis.</p>}
									{selected.status === 'pending' && (
										<div className="gate-actions">
											<button className="gate-primary" type="button" onClick={() => review('approve')} disabled={busyOrOffline}>
												Approve
											</button>
											<button type="button" onClick={() => review('reject')} disabled={busyOrOffline}>
												Reject
											</button>
										</div>
									)}
									{selected.status === 'approved' && (
										<>
											<div className="gate-actions">
												<button
													className="gate-primary"
													type="button"
													disabled={busyOrOffline || !policyEnabled}
													onClick={() => {
														if (!gate) return;
														void run('Running simulation', async () => {
															const result = await gate.execute(selected.id);
															await refresh();
															setNotice(`Proposal status: ${statusLabel(result.status)}.`);
														});
													}}
												>
													Run simulation
												</button>
											</div>
											{!policyEnabled && <p className="gate-note">Enable simulated execution to run this approved action.</p>}
										</>
									)}
									{client && (
										<button
											type="button"
											className="gate-explain"
											onClick={() =>
												void run('Asking Gemini', async () => {
													const text = await explainReview(client, selected.status, policyEnabled);
													setExplanation({ id: selected.id, status: selected.status, policy: policyEnabled, text });
												})
											}
											disabled={busyOrOffline}
										>
											Explain status with Gemini
										</button>
									)}
									{displayedExplanation && (
										<p className="gate-note" role="status">
											{displayedExplanation}
										</p>
									)}
								</>
							) : (
								<p className="gate-empty">Select a proposal to see what it would do.</p>
							)}
						</section>

						<form className="gate-card gate-form" onSubmit={propose} aria-labelledby="proposal-title">
							<div className="gate-card-title">
								<h2 id="proposal-title">Simulate an agent proposal</h2>
							</div>
							<label>
								Destination
								<input value={target} maxLength={80} onChange={(event) => setTarget(event.target.value)} required />
							</label>
							<label>
								Status summary
								<textarea value={summary} rows={3} maxLength={400} onChange={(event) => setSummary(event.target.value)} required />
							</label>
							<div className="gate-form-row">
								<label>
									Request ID
									<input className="gate-mono" value={requestId} maxLength={100} onChange={(event) => setRequestId(event.target.value)} required />
								</label>
								<label>
									Expires after
									<select value={lifetime} onChange={(event) => setLifetime(Number(event.target.value))}>
										<option value={10}>10 seconds</option>
										<option value={DEFAULT_TTL_SECONDS}>2 minutes</option>
										<option value={600}>10 minutes</option>
									</select>
								</label>
							</div>
							<div className="gate-actions">
								<button type="submit" className="gate-primary" disabled={busyOrOffline || !requestId.trim() || !target.trim() || !summary.trim()}>
									Submit proposal
								</button>
								<button type="button" onClick={() => setRequestId(crypto.randomUUID())} disabled={Boolean(busy)}>
									New request ID
								</button>
							</div>
						</form>

						<section className="gate-card gate-policy" aria-labelledby="policy-title">
							<div className="gate-card-title">
								<h2 id="policy-title">Execution policy</h2>
								<span className="gate-badge" data-status={policyEnabled ? 'executed' : 'pending'}>
									{policyEnabled ? 'Enabled' : 'Paused'}
								</span>
							</div>
							<label className="gate-policy-switch">
								<input
									type="checkbox"
									checked={policyEnabled}
									disabled={busyOrOffline}
									onChange={(event) => {
										const enabled = event.target.checked;
										void run('Updating policy', async () => {
											await gate?.setPolicy(enabled);
											await refresh();
											setNotice(enabled ? 'Simulated execution enabled.' : 'Simulated execution paused.');
										});
									}}
								/>
								<span>Allow simulated status summaries to run</span>
							</label>
							<p className="gate-note">An approved proposal must still be within its expiry window when you run it.</p>
						</section>
					</div>

					<section className="gate-card gate-audit" aria-labelledby="audit-title">
						<div className="gate-card-title">
							<h2 id="audit-title">Audit log</h2>
							<span>{snapshot?.audit.length ?? 0} events</span>
						</div>
						{snapshot?.audit.length ? (
							<ol>
								{snapshot.audit.map((entry) => (
									<li key={entry.id}>
										<strong>{statusLabel(entry.kind)}</strong>
										<span>{entry.detail}</span>
										<small>{time(entry.at)}</small>
									</li>
								))}
							</ol>
						) : (
							<p className="gate-empty">Proposal and policy activity will appear here.</p>
						)}
						<div className="gate-actions">
							<label>
								SQL audit destination{' '}
								<select value={sqlMode} onChange={(event) => setSqlMode(event.target.value as 'managed' | 'postgres')}>
									<option value="managed">RocketRide SQL</option>
									<option value="postgres">Local PostgreSQL</option>
								</select>
							</label>
							<button
								type="button"
								disabled={busyOrOffline || !snapshot?.audit.length}
								onClick={() => {
									if (!client || !gate) return;
									void run('Syncing audit', async () => {
										const latest = await gate.list();
										const count = await syncSqlAudit(client, latest.audit, sqlMode);
										setSnapshot(latest);
										setLastRefresh(Date.now());
										setNotice(`${count} new audit ${count === 1 ? 'event' : 'events'} copied to SQL.`);
									});
								}}
							>
								Sync audit to SQL
							</button>
						</div>
						<p className="gate-note">Activity is recorded in Redis. SQL sync uses a configured database and can be retried.</p>
					</section>
				</div>
			</main>
		</AppLayout>
	);
}

export default App;
