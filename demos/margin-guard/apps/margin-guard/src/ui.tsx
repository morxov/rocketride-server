/**
 * Small presentational pieces shared by the screens.
 */

import React from 'react';
import { StatusBadge } from 'shell';
import type { Customer } from './lib/guard';

export const usd = (n: number) => `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
export const pct = (n: number) => `${Math.round(n)}%`;

export const shared: Record<string, React.CSSProperties> = {
	page: { padding: '18px 24px 32px', fontFamily: 'var(--rr-font-family, system-ui)', color: 'var(--rr-text-primary)', maxWidth: 1180 },
	stack: { display: 'flex', flexDirection: 'column', gap: 16, marginTop: 18 },
	row: { display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' },
	tiles: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 12 },
	tile: { border: '1px solid var(--rr-border)', borderRadius: 8, padding: '12px 14px', background: 'var(--rr-bg-paper)' },
	tileLabel: { fontSize: 10.5, color: 'var(--rr-text-secondary)', textTransform: 'uppercase', letterSpacing: '0.04em' },
	tileValue: { fontSize: 22, fontWeight: 700, marginTop: 4, fontVariantNumeric: 'tabular-nums' },
	tileNote: { fontSize: 11.5, color: 'var(--rr-text-secondary)', marginTop: 2 },
	table: { width: '100%', borderCollapse: 'collapse', fontSize: 13 },
	th: { textAlign: 'left', fontSize: 10.5, fontWeight: 600, color: 'var(--rr-text-secondary)', textTransform: 'uppercase', letterSpacing: '0.04em', padding: '8px 12px', borderBottom: '1px solid var(--rr-border)', whiteSpace: 'nowrap' },
	thNum: { textAlign: 'right' },
	td: { padding: '10px 12px', borderBottom: '1px solid var(--rr-border)', verticalAlign: 'middle' },
	tdNum: { textAlign: 'right', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' },
	clickRow: { cursor: 'pointer' },
	muted: { color: 'var(--rr-text-secondary)', fontSize: 12 },
	mono: { fontFamily: 'var(--rr-font-mono, Consolas, monospace)', fontSize: 12 },
	code: { fontFamily: 'var(--rr-font-mono, Consolas, monospace)', fontSize: 12, background: 'var(--rr-bg-surface)', border: '1px solid var(--rr-border)', borderRadius: 6, padding: '12px 14px', whiteSpace: 'pre', overflowX: 'auto', margin: 0, lineHeight: 1.5 },
	barTrack: { position: 'relative', height: 8, borderRadius: 4, background: 'var(--rr-bg-surface-alt)', overflow: 'hidden', minWidth: 120 },
	barFill: { position: 'absolute', left: 0, top: 0, bottom: 0, borderRadius: 4, transition: 'width 600ms ease' },
	barLabel: { fontSize: 11.5, color: 'var(--rr-text-secondary)', marginTop: 3, fontVariantNumeric: 'tabular-nums' },
	select: { background: 'var(--rr-bg-input)', color: 'var(--rr-text-primary)', border: '1px solid var(--rr-border-input, var(--rr-border))', borderRadius: 6, padding: '5px 8px', fontSize: 13, fontFamily: 'inherit' },
	field: { display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12, color: 'var(--rr-text-secondary)' },
	negative: { color: 'var(--rr-color-error)' },
};

/** Colour for a budget-used percentage. */
export function usageColor(usedPct: number): string {
	if (usedPct >= 100) return 'var(--rr-color-error)';
	if (usedPct >= 80) return 'var(--rr-color-warning)';
	return 'var(--rr-color-success)';
}

export const BudgetBar: React.FC<{ usedPct: number; costUsd: number; budgetUsd: number }> = ({ usedPct, costUsd, budgetUsd }) => (
	<div>
		<div style={shared.barTrack}>
			<div style={{ ...shared.barFill, width: `${Math.min(100, usedPct)}%`, background: usageColor(usedPct) }} />
		</div>
		<div style={shared.barLabel}>
			{usd(costUsd)} of {usd(budgetUsd)} ({pct(usedPct)})
		</div>
	</div>
);

export const CustomerStatus: React.FC<{ customer: Customer }> = ({ customer }) => {
	if (customer.marginPct < 0) return <StatusBadge variant="error">Losing money</StatusBadge>;
	if (customer.usedPct >= 100) return <StatusBadge variant="error">Over budget</StatusBadge>;
	if (customer.usedPct >= 80) return <StatusBadge variant="warning">Near budget</StatusBadge>;
	return <StatusBadge variant="success">Healthy</StatusBadge>;
};

export const Tile: React.FC<{ label: string; value: React.ReactNode; note?: string; valueStyle?: React.CSSProperties }> = ({ label, value, note, valueStyle }) => (
	<div style={shared.tile}>
		<div style={shared.tileLabel}>{label}</div>
		<div style={{ ...shared.tileValue, ...valueStyle }}>{value}</div>
		{note && <div style={shared.tileNote}>{note}</div>}
	</div>
);
