import type { RocketRideClient } from 'rocketride';
import { scrapePage } from './pipelines';
import { cacheDescription, cachedDescription, type TrackItem } from './store';
import { webUrl } from './career';
export async function careerPosting(client: RocketRideClient, job: TrackItem): Promise<string> {
	if (job.description?.trim()) return job.description;
	const cached = await cachedDescription(client, job.fp);
	if (cached) return cached;
	const description = await scrapePage(client, webUrl(job.url));
	if (!description.trim()) throw new Error('The posting has no readable description. Add a saved description first.');
	await cacheDescription(client, job.fp, description);
	return description;
}
