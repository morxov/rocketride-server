/**
 * Assistant: chat with an agent that reads your live JobRadar data from
 * the workspace snapshot and reads job pages.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Button, ChatView } from 'shell';
import assistantPipe from '../pipelines/assistant.pipe';
import { dropToken, pipelineToken } from '../lib/pipelines';
import { dataStore } from '../lib/storage';
import { Question } from 'rocketride';
import { useApp } from '../state';
import { PageHeader } from '../ui';
import { Icon } from '../icons';

const st: Record<string, React.CSSProperties> = {
	wrap: { display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, background: 'var(--rr-bg-default)', fontFamily: 'var(--rr-font-family, system-ui)' },
	chat: { flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' },
};

const SUGGESTIONS = ['What are my best new matches today?', 'Which applications should I follow up on?', 'Help me prepare for interviews on Friday', 'Compare my top 3 matches'];

export const Assistant: React.FC = () => {
	const { client, isConnected } = useApp();
	const [token, setToken] = useState<string | null>(null);
	const started = useRef(false);

	useEffect(() => {
		if (!client || !isConnected || started.current) return;
		started.current = true;
		pipelineToken(client, assistantPipe, 'JobRadar assistant')
			.then(setToken)
			.catch(() => {
				started.current = false;
				dropToken(client, assistantPipe);
			});
	}, [client, isConnected]);

	const history = useRef<{ role: 'user' | 'assistant'; content: string }[]>([]);
	const request = useCallback(
		async (text: string) => {
			if (!client || !token) throw new Error('Connect to RocketRide to continue.');
			const digest = await dataStore(client, 'user').getJson('digest');
			const question = new Question();
			question.addQuestion(JSON.stringify({ question: text, digest }));
			for (const message of history.current.slice(-6)) question.addHistory(message);
			const result = (await client.chat({ token, question })) as { answers?: string[] };
			const answer = result.answers?.join('\n') || 'No answer returned. Please try again.';
			history.current.push({ role: 'user', content: text }, { role: 'assistant', content: answer });
			return [{ text: answer, key: 'answers' }];
		},
		[client, token]
	);
	const [messages, setMessages] = useState<React.ComponentProps<typeof ChatView>['messages']>([]);
	const [isTyping, setIsTyping] = useState(false);
	const nextId = useRef(0);
	const clearMessages = () => setMessages([]);

	const send = async (text: string) => {
		if (!client || !token || isTyping || !text.trim()) return;
		const timestamp = () => new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
		setMessages((previous) => [...previous, { id: ++nextId.current, text, sender: 'user', timestamp: timestamp() }]);
		setIsTyping(true);
		try {
			const answers = await request(text);
			setMessages((previous) => [...previous, ...answers.map((answer) => ({ id: ++nextId.current, text: answer.text, sender: 'bot' as const, timestamp: timestamp() }))]);
		} catch (error) {
			setMessages((previous) => [...previous, { id: ++nextId.current, text: error instanceof Error ? error.message : 'Please try again.', sender: 'bot', timestamp: timestamp() }]);
			dropToken(client, assistantPipe);
			started.current = false;
			void pipelineToken(client, assistantPipe, 'JobRadar assistant')
				.then(setToken)
				.catch(() => setToken(null));
		} finally {
			setIsTyping(false);
		}
	};

	return (
		<div style={st.wrap}>
			<div className="jr-chat-head">
				<PageHeader
					title="Your job search assistant"
					subtitle="Talk through your matches, plan a follow-up, or prepare for an interview. Your assistant has the context."
					actions={
						messages.length > 0 ? (
							<Button
								variant="ghost"
								small
								disabled={isTyping}
								onClick={() => {
									history.current = [];
									clearMessages();
								}}
							>
								New chat
							</Button>
						) : undefined
					}
				/>
			</div>
			{messages.length === 0 && (
				<div className="jr-chat-suggestions">
					{SUGGESTIONS.map((q) => (
						<Button key={q} variant="secondary" small disabled={!token || isTyping} onClick={() => void send(q)}>
							<Icon name="assistant" size={17} />
							{q}
						</Button>
					))}
				</div>
			)}
			<div style={st.chat}>
				<ChatView messages={messages} isTyping={isTyping} isConnected={isConnected && !!token} onSend={(t) => void send(t)} placeholder="Ask about jobs, your applications, or paste a job link" emptyTitle="Ask JobRadar anything" emptyDescription="It answers from your live data and never applies or sends anything for you." />
			</div>
		</div>
	);
};
