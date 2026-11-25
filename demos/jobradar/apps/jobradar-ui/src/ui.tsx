/**
 * Shared styles and small pieces.
 */

import React from 'react';
import { Button, StatusBadge } from 'shell';
import { ago, type ScoredJob } from './lib/match';
import { dismissToast, type Toast } from './state';
import { Icon } from './icons';

export const s: Record<string, React.CSSProperties> = {
	page: { height: '100%', overflowY: 'auto', background: 'var(--rr-bg-default)', fontFamily: 'var(--rr-font-family, system-ui)', color: 'var(--rr-text-primary)' },
	inner: { maxWidth: 1320, width: '100%', margin: '0 auto', boxSizing: 'border-box', padding: 'clamp(24px, 3.5cqi, 42px) clamp(18px, 3cqi, 40px) 48px' },
	stack: { display: 'flex', flexDirection: 'column', gap: 22, marginTop: 20 },
	row: { display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' },
	grid2: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 340px), 1fr))', gap: 22 },
	tiles: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 210px), 1fr))', gap: 12 },
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
	selected?: boolean;
}> = ({ job, onOpen, actions, compact, selected }) => (
	<article className={`jr-job${compact ? ' jr-job--compact' : ''}${selected ? ' jr-job--selected' : ''}`}>
		<button type="button" className="jr-job-open" onClick={onOpen} aria-label={`View ${job.title} at ${job.company}`}>
			<span className="jr-company" aria-hidden="true">
				{job.company
					.split(/\s+/)
					.slice(0, 2)
					.map((w) => w[0])
					.join('')
					.toUpperCase()}
			</span>
			<span className="jr-job-body">
				<span className="jr-job-title">{job.title}</span>
				<span className="jr-job-meta">
					{job.company}
					{job.locations.length ? ` · ${job.locations.slice(0, 2).join(', ')}${job.locations.length > 2 ? ` +${job.locations.length - 2}` : ''}` : ''}
				</span>
				<span className="jr-job-meta">
					Posted {ago(job.posted)}
					{job.terms?.length ? ` · ${job.terms.join(', ')}` : ''}
				</span>
				<span className="jr-job-flags">
					<JobFlags job={job} />
				</span>
				{!compact && job.reasons.length > 0 && <span className="jr-job-reason">{job.reasons.join(' · ')}</span>}
				{!compact && job.warnings.length > 0 && <span className="jr-job-warn">{job.warnings.join(' · ')}</span>}
			</span>
			<span className="jr-job-score" style={scoreColor(job.score)} aria-label={`Match score ${job.score} out of 100`}>
				<strong>{job.score}</strong>
				<small>match</small>
			</span>
		</button>
		{actions && <div className="jr-job-actions">{actions}</div>}
	</article>
);

export const Tile: React.FC<{ label: string; value: React.ReactNode; note?: string; onClick?: () => void }> = ({ label, value, note, onClick }) => {
	const content = (
		<>
			<div className="jr-metric-top">
				{label}
				{onClick && <Icon name="arrow" size={14} />}
			</div>
			<div className="jr-metric-value">{value}</div>
			{note && <div className="jr-metric-note">{note}</div>}
		</>
	);
	return onClick ? (
		<button type="button" className="jr-metric" onClick={onClick}>
			{content}
		</button>
	) : (
		<div className="jr-metric">{content}</div>
	);
};

export const PageHeader: React.FC<{ title: string; subtitle?: string; actions?: React.ReactNode }> = ({ title, subtitle, actions }) => (
	<header className="jr-header">
		<div>
			<h1>{title}</h1>
			{subtitle && <p>{subtitle}</p>}
		</div>
		{actions && <div className="jr-header-actions">{actions}</div>}
	</header>
);

/** Shared card chrome keeps the app's content groups consistent. */
export const Panel: React.FC<{ header?: React.ReactNode; headerActions?: React.ReactNode; children: React.ReactNode; noBodyPadding?: boolean; toolbar?: React.ReactNode; fill?: boolean }> = ({ header, headerActions, children, noBodyPadding, toolbar, fill }) => (
	<section className={`jr-panel${fill ? ' jr-panel--fill' : ''}`}>
		{(header != null || headerActions != null) && (
			<div className="jr-panel-head">
				<h2>{header}</h2>
				{headerActions}
			</div>
		)}
		{toolbar != null && <div className="jr-panel-toolbar">{toolbar}</div>}
		<div className="jr-panel-body" style={noBodyPadding ? { padding: 0 } : undefined}>
			{children}
		</div>
	</section>
);

// =============================================================================
// TOASTS
// =============================================================================

const ts: Record<string, React.CSSProperties> = {
	wrap: { position: 'absolute', right: 18, bottom: 18, display: 'flex', flexDirection: 'column', gap: 10, zIndex: 50, width: 'min(340px, calc(100% - 36px))', pointerEvents: 'none' },
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
