/**
 * Overview: every customer's revenue against AI cost, worst margin first.
 */

import React from 'react';
import { Banner, Button, Card, ContentHeader, EmptyState, StatusBadge } from 'shell';
import { useGuard } from '../state';
import { BudgetBar, CustomerStatus, Tile, pct, shared, usd } from '../ui';

const styles: Record<string, React.CSSProperties> = {
	name: { fontWeight: 600 },
	tags: { display: 'flex', gap: 6, marginTop: 4, flexWrap: 'wrap' },
	alertRow: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 },
};

export const Overview: React.FC = () => {
	const { snapshot, error, alerts, dismissAlerts, refresh, openCustomer, setView } = useGuard();

	if (!snapshot) {
		return (
			<div style={shared.page}>
				<ContentHeader title="Overview" subtitle="Reading usage counters from Redis" />
				{error ? <Banner variant="error">{error}</Banner> : <EmptyState title="Loading" description="Starting the tools pipeline and scanning Redis." />}
			</div>
		);
	}

	const { customers } = snapshot;
	const revenue = customers.reduce((sum, c) => sum + c.revenueUsd, 0);
	const cost = customers.reduce((sum, c) => sum + c.costUsd, 0);
	const margin = revenue > 0 ? ((revenue - cost) / revenue) * 100 : 0;
	const atRisk = customers.filter((c) => c.usedPct >= 80).length;

	return (
		<div style={shared.page}>
			<ContentHeader
				title="Overview"
				subtitle={`AI cost against plan revenue for ${snapshot.month}. Counters are read live from Redis every 3 seconds.`}
				actions={
					<Button variant="secondary" small onClick={() => void refresh()}>
						Refresh
					</Button>
				}
			/>
			<div style={shared.stack}>
				{error && <Banner variant="error">{error}</Banner>}
				{alerts.length > 0 && (
					<Banner variant="warning">
						<div style={styles.alertRow}>
							<span>
								{alerts.map((a) => `${a.customerName} reached ${a.threshold}% of its AI budget`).join('. ')}. Each alert is recorded once, with a Redis key that only the first writer can create.
							</span>
							<Button variant="ghost" small onClick={dismissAlerts}>
								Dismiss
							</Button>
						</div>
					</Banner>
				)}

				{customers.length === 0 ? (
					<EmptyState
						title="No customers in Redis yet"
						description="Load the sample customers to see the dashboard, or point your backend at this Redis using the snippet on the Setup screen."
						action={<Button onClick={() => setView('setup')}>Open Setup</Button>}
					/>
				) : (
					<>
						<div style={shared.tiles}>
							<Tile label="Plan revenue" value={usd(revenue)} note="per month, all customers" />
							<Tile label="AI cost this month" value={usd(cost)} note={`${customers.reduce((s, c) => s + c.calls, 0).toLocaleString()} AI calls`} />
							<Tile label="Gross margin" value={pct(margin)} valueStyle={margin < 50 ? shared.negative : undefined} note="after AI cost" />
							<Tile label="At or near budget" value={atRisk} note={`of ${customers.length} customers`} />
							<Tile label="Waiting for approval" value={snapshot.pending.length} note="proposed changes" />
						</div>

						<Card header="Customers" noBodyPadding>
							<table style={shared.table}>
								<thead>
									<tr>
										<th style={shared.th}>Customer</th>
										<th style={{ ...shared.th, ...shared.thNum }}>Revenue</th>
										<th style={{ ...shared.th, ...shared.thNum }}>AI cost</th>
										<th style={{ ...shared.th, ...shared.thNum }}>Margin</th>
										<th style={shared.th}>AI budget used</th>
										<th style={shared.th}>Status</th>
									</tr>
								</thead>
								<tbody>
									{customers.map((c) => {
										const off = Object.entries(c.features).filter(([, f]) => f.offTtl !== null);
										return (
											<tr key={c.id} style={shared.clickRow} onClick={() => openCustomer(c.id)}>
												<td style={shared.td}>
													<div style={styles.name}>{c.name}</div>
													<div style={shared.muted}>{c.plan}</div>
													{(off.length > 0 || c.fallback) && (
														<div style={styles.tags}>
															{off.map(([f]) => (
																<StatusBadge key={f} variant="muted">
																	{f} off
																</StatusBadge>
															))}
															{c.fallback && <StatusBadge variant="info">cheaper model</StatusBadge>}
														</div>
													)}
												</td>
												<td style={{ ...shared.td, ...shared.tdNum }}>{usd(c.revenueUsd)}</td>
												<td style={{ ...shared.td, ...shared.tdNum }}>{usd(c.costUsd)}</td>
												<td style={{ ...shared.td, ...shared.tdNum, ...(c.marginPct < 0 ? shared.negative : {}) }}>{pct(c.marginPct)}</td>
												<td style={shared.td}>
													<BudgetBar usedPct={c.usedPct} costUsd={c.costUsd} budgetUsd={c.budgetUsd} />
												</td>
												<td style={shared.td}>
													<CustomerStatus customer={c} />
												</td>
											</tr>
										);
									})}
								</tbody>
							</table>
						</Card>
						<div style={shared.muted}>
							{snapshot.keyCount} keys under rr:margin-guard: · last read {new Date(snapshot.loadedAt).toLocaleTimeString()}
						</div>
					</>
				)}
			</div>
		</div>
	);
};
