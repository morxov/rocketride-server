import React from 'react';

export type IconName = 'dashboard' | 'jobs' | 'tracker' | 'assistant' | 'profile' | 'arrow' | 'check' | 'file' | 'refresh' | 'shield' | 'mail';

const paths: Record<IconName, React.ReactNode> = {
	dashboard: (
		<>
			<rect x="3" y="3" width="7" height="7" rx="2" />
			<rect x="14" y="3" width="7" height="7" rx="2" />
			<rect x="3" y="14" width="7" height="7" rx="2" />
			<rect x="14" y="14" width="7" height="7" rx="2" />
		</>
	),
	jobs: (
		<>
			<rect x="3" y="7" width="18" height="14" rx="3" />
			<path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M3 12a24 24 0 0 0 18 0M12 11v4" />
		</>
	),
	tracker: (
		<>
			<rect x="3" y="4" width="18" height="16" rx="3" />
			<path d="M9 4v16m6-16v16M5.5 9h1m5-1h1m5 6h1" />
		</>
	),
	assistant: (
		<>
			<path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5L12 3Z" />
			<path d="m20 3 .5 1.5L22 5l-1.5.5L20 7l-.5-1.5L18 5l1.5-.5L20 3Z" />
		</>
	),
	profile: (
		<>
			<circle cx="12" cy="8" r="4" />
			<path d="M4 21v-2a8 8 0 0 1 16 0v2" />
		</>
	),
	mail: (
		<>
			<rect x="3" y="5" width="18" height="14" rx="3" />
			<path d="m3 7 9 6 9-6" />
		</>
	),
	arrow: <path d="M5 12h14m-6-6 6 6-6 6" />,
	check: <path d="m5 12 4 4L19 6" />,
	file: (
		<>
			<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9l-6-6Z" />
			<path d="M14 3v6h6M8 13h8m-8 4h5" />
		</>
	),
	refresh: (
		<>
			<path d="M20 8a8 8 0 0 0-14-3L3 8m0-5v5h5M4 16a8 8 0 0 0 14 3l3-3m0 5v-5h-5" />
		</>
	),
	shield: (
		<>
			<path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6l8-3Z" />
			<path d="m8 12 3 3 5-6" />
		</>
	),
};

export const Icon: React.FC<{ name: IconName; size?: number; className?: string }> = ({ name, size = 20, className }) => (
	<svg className={className} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
		{paths[name]}
	</svg>
);

export const RadarMark: React.FC<{ size?: number }> = ({ size = 34 }) => (
	<svg width={size} height={size} viewBox="0 0 40 40" fill="none" aria-hidden="true">
		<rect width="40" height="40" rx="12" fill="#4a9eb6" />
		<circle cx="20" cy="20" r="12" stroke="#D8F3FC" strokeWidth="1.3" />
		<circle cx="20" cy="20" r="7" stroke="#D8F3FC" strokeWidth="1.3" />
		<path d="m20 20 8-9" stroke="white" strokeWidth="2" strokeLinecap="round" />
		<circle cx="20" cy="20" r="2.5" fill="white" />
		<circle cx="12" cy="25" r="2" fill="#E8F9FE" />
	</svg>
);

export const Brand: React.FC = () => (
	<div className="jr-brand">
		<RadarMark />
		<span>
			JobRadar<span className="jr-brand-dot">.</span>
		</span>
	</div>
);
