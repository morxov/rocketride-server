/**
 * Shared styles and small pieces.
 */

import React from 'react';
import { Button, StatusBadge } from 'shell';
import { ago, type ScoredJob } from './lib/match';
import { dismissToast, type Toast } from './state';

export const s: Record<string, React.CSSProperties> = {
	page: { height: '100%', overflowY: 'auto', background: 'var(--rr-bg-default)', fontFamily: 'var(--rr-font-family, system-ui)', color: 'var(--rr-text-primary)' },
	inner: { maxWidth: 1180, padding: '18px 24px 40px' },
	stack: { display: 'flex', flexDirection: 'column', gap: 14, marginTop: 16 },
	row: { display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' },
	grid2: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: 14 },
	tiles: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12 },
	tile: { border: '1px solid var(--rr-border)', borderRadius: 8, padding: '12px 14px', background: 'var(--rr-bg-paper)' },
	tileLabel: { fontSize: 10.5, color: 'var(--rr-text-secondary)', textTransform: 'uppercase', letterSpacing: '0.04em' },
	tileValue: { fontSize: 24, fontWeight: 700, marginTop: 4, fontVariantNumeric: 'tabular-nums' },
	tileNote: { fontSize: 11.5, color: 'var(--rr-text-secondary)', marginTop: 2 },
	muted: { fontSize: 12.5, color: 'var(--rr-text-secondary)' },
	small: { fontSize: 12, color: 'var(--rr-text-secondary)' },
	text: { fontSize: 13.5, lineHeight: 1.5 },
	mono: { fontFamily: 'var(--rr-font-mono, Consolas, monospace)', fontSize: 12 },
	link: { color: 'var(--rr-text-link)', textDecoration: 'none' },
	field: { display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12, color: 'var(--rr-text-secondary)' },
	select: { background: 'var(--rr-bg-input)', color: 'var(--rr-text-primary)', border: '1px solid var(--rr-border-input, var(--rr-border))', borderRadius: 6, padding: '6px 8px', fontSize: 13, fontFamily: 'inherit' },
	textarea: { background: 'var(--rr-bg-input)', color: 'var(--rr-text-primary)', border: '1px solid var(--rr-border-input, var(--rr-border))', borderRadius: 6, padding: '8px 10px', fontSize: 13, fontFamily: 'inherit', resize: 'vertical', minHeight: 70 },
	pre: { whiteSpace: 'pre-wrap', fontFamily: 'inherit', fontSize: 13, lineHeight: 1.55, margin: 0, background: 'var(--rr-bg-surface)', border: '1px solid var(--rr-border)', borderRadius: 6, padding: '10px 12px', maxHeight: 360, overflowY: 'auto' },
	listRow: { display: 'flex', gap: 12, alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', borderBottom: '1px solid var(--rr-border)' },
};

// =============================================================================
// JOB ROW
// =============================================================================

const jr: Record<string, React.CSSProperties> = {
	card: { display: 'flex', gap: 14, padding: '12px 14px', borderBottom: '1px solid var(--rr-border)', alignItems: 'flex-start', cursor: 'pointer' },
	cardNew: { boxShadow: 'inset 3px 0 0 var(--rr-brand)' },
	score: { width: 44, height: 44, flex: '0 0 44px', borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 15, fontVariantNumeric: 'tabular-nums' },
	body: { flex: 1, minWidth: 0 },
	title: { fontSize: 14, fontWeight: 600, lineHeight: 1.3 },
	meta: { fontSize: 12.5, color: 'var(--rr-text-secondary)', marginTop: 2 },
	chips: { display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 6 },
	reason: { fontSize: 12, color: 'var(--rr-text-secondary)', marginTop: 5 },
	warn: { fontSize: 12, color: 'var(--rr-color-warning)', marginTop: 3 },
	actions: { display: 'flex', gap: 6, flex: '0 0 auto', alignItems: 'center' },
};

export function scoreColor(score: number): React.CSSProperties {
	if (score >= 70) return { background: 'color-mix(in srgb, var(--rr-color-success) 18%, transparent)', color: 'var(--rr-color-success)' };
	if (score >= 45) return { background: 'color-mix(in srgb, var(--rr-color-info) 16%, transparent)', color: 'var(--rr-color-info)' };
	return { background: 'var(--rr-bg-surface-alt)', color: 'var(--rr-text-secondary)' };
}

export const JobFlags: React.FC<{ job: ScoredJob }> = ({ job }) => (
	<>
		{job.flags.includes('new') && <StatusBadge variant="success">New</StatusBadge>}
		{job.flags.includes('fresh') && <StatusBadge variant="info">Posted {ago(job.posted)}</StatusBadge>}
		{job.flags.includes('stale') && <StatusBadge variant="warning">Likely stale</StatusBadge>}
		{!job.flags.includes('stale') && job.flags.includes('reposted') && <StatusBadge variant="warning">Reposted x{job.postCount}</StatusBadge>}
		{job.flags.includes('no_sponsorship') && <StatusBadge variant="error">No sponsorship</StatusBadge>}
		{job.flags.includes('multi_source') && <StatusBadge variant="muted">{job.sources.length} sources merged</StatusBadge>}
		{job.remote && <StatusBadge variant="muted">Remote</StatusBadge>}
	</>
);

export const JobRow: React.FC<{
	job: ScoredJob;
	onOpen: () => void;
	actions?: React.ReactNode;
	compact?: boolean;
}> = ({ job, onOpen, actions, compact }) => (
	<div style={{ ...jr.card, ...(job.flags.includes('new') ? jr.cardNew : {}) }} onClick={onOpen}>
		<div style={{ ...jr.score, ...scoreColor(job.score) }} title="Match score out of 100">
			{job.score}
		</div>
		<div style={jr.body}>
			<div style={jr.title}>{job.title}</div>
			<div style={jr.meta}>
				{job.company}
				{job.locations.length ? ` · ${job.locations.slice(0, 2).join(', ')}${job.locations.length > 2 ? ` +${job.locations.length - 2}` : ''}` : ''}
				{` · posted ${ago(job.posted)}`}
				{job.terms?.length ? ` · ${job.terms.join(', ')}` : ''}
			</div>
			<div style={jr.chips}>
				<JobFlags job={job} />
			</div>
			{!compact && job.reasons.length > 0 && <div style={jr.reason}>{job.reasons.join(' · ')}</div>}
			{!compact && job.warnings.length > 0 && <div style={jr.warn}>{job.warnings.join(' · ')}</div>}
		</div>
		{actions && (
			<div style={jr.actions} onClick={(e) => e.stopPropagation()}>
				{actions}
			</div>
		)}
	</div>
);

export const Tile: React.FC<{ label: string; value: React.ReactNode; note?: string; onClick?: () => void }> = ({ label, value, note, onClick }) => (
	<div style={{ ...s.tile, ...(onClick ? { cursor: 'pointer' } : {}) }} onClick={onClick}>
		<div style={s.tileLabel}>{label}</div>
		<div style={s.tileValue}>{value}</div>
		{note && <div style={s.tileNote}>{note}</div>}
	</div>
);

// =============================================================================
// TOASTS
// =============================================================================

const ts: Record<string, React.CSSProperties> = {
	wrap: { position: 'absolute', right: 18, bottom: 18, display: 'flex', flexDirection: 'column', gap: 10, zIndex: 50, width: 340, pointerEvents: 'none' },
	toast: { pointerEvents: 'auto', background: 'var(--rr-bg-paper)', border: '1px solid var(--rr-border)', borderRadius: 10, padding: '12px 14px', boxShadow: '0 8px 24px rgba(0,0,0,0.18)', fontFamily: 'var(--rr-font-family, system-ui)' },
	title: { fontSize: 13.5, fontWeight: 700, color: 'var(--rr-text-primary)' },
	body: { fontSize: 12.5, color: 'var(--rr-text-secondary)', marginTop: 3, lineHeight: 1.45 },
	row: { display: 'flex', gap: 6, marginTop: 8, justifyContent: 'flex-end' },
};

const TOAST_COLOR: Record<Toast['variant'], string> = {
	info: 'var(--rr-color-info)',
	success: 'var(--rr-color-success)',
	warning: 'var(--rr-color-warning)',
	error: 'var(--rr-color-error)',
};

export const Toasts: React.FC<{ toasts: Toast[]; onOpen: (fp: string) => void }> = ({ toasts, onOpen }) => (
	<div style={ts.wrap}>
		{toasts.map((t) => (
			<div key={t.id} style={{ ...ts.toast, borderLeft: `4px solid ${TOAST_COLOR[t.variant]}` }} role="status">
				<div style={ts.title}>{t.title}</div>
				<div style={ts.body}>{t.body}</div>
				<div style={ts.row}>
					{t.fp && (
						<Button
							small
							onClick={() => {
								onOpen(t.fp!);
								dismissToast(t.id);
							}}
						>
							View
						</Button>
					)}
					<Button variant="ghost" small onClick={() => dismissToast(t.id)}>
						Dismiss
					</Button>
				</div>
			</div>
		))}
	</div>
);
