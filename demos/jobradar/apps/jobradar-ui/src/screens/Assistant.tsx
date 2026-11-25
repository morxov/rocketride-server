/**
 * Assistant: chat with an agent that reads your live JobRadar data from
 * Redis, saves notes and reminders in its own namespace, and reads job pages.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Button, ChatView, useChatMessages } from 'shell';
import assistantPipe from '../pipelines/assistant.pipe';
import { dropToken, pipelineToken } from '../lib/redis';
import { useApp } from '../state';
import { PageHeader } from '../ui';
import { Icon } from '../icons';

const st: Record<string, React.CSSProperties> = {
	wrap: { display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, background: 'var(--rr-bg-default)', fontFamily: 'var(--rr-font-family, system-ui)' },
	chat: { flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' },
};

const SUGGESTIONS = ['What are my best new matches today?', 'Which applications should I follow up on?', 'Remind me to prep for interviews on Friday', 'Compare my top 3 matches'];

export const Assistant: React.FC = () => {
	const { client, isConnected, reloadUser } = useApp();
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

	const { messages, isTyping, sendMessage, clearMessages } = useChatMessages();

	const send = useCallback(
		async (text: string) => {
			if (!client || !token) return;
			await sendMessage(text, client, token);
			// The agent may have saved a note or reminder: pick it up.
			if (/remind|note|remember|save/i.test(text)) void reloadUser();
		},
		[client, token, sendMessage, reloadUser]
	);

	return (
		<div style={st.wrap}>
			<div className="jr-chat-head">
				<PageHeader
					title="Your job search assistant"
					subtitle="Talk through your matches, plan a follow-up, or save a reminder. Your assistant has the context."
					actions={
						messages.length > 0 ? (
							<Button variant="ghost" small onClick={clearMessages}>
								New chat
							</Button>
						) : undefined
					}
				/>
			</div>
			{messages.length === 0 && (
				<div className="jr-chat-suggestions">
					{SUGGESTIONS.map((q) => (
						<Button key={q} variant="secondary" small disabled={!token} onClick={() => void send(q)}>
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
