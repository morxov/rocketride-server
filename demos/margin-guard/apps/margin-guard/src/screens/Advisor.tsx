/**
 * Advisor: chat with a read-only agent. Its tool_redis node has writes
 * switched off, so the node itself refuses any change the agent attempts.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ChatView, useChatMessages } from 'shell';
import advisorPipe from '../pipelines/advisor.pipe';
import { dropToken, pipelineToken } from '../lib/session';
import { useGuard } from '../state';

const styles: Record<string, React.CSSProperties> = {
	wrap: { display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, fontFamily: 'var(--rr-font-family, system-ui)' },
	head: { padding: '18px 24px 8px' },
	title: { fontSize: 24, fontWeight: 700, color: 'var(--rr-text-primary)' },
	sub: { fontSize: 14, color: 'var(--rr-text-secondary)', marginTop: 4 },
	chat: { flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' },
};

export const Advisor: React.FC = () => {
	const { client, isConnected } = useGuard();
	const [token, setToken] = useState<string | null>(null);
	const started = useRef(false);

	// Start the agent pipeline once and keep its token for every message.
	useEffect(() => {
		if (!client || !isConnected || started.current) return;
		started.current = true;
		pipelineToken(client, advisorPipe, 'Margin Guard advisor')
			.then(setToken)
			.catch(() => {
				started.current = false;
				dropToken(client, advisorPipe);
			});
	}, [client, isConnected]);

	const { messages, isTyping, sendMessage } = useChatMessages();

	const onSend = useCallback(
		(text: string) => {
			if (!client || !token) return;
			void sendMessage(text, client, token);
		},
		[client, token, sendMessage],
	);

	return (
		<div style={styles.wrap}>
			<div style={styles.head}>
				<div style={styles.title}>Advisor</div>
				<div style={styles.sub}>An agent that answers from live Redis keys. Its Redis connection is read-only.</div>
			</div>
			<div style={styles.chat}>
				<ChatView messages={messages} isTyping={isTyping} isConnected={isConnected && !!token} onSend={onSend} placeholder="Ask about spend, budgets or margin"
					emptyTitle="Ask about this month's AI spend"
					emptyDescription="Try: Which customers are losing us money? What is driving Hooli's cost? Which features are switched off?"
				/>
			</div>
		</div>
	);
};
