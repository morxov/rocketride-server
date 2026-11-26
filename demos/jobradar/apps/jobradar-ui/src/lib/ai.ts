/**
 * The two LLM pipelines the app calls directly: resume import and the writer.
 * The model explains and drafts; the app decides what to store.
 */

import { Question, type PipelineConfig, type RocketRideClient } from 'rocketride';
import profilePipe from '../pipelines/profile.pipe';
import writerPipe from '../pipelines/writer.pipe';
import type { Profile } from './match';
import { dropToken, pipelineToken } from './pipelines';

export const WRITER_VERSION = writerPipe.project_id;

const sampleResumeUrl = new URL('../assets/sample-resume.pdf', import.meta.url).href;

function parseJsonObject(raw: unknown): Record<string, unknown> {
	if (raw && typeof raw === 'object') return raw as Record<string, unknown>;
	const text = String(raw ?? '');
	const start = text.indexOf('{');
	const end = text.lastIndexOf('}');
	if (start < 0 || end <= start) throw new Error('The model did not return a profile. Is the file a readable resume?');
	return JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>;
}

const strings = (v: unknown, max: number) =>
	Array.isArray(v)
		? v
				.map(String)
				.map((s) => s.trim())
				.filter(Boolean)
				.slice(0, max)
		: [];

/** Upload a resume; returns the extracted profile and the plain resume text. */
export async function importResume(client: RocketRideClient, file: File): Promise<{ profile: Profile; text: string }> {
	const pipeline = profilePipe as unknown as PipelineConfig & { project_id: string };
	const { token } = await client.use({ pipeline, useExisting: true, ttl: 600, name: 'JobRadar resume import' });
	const bytes = new Uint8Array(await file.arrayBuffer());
	// Anything but text/* reaches parse on the tags lane.
	const mime = /\.pdf$/i.test(file.name) ? 'application/pdf' : 'application/octet-stream';
	let res: Record<string, unknown> | undefined;
	try {
		res = (await client.send(token, bytes, { name: file.name }, mime)) as Record<string, unknown> | undefined;
	} catch (e) {
		await client.terminate(token).catch(() => undefined);
		throw e;
	}
	const answers = res?.answers as unknown[] | undefined;
	if (!answers?.length) throw new Error('Could not read that file. Try a PDF or DOCX resume.');
	const p = parseJsonObject(answers[answers.length - 1]);
	const textRaw = res?.text;
	const text = Array.isArray(textRaw) ? textRaw.join('\n') : String(textRaw ?? '');
	const level = p.level === 'new_grad' ? 'new_grad' : 'intern';
	return {
		profile: {
			name: String(p.name ?? ''),
			headline: String(p.headline ?? ''),
			level,
			graduation: String(p.graduation ?? ''),
			target_roles: strings(p.target_roles, 5),
			skills: strings(p.skills, 25),
			locations: strings(p.locations, 6),
			evidence: strings(p.evidence, 12),
		},
		text: text.replace(/[ \t]+\n/g, '\n').trim(),
	};
}

export type WriterTask = 'fit' | 'cover' | 'followup' | 'ask' | 'resume' | 'mail' | 'assistant' | 'interview_prep' | 'practice_feedback' | 'outreach' | 'application_answer';

/** Ask the writer pipeline for an explanation or a draft. Returns Markdown or plain text. */
export async function write(client: RocketRideClient, task: WriterTask, facts: Record<string, unknown>): Promise<string> {
	const token = await pipelineToken(client, writerPipe, 'JobRadar writer');
	const q = new Question();
	q.addQuestion(JSON.stringify({ task, ...facts }));
	try {
		const res = (await client.chat({ token, question: q })) as { answers?: unknown[] };
		const a = res.answers?.[res.answers.length - 1];
		return typeof a === 'string' ? a : JSON.stringify(a ?? 'No answer.');
	} catch (e) {
		dropToken(client, writerPipe);
		throw e;
	}
}

/** Facts about the user that the writer may draw on: nothing else is sent. */
export function profileFacts(profile: Profile | null, resume: string) {
	return {
		profile: profile && { name: profile.name, headline: profile.headline, level: profile.level, graduation: profile.graduation, skills: profile.skills, evidence: profile.evidence },
		resume_excerpt: resume.slice(0, 6000),
	};
}

/** A fictional sample resume shipped with the app, for trying JobRadar out. */
export async function sampleResume(): Promise<File> {
	const res = await fetch(sampleResumeUrl);
	if (!res.ok) throw new Error('Sample resume not found');
	return new File([await res.blob()], 'sample-resume.pdf', { type: 'application/pdf' });
}
