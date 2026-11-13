import { Question, type PipelineConfig, type RocketRideClient } from 'rocketride';
import geminiPipeline from './gemini.pipe';
import redisPipeline from './redis.pipe';

export const DEFAULT_TTL_SECONDS = 30;
export const MAX_QUESTION_LENGTH = 2000;

const sampleAnswers = [
	[
		'What is a cache hit?',
		'A cache hit happens when a requested answer is already stored and has not expired. The app returns the stored answer from Redis without generating it again.',
	],
	[
		'Why do cache entries expire?',
		'An expiration gives a cached answer a limited lifetime. Once that time runs out, the next request can generate a fresh answer and store it with a new expiration.',
	],
	[
		'What does a Redis key prefix do?',
		'A key prefix groups related entries under a shared name. This app uses its own prefix so its cache entries stay distinct from other keys in the same Redis database.',
	],
] as const;

export const SAMPLE_QUESTIONS = sampleAnswers.map(([question]) => question);

export type AnswerMode = 'sample' | 'gemini';
export type AnswerStage = 'checking-cache' | 'generating-answer' | 'loading-sample' | 'saving-answer';

export type AnswerResult = {
	answer: string;
	source: 'redis' | 'gemini' | 'sample';
	cacheHit: boolean;
	ttlSeconds: number | null;
	elapsedMs: number;
};

type AnswerClient = Pick<RocketRideClient, 'chat' | 'tool' | 'use'>;
type RedisResult<T> = ({ success: true } & T) | { success: false; error: string };

async function getToken(client: AnswerClient, pipeline: PipelineConfig) {
	// Reuse a running task, or start a fresh task after the engine's idle timeout.
	const { token } = await client.use({ pipeline, useExisting: true, pipelineTraceLevel: 'none' });
	return token;
}

async function runRedis<T>(
	client: AnswerClient,
	token: string,
	tool: 'redis_get' | 'redis_set',
	input: Record<string, unknown>,
): Promise<T> {
	const action = tool === 'redis_get' ? 'read' : 'write';
	let result: RedisResult<T>;
	try {
		result = await client.tool<RedisResult<T>>({ token, tool, nodeId: 'redis_1', input });
	} catch {
		throw new Error(`The Redis ${action} could not complete. Check the RocketRide development engine.`);
	}
	if (!result.success) {
		throw new Error(`Redis ${action} failed. ${result.error}`);
	}
	return result;
}

async function readAnswer(client: AnswerClient, token: string, key: string) {
	const result = await runRedis<{ found: boolean; value: string | null; ttl_seconds: number }>(
		client, token, 'redis_get', { key },
	);
	if (!result.found) return null;
	if (typeof result.value !== 'string') {
		throw new Error('Redis returned an unreadable cached answer.');
	}
	return {
		answer: result.value,
		source: 'redis' as const,
		ttlSeconds: result.ttl_seconds < 0 ? null : result.ttl_seconds,
	};
}

async function generateAnswer(client: AnswerClient, text: string) {
	const question = new Question();
	question.addQuestion(text);
	question.addInstruction('Format', 'Answer in plain text in three short paragraphs or fewer.');
	let answer: unknown;
	try {
		const token = await getToken(client, geminiPipeline);
		const response = await client.chat({ token, question });
		answer = response.answers?.[0];
	} catch {
		throw new Error('Gemini could not answer. Check ROCKETRIDE_GEMINI_KEY and the development engine log.');
	}
	// The Gemini node can return provider failures in the answers lane.
	if (typeof answer !== 'string' || !answer.trim() || answer.startsWith('**LLM error**')) {
		throw new Error('Gemini returned no usable answer. Check ROCKETRIDE_GEMINI_KEY and the development engine log.');
	}
	return answer.trim();
}

export async function getAnswer(
	client: AnswerClient,
	question: string,
	ttlSeconds: number,
	mode: AnswerMode,
	onStage?: (stage: AnswerStage) => void,
): Promise<AnswerResult> {
	const text = question.trim();
	if (!text || text.length > MAX_QUESTION_LENGTH) {
		throw new Error(`Enter a question of 1 to ${MAX_QUESTION_LENGTH} characters.`);
	}
	if (!Number.isInteger(ttlSeconds) || ttlSeconds < 1 || ttlSeconds > 2147483647) {
		throw new Error('Enter a valid whole number of seconds for the cache lifetime.');
	}

	const sample = mode === 'sample'
		? sampleAnswers.find(([prompt]) => prompt.toLowerCase() === text.toLowerCase())
		: undefined;
	if (mode === 'sample' && !sample) {
		throw new Error('Choose one of the sample questions or switch to Gemini for your own question.');
	}

	const started = performance.now();
	const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(sample?.[0] ?? text));
	const key = `${mode}:${Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')}`;
	const elapsed = () => Math.round(performance.now() - started);

	onStage?.('checking-cache');
	let token: string;
	try {
		token = await getToken(client, redisPipeline);
	} catch {
		throw new Error('Could not start the Redis pipeline. Check the development engine and the Redis service at 127.0.0.1:6381.');
	}
	const cached = await readAnswer(client, token, key);
	if (cached) return { ...cached, cacheHit: true, elapsedMs: elapsed() };

	onStage?.(sample ? 'loading-sample' : 'generating-answer');
	const answer = sample ? sample[1] : await generateAnswer(client, text);
	onStage?.('saving-answer');
	const write = await runRedis<{ stored: boolean }>(client, token, 'redis_set', {
		key,
		value: answer,
		ttl_seconds: ttlSeconds,
		condition: 'NX',
	});
	if (!write.stored) {
		// Another request can fill the same key while this answer is being prepared.
		const winner = await readAnswer(client, token, key);
		if (winner) return { ...winner, cacheHit: false, elapsedMs: elapsed() };
	}
	return {
		answer,
		source: sample ? 'sample' : 'gemini',
		cacheHit: false,
		ttlSeconds: write.stored ? ttlSeconds : null,
		elapsedMs: elapsed(),
	};
}
