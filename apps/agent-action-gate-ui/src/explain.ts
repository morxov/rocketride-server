import { Question, type RocketRideClient } from 'rocketride';
import pipeline from './explain.pipe';

export async function explainReview(client: Pick<RocketRideClient, 'use' | 'chat'>, status: string, policyEnabled: boolean) {
	const question = new Question();
	question.addQuestion(['Explain these facts to an operator in at most two plain-text sentences.', 'The proposed action is a simulated status summary. It creates only a Redis receipt.', `Proposal status: ${status}.`, `Execution policy: ${policyEnabled ? 'enabled' : 'disabled'}.`, 'Approval must come from a person. Explain the current state without recommending a decision.'].join(' '));
	try {
		const { token } = await client.use({ pipeline, useExisting: true, pipelineTraceLevel: 'none' });
		const result = await client.chat({ token, question });
		const answer = result.answers?.[0];
		if (typeof answer === 'string' && answer.trim() && !answer.startsWith('**LLM error**')) {
			return answer.trim();
		}
	} catch {
		// The local demo works without an AI provider. Keep its errors separate from decisions.
	}
	throw new Error('Gemini could not explain this state. Check the preview engine’s Gemini configuration.');
}
