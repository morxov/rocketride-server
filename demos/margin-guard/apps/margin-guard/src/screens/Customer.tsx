/**
 * Customer detail: usage per feature, active controls, an LLM explanation,
 * and buttons that PROPOSE changes (nothing here writes a control directly).
 */

import React, { useState } from 'react';
import { Question } from 'rocketride';
import { Banner, Button, Card, ContentHeader, EmptyState, InputField, MarkdownRenderer, Modal, StatusBadge } from 'shell';
import explainPipe from '../pipelines/explain.pipe';
import { describeChange, extend, formatDuration, propose, type ChangeRequest, type Customer as CustomerModel } from '../lib/guard';
import { FALLBACK_MODEL, FEATURES, keys, type Feature } from '../lib/keys';
import { dropToken, pipelineToken } from '../lib/session';
import { useGuard } from '../state';
import { BudgetBar, CustomerStatus, Tile, pct, shared, usd } from '../ui';

const styles: Record<string, React.CSSProperties> = {
	actions: { display: 'flex', gap: 6, justifyContent: 'flex-end', flexWrap: 'wrap' },
	form: { display: 'flex', flexDirection: 'column', gap: 14 },
	preview: { fontSize: 13, fontWeight: 600, color: 'var(--rr-text-primary)' },
	explain: { fontSize: 13, lineHeight: 1.55 },
};

const DURATIONS = [
	{ seconds: 120, label: '2 minutes (demo)' },
	{ seconds: 3600, label: '1 hour' },
	{ seconds: 86400, label: '24 hours' },
];

type Draft = Omit<ChangeRequest, 'reason'>;

export const Customer: React.FC<{ customer: CustomerModel }> = ({ customer }) => {
	const { client, actor, snapshot, refresh, openCustomer, setView } = useGuard();
	const [draft, setDraft] = useState<Draft | null>(null);
	const [reason, setReason] = useState('');
	const [saving, setSaving] = useState(false);
	const [notice, setNotice] = useState<{ variant: 'info' | 'error'; text: string } | null>(null);
	const [explanation, setExplanation] = useState<string | null>(null);
	const [explaining, setExplaining] = useState(false);

	const base = { customer: customer.id, customerName: customer.name };
	const pendingHere = snapshot?.pending.filter((p) => p.customer === customer.id) ?? [];

	const start = (d: Draft) => {
		setDraft(d);
		setReason('');
		setNotice(null);
	};

	const submit = async () => {
		if (!client || !draft) return;
		setSaving(true);
		try {
			const change = await propose(client, actor, { ...draft, reason: reason.trim() });
			setNotice({ variant: 'info', text: `Proposed: ${change.summary}. It needs approval and expires in ${formatDuration(change.ttl)} if nobody approves it.` });
			setDraft(null);
			await refresh();
		} catch (e) {
			setNotice({ variant: 'error', text: e instanceof Error ? e.message : String(e) });
		} finally {
			setSaving(false);
		}
	};

	const extendSwitch = async (feature: Feature) => {
		if (!client || saving) return;
		setSaving(true);
		try {
			const ok = await extend(client, actor, keys.switchOff(customer.id, feature), 3600, `Extended the "${feature}" off switch for ${customer.name} to 1 hour from now`);
			setNotice(ok ? { variant: 'info', text: `The "${feature}" off switch now expires 1 hour from now.` } : { variant: 'error', text: 'That switch had already expired.' });
		} catch (e) {
			setNotice({ variant: 'error', text: `Could not extend the switch: ${e instanceof Error ? e.message : String(e)}` });
		} finally {
			setSaving(false);
			await refresh();
		}
	};

	const explain = async () => {
		if (!client) return;
		setExplaining(true);
		setExplanation(null);
		try {
			const token = await pipelineToken(client, explainPipe, 'Margin Guard explain');
			const question = new Question();
			// The LLM gets facts the app already read from Redis. It explains; it does not decide.
			question.addQuestion(
				JSON.stringify({
					customer: customer.name,
					plan: customer.plan,
					month: snapshot?.month,
					revenue_usd: customer.revenueUsd,
					ai_budget_usd: customer.budgetUsd,
					ai_cost_usd: Number(customer.costUsd.toFixed(2)),
					budget_used_pct: Math.round(customer.usedPct),
					margin_pct: Math.round(customer.marginPct),
					features: Object.fromEntries(FEATURES.map((f) => [f, { cost_usd: Number(customer.features[f].costUsd.toFixed(2)), calls: customer.features[f].calls, switched_off: customer.features[f].offTtl !== null }])),
					cheaper_model_in_use: customer.fallback?.model ?? null,
				}),
			);
			const result = (await client.chat({ token, question })) as { answers?: unknown[] };
			const answer = result.answers?.[0];
			setExplanation(typeof answer === 'string' ? answer : JSON.stringify(answer ?? 'No answer returned.'));
		} catch (e) {
			dropToken(client, explainPipe);
			setNotice({ variant: 'error', text: `Could not get an explanation: ${e instanceof Error ? e.message : String(e)}` });
		} finally {
			setExplaining(false);
		}
	};

	return (
		<div style={shared.page}>
			<ContentHeader
				title={customer.name}
				subtitle={`${customer.plan} plan · ${usd(customer.revenueUsd)} a month · customer id ${customer.id}`}
				actions={
					<Button variant="secondary" small onClick={() => openCustomer(null)}>
						Back to overview
					</Button>
				}
			/>
			<div style={shared.stack}>
				{notice && <Banner variant={notice.variant}>{notice.text}</Banner>}
				{pendingHere.length > 0 && (
					<Banner variant="info">
						<div style={shared.row}>
							<span>
								{pendingHere.length} proposed {pendingHere.length === 1 ? 'change is' : 'changes are'} waiting for approval for this customer.
							</span>
							<Button variant="ghost" small onClick={() => setView('approvals')}>
								Open approvals
							</Button>
						</div>
					</Banner>
				)}

				<div style={shared.tiles}>
					<Tile label="AI cost this month" value={usd(customer.costUsd)} note={`${customer.calls.toLocaleString()} calls`} />
					<Tile label="Margin" value={pct(customer.marginPct)} valueStyle={customer.marginPct < 0 ? shared.negative : undefined} note={`${usd(customer.revenueUsd - customer.costUsd)} left after AI cost`} />
					<div style={shared.tile}>
						<div style={shared.tileLabel}>AI budget</div>
						<div style={{ marginTop: 10 }}>
							<BudgetBar usedPct={customer.usedPct} costUsd={customer.costUsd} budgetUsd={customer.budgetUsd} />
						</div>
					</div>
					<div style={shared.tile}>
						<div style={shared.tileLabel}>Status</div>
						<div style={{ marginTop: 10 }}>
							<CustomerStatus customer={customer} />
						</div>
						<div style={shared.tileNote}>{customer.alerts.length ? `Alerts sent at ${customer.alerts.map((a) => `${a}%`).join(', ')}` : 'No alerts this month'}</div>
					</div>
				</div>

				<Card
					header="Usage by feature"
					headerActions={
						<Button variant="secondary" small onClick={() => start({ ...base, type: 'set_budget', budgetUsd: customer.budgetUsd })}>
							Propose budget change
						</Button>
					}
					noBodyPadding
				>
					<table style={shared.table}>
						<thead>
							<tr>
								<th style={shared.th}>Feature</th>
								<th style={{ ...shared.th, ...shared.thNum }}>Calls</th>
								<th style={{ ...shared.th, ...shared.thNum }}>Cost</th>
								<th style={{ ...shared.th, ...shared.thNum }}>Share</th>
								<th style={shared.th}>Switch</th>
								<th style={shared.th} />
							</tr>
						</thead>
						<tbody>
							{FEATURES.map((f) => {
								const u = customer.features[f];
								const isOff = u.offTtl !== null;
								return (
									<tr key={f}>
										<td style={shared.td}>
											<div style={{ fontWeight: 600 }}>{f}</div>
											<div style={{ ...shared.muted, ...shared.mono }}>usage:{customer.id}:{f}:{snapshot?.month}</div>
										</td>
										<td style={{ ...shared.td, ...shared.tdNum }}>{u.calls.toLocaleString()}</td>
										<td style={{ ...shared.td, ...shared.tdNum }}>{usd(u.costUsd)}</td>
										<td style={{ ...shared.td, ...shared.tdNum }}>{customer.costUsd > 0 ? pct((u.costUsd / customer.costUsd) * 100) : '0%'}</td>
										<td style={shared.td}>
											{isOff ? <StatusBadge variant="error">Off · back on in {formatDuration(u.offTtl!)}</StatusBadge> : <StatusBadge variant="success">On</StatusBadge>}
										</td>
										<td style={shared.td}>
											<div style={styles.actions}>
												{isOff ? (
													<>
														<Button variant="ghost" small onClick={() => void extendSwitch(f)} title="Redis EXPIRE: restart the countdown at 1 hour">
															Extend to 1 h
														</Button>
														<Button variant="secondary" small onClick={() => start({ ...base, type: 'switch_on', feature: f })}>
															Propose switch on
														</Button>
													</>
												) : (
													<Button variant="secondary" small onClick={() => start({ ...base, type: 'switch_off', feature: f, ttlSeconds: 3600 })}>
														Propose switch off
													</Button>
												)}
											</div>
										</td>
									</tr>
								);
							})}
						</tbody>
					</table>
				</Card>

				<Card
					header="Model"
					headerActions={
						customer.fallback ? (
							<Button variant="secondary" small onClick={() => start({ ...base, type: 'clear_fallback' })}>
								Propose standard model
							</Button>
						) : (
							<Button variant="secondary" small onClick={() => start({ ...base, type: 'set_fallback', model: FALLBACK_MODEL })}>
								Propose cheaper model
							</Button>
						)
					}
				>
					{customer.fallback ? (
						<span>
							Using the cheaper model <strong>{customer.fallback.model}</strong>. Redis removes this setting in {formatDuration(customer.fallback.ttl)}, at month end.
						</span>
					) : (
						<span>Using the standard model. A cheaper model costs about 15% as much per call.</span>
					)}
				</Card>

				<Card
					header="Explanation"
					headerActions={
						<Button small disabled={explaining} onClick={() => void explain()}>
							{explaining ? 'Asking the model' : explanation ? 'Explain again' : 'Explain and draft email'}
						</Button>
					}
				>
					{explanation ? (
						<div style={styles.explain}>
							<MarkdownRenderer content={explanation} />
						</div>
					) : (
						<EmptyState title="No explanation yet" description="The model is given the numbers on this page and writes a short explanation and a draft email. It cannot change anything." />
					)}
				</Card>
			</div>

			{draft && (
				<Modal
					title="Propose a change"
					onClose={() => setDraft(null)}
					footer={
						<>
							<Button variant="secondary" small onClick={() => setDraft(null)}>
								Cancel
							</Button>
							<Button small disabled={saving || (draft.type === 'set_budget' && !(Number(draft.budgetUsd) > 0))} onClick={() => void submit()}>
								{saving ? 'Saving' : 'Send for approval'}
							</Button>
						</>
					}
				>
					<div style={styles.form}>
						<div style={styles.preview}>{describeChange(draft)}</div>
						{draft.type === 'set_budget' && (
							<label style={shared.field}>
								Monthly AI budget in US dollars
								<InputField type="number" min={1} value={String(draft.budgetUsd ?? '')} onChange={(e) => setDraft({ ...draft, budgetUsd: Number(e.target.value) })} />
							</label>
						)}
						{draft.type === 'switch_off' && (
							<label style={shared.field}>
								Switch back on automatically after
								<select style={shared.select} value={draft.ttlSeconds} onChange={(e) => setDraft({ ...draft, ttlSeconds: Number(e.target.value) })}>
									{DURATIONS.map((d) => (
										<option key={d.seconds} value={d.seconds}>
											{d.label}
										</option>
									))}
								</select>
							</label>
						)}
						<label style={shared.field}>
							Reason (shown to the approver)
							<InputField placeholder="For example: summarize is driving cost over budget" value={reason} onChange={(e) => setReason(e.target.value)} />
						</label>
						<div style={shared.muted}>Nothing changes yet. This is saved in Redis as a pending change that expires in 1 hour unless someone approves it.</div>
					</div>
				</Modal>
			)}
		</div>
	);
};
