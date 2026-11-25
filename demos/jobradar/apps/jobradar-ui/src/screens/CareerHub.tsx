import React, { useId, useState } from 'react';
import { PageHeader, s } from '../ui';
import { CareerInsights } from './CareerInsights';
import { CareerPeople } from './CareerPeople';
import { CareerInterviews } from './CareerInterviews';
import { CareerAnswers } from './CareerAnswers';
const TABS = [
	{ id: 'insights', label: 'Search insights' },
	{ id: 'people', label: 'Networking' },
	{ id: 'interviews', label: 'Interviews' },
	{ id: 'answers', label: 'Answer bank' },
] as const;
type CareerTab = (typeof TABS)[number]['id'];
export const CareerHub: React.FC = () => {
	const [tab, setTab] = useState<CareerTab>('insights');
	const id = useId();
	return (
		<div style={s.page}>
			<div style={s.inner}>
				<PageHeader title="Career tools" subtitle="Turn a list of possibilities into your next opportunity." />
				<div className="jr-career-tabs" role="tablist" aria-label="Career tools">
					{TABS.map((entry, index) => (
						<button
							key={entry.id}
							type="button"
							role="tab"
							id={`${id}-${entry.id}`}
							aria-controls={`${id}-panel`}
							aria-selected={tab === entry.id}
							tabIndex={tab === entry.id ? 0 : -1}
							onClick={() => setTab(entry.id)}
							onKeyDown={(event) => {
								if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
								event.preventDefault();
								const next = event.key === 'Home' ? 0 : event.key === 'End' ? TABS.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + TABS.length) % TABS.length;
								setTab(TABS[next].id);
								event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role=tab]')[next]?.focus();
							}}
						>
							{entry.label}
						</button>
					))}
				</div>
				<section role="tabpanel" id={`${id}-panel`} aria-labelledby={`${id}-${tab}`} tabIndex={0}>
					{tab === 'insights' && <CareerInsights />}
					{tab === 'people' && <CareerPeople />}
					{tab === 'interviews' && <CareerInterviews />}
					{tab === 'answers' && <CareerAnswers />}
				</section>
			</div>
		</div>
	);
};
