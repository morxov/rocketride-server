/**
 * Job and tracker actions shared by every screen: write to the file store, then patch
 * local state so the screen updates without a full reload.
 */

import { useCallback } from 'react';
import type { ScoredJob } from './lib/match';
import { hideJob, markSeen, track, unhideJob, untrack, type Status, type TrackItem } from './lib/store';
import { toast, useApp } from './state';

export function useJobActions() {
	const app = useApp();
	const { client, patchUser, reloadUser } = app;

	const fail = (e: unknown) => toast({ variant: 'error', title: 'That did not save', body: e instanceof Error ? e.message : String(e) });

	const setStatus = useCallback(
		async (job: Pick<ScoredJob, 'fp' | 'title' | 'company' | 'url' | 'locations'>, status: Status) => {
			if (!client) return false;
			try {
				const existing = app.user?.tracker.find((t) => t.fp === job.fp);
				const item = await track(client, job, status);
				patchUser((u) => ({ ...u, tracker: [item, ...u.tracker.filter((t) => t.fp !== job.fp)], seen: new Set(u.seen).add(job.fp), appliedThisWeek: status === 'applied' && !existing?.appliedAt ? u.appliedThisWeek + 1 : u.appliedThisWeek }));
				if (status === 'applied' || status === 'interview' || status === 'assessment')
					await reloadUser(); // picks up the new reminder
				else if (status === 'offer' || status === 'closed') patchUser((u) => ({ ...u, reminders: u.reminders.filter((r) => !(r.source === 'app' && r.fp === job.fp)) })); // track() deleted it
				toast({ variant: 'success', title: status === 'saved' ? 'Saved to tracker' : 'Tracker updated', body: `${job.title} at ${job.company}: ${status === 'applied' ? 'applied. A follow-up reminder is set for 7 days from now.' : status}` }, 5000);
				return true;
			} catch (e) {
				fail(e);
				return false;
			}
		},
		[client, app.user, patchUser, reloadUser]
	);

	const hide = useCallback(
		async (job: ScoredJob) => {
			if (!client) return;
			try {
				await hideJob(client, job.fp);
				patchUser((u) => ({ ...u, hidden: new Set(u.hidden).add(job.fp) }));
			} catch (e) {
				fail(e);
			}
		},
		[client, patchUser]
	);

	const unhide = useCallback(
		async (job: ScoredJob) => {
			if (!client) return;
			try {
				await unhideJob(client, job.fp);
				patchUser((u) => {
					const hidden = new Set(u.hidden);
					hidden.delete(job.fp);
					return { ...u, hidden };
				});
			} catch (e) {
				fail(e);
			}
		},
		[client, patchUser]
	);

	const seen = useCallback(
		async (fp: string) => {
			if (!client || app.user?.seen.has(fp)) return;
			patchUser((u) => ({ ...u, seen: new Set(u.seen).add(fp) }));
			await markSeen(client, fp).catch(() => undefined);
		},
		[client, app.user, patchUser]
	);

	const remove = useCallback(
		async (item: TrackItem) => {
			if (!client) return;
			try {
				await untrack(client, item.fp);
				patchUser((u) => ({ ...u, tracker: u.tracker.filter((t) => t.fp !== item.fp), reminders: u.reminders.filter((r) => r.fp !== item.fp) }));
			} catch (e) {
				fail(e);
			}
		},
		[client, patchUser]
	);

	return { setStatus, hide, unhide, seen, remove };
}
