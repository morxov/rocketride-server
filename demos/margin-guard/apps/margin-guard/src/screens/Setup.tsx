/**
 * Setup: the snippet a customer adds to their backend, the key layout,
 * demo data, test traffic and the apply on/off switch.
 */

import React, { useState } from 'react';
import { Banner, Button, Card, ConfirmDialog, ContentHeader, StatusBadge, ToggleGroup } from 'shell';
import { resetDemo, sendTraffic, setApplyEnabled } from '../lib/guard';
import { FEATURES, NAMESPACE, type Feature } from '../lib/keys';
import { useGuard } from '../state';
import { shared, usd } from '../ui';

const styles: Record<string, React.CSSProperties> = {
	para: { fontSize: 13, lineHeight: 1.55, margin: '0 0 12px' },
	keyRow: { display: 'grid', gridTemplateColumns: 'minmax(260px, 1fr) 2fr', gap: 12, padding: '7px 0', borderBottom: '1px solid var(--rr-border)', fontSize: 12.5, alignItems: 'baseline' },
};

const SNIPPET = `# Call this next to every AI request. r is a redis.Redis client.
def record_ai_call(r, customer, feature, cost_micro_usd):
    if r.exists(f"${NAMESPACE}switch:{customer}:{feature}"):
        return "blocked"                       # switched off in Margin Guard: skip the AI call
    cheaper = r.get(f"${NAMESPACE}fallback:{customer}")   # use this model if set
    month = datetime.now(timezone.utc).strftime("%Y-%m")
    r.incrby(f"${NAMESPACE}usage:{customer}:{feature}:{month}", cost_micro_usd)
    r.incrby(f"${NAMESPACE}calls:{customer}:{feature}:{month}", 1)
    return cheaper or "standard"`;

const KEY_LAYOUT: Array<[string, string]> = [
	['usage:{customer}:{feature}:{month}', 'AI cost counter in micro-dollars. Written by the backend with INCR.'],
	['calls:{customer}:{feature}:{month}', 'Number of AI calls. Written by the backend with INCR.'],
	['budget:{customer}', 'JSON: name, plan, monthly revenue and AI budget. No expiry.'],
	['switch:{customer}:{feature}', '"off" while a feature is switched off. Expires on its own.'],
	['fallback:{customer}', 'Cheaper model to use. Expires at month end.'],
	['alert:{customer}:{month}:{50|80|100}', 'Marker so each budget alert fires once (set only if absent).'],
	['pending:{id}', 'A proposed change waiting for approval. Expires after 1 hour.'],
	['lock:apply:{id}', 'One-time lock so an approved change is applied once.'],
	['rollup:current', 'Cached summary for the advisor agent. Expires after 5 minutes.'],
];

const BATCHES = [
	{ id: '100', label: '100 calls' },
	{ id: '500', label: '500 calls' },
	{ id: '2000', label: '2,000 calls' },
];

export const Setup: React.FC = () => {
	const { client, isConnected, actor, snapshot, refresh } = useGuard();
	const [confirmReset, setConfirmReset] = useState(false);
	const [busy, setBusy] = useState(false);
	const [notice, setNotice] = useState<{ variant: 'info' | 'warning' | 'error'; text: string } | null>(null);
	const [customer, setCustomer] = useState('hooli');
	const [feature, setFeature] = useState<Feature>('summarize');
	const [batch, setBatch] = useState('500');

	const customers = snapshot?.customers ?? [];
	const target = customers.find((c) => c.id === customer) ?? customers[0];

	const run = async (work: () => Promise<{ variant: 'info' | 'warning' | 'error'; text: string }>) => {
		if (!client || busy) return;
		setBusy(true);
		try {
			setNotice(await work());
		} catch (e) {
			setNotice({ variant: 'error', text: e instanceof Error ? e.message : String(e) });
		} finally {
			setBusy(false);
			await refresh();
		}
	};

	const doReset = () =>
		run(async () => {
			const removed = await resetDemo(client!, actor);
			return { variant: 'info', text: `Removed ${removed} keys and loaded six sample customers with month-to-date usage.` };
		});

	const doTraffic = () =>
		run(async () => {
			const r = await sendTraffic(client!, target!.id, feature, Number(batch));
			if (r.blocked) return { variant: 'warning', text: `Blocked: "${feature}" is switched off for ${target!.name}, so the backend made no AI calls and spent nothing.` };
			return { variant: 'info', text: `Counted ${r.sent.toLocaleString()} "${feature}" calls for ${target!.name} on the ${r.model} model: ${usd(r.costUsd)} added.` };
		});

	const doToggle = (enabled: boolean) =>
		run(async () => {
			await setApplyEnabled(client!, actor, enabled);
			return { variant: 'info', text: enabled ? 'Approved changes will now be written to Redis.' : 'Dry run: approvals are recorded but nothing is written.' };
		});

	return (
		<div style={shared.page}>
			<ContentHeader title="Setup" subtitle="How your backend reports usage, and the controls for this demo." />
			<div style={shared.stack}>
				{notice && <Banner variant={notice.variant}>{notice.text}</Banner>}

				<Card header="Connection">
					<div style={shared.row}>
						<StatusBadge variant={isConnected ? 'success' : 'error'}>{isConnected ? 'RocketRide engine connected' : 'Engine not connected'}</StatusBadge>
						<StatusBadge variant={snapshot ? 'success' : 'muted'}>{snapshot ? `Redis reachable · ${snapshot.keyCount} keys` : 'Redis not read yet'}</StatusBadge>
						<span style={shared.muted}>
							Redis at 127.0.0.1:6379 through the tool_redis node · namespace <span style={shared.mono}>{NAMESPACE}</span>
						</span>
					</div>
				</Card>

				<Card
					header="Apply approved changes"
					headerActions={
						<ToggleGroup
							options={[
								{ id: 'on', label: 'On' },
								{ id: 'off', label: 'Dry run' },
							]}
							value={snapshot?.applyEnabled ? 'on' : 'off'}
							onChange={(id) => void doToggle(id === 'on')}
							disabled={busy || !snapshot}
						/>
					}
				>
					<p style={{ ...styles.para, margin: 0 }}>When this is on, approving a change writes it to Redis. In dry run, approvals are logged and nothing is written. A change never applies without an approval either way.</p>
				</Card>

				<Card
					header="Demo data"
					headerActions={
						<Button variant="danger" small disabled={busy || !isConnected} onClick={() => setConfirmReset(true)}>
							Load demo data
						</Button>
					}
				>
					<p style={{ ...styles.para, margin: 0 }}>Deletes every key in the namespace and loads six sample customers with budgets, plan revenue and usage for this month. Revenue is sample data, not read from a billing system.</p>
				</Card>

				<Card header="Send test traffic">
					<p style={styles.para}>Acts as the customer's backend for one batch of AI calls: it checks the off switch and the model fallback, then counts cost and calls with INCR. For continuous traffic run simulator/simulate_usage.py.</p>
					{target ? (
						<div style={shared.row}>
							<select style={shared.select} value={target.id} onChange={(e) => setCustomer(e.target.value)}>
								{customers.map((c) => (
									<option key={c.id} value={c.id}>
										{c.name}
									</option>
								))}
							</select>
							<select style={shared.select} value={feature} onChange={(e) => setFeature(e.target.value as Feature)}>
								{FEATURES.map((f) => (
									<option key={f} value={f}>
										{f}
									</option>
								))}
							</select>
							<ToggleGroup options={BATCHES} value={batch} onChange={setBatch} />
							<Button small disabled={busy} onClick={() => void doTraffic()}>
								Send
							</Button>
						</div>
					) : (
						<span style={shared.muted}>Load demo data first.</span>
					)}
				</Card>

				<Card header="Add this to your backend">
					<p style={styles.para}>Your backend writes counters straight to your own Redis. Margin Guard never sits in the request path, so it cannot slow down or break an AI call.</p>
					<pre style={shared.code}>{SNIPPET}</pre>
				</Card>

				<Card header="Key layout">
					{KEY_LAYOUT.map(([key, meaning]) => (
						<div key={key} style={styles.keyRow}>
							<span style={shared.mono}>{key}</span>
							<span>{meaning}</span>
						</div>
					))}
				</Card>
			</div>

			{confirmReset && (
				<ConfirmDialog
					title="Load demo data?"
					message={`This deletes all ${snapshot?.keyCount ?? 0} keys under ${NAMESPACE} and replaces them with sample customers. It cannot be undone.`}
					confirmLabel="Delete and load"
					destructive
					onConfirm={() => {
						setConfirmReset(false);
						void doReset();
					}}
					onCancel={() => setConfirmReset(false)}
				/>
			)}
		</div>
	);
};
