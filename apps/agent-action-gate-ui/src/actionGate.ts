import type { RocketRideClient } from 'rocketride';
import redisPipeline from './redis.pipe';

export const WORKSPACE = 'demo';
export const DEFAULT_TTL_SECONDS = 120;
export const MAX_TTL_SECONDS = 3600;

export type ProposalInput = {
	requestId: string;
	action: 'send-summary';
	target: string;
	summary: string;
	ttlSeconds: number;
};

export type ProposalStatus = 'pending' | 'approved' | 'rejected' | 'expired' | 'executed';
export type ReviewDecision = 'approve' | 'reject';

export type Receipt = {
	id: string;
	proposalId: string;
	target: string;
	at: number;
};

type Proposal = ProposalInput & {
	id: string;
	workspace: typeof WORKSPACE;
	createdAt: number;
	expiresAt: number;
};

export type ProposalRecord = Proposal & {
	status: ProposalStatus;
	reviewedAt: number | null;
	receipt: Receipt | null;
};

export type AuditEvent = {
	id: string;
	workspace: typeof WORKSPACE;
	proposalId: string | null;
	requestId: string | null;
	action: ProposalInput['action'] | null;
	kind: 'proposed' | 'approved' | 'rejected' | 'expired' | 'executed' | 'policy-enabled' | 'policy-disabled' | 'blocked';
	at: number;
	detail: string;
};

export type GateSnapshot = {
	policyEnabled: boolean;
	proposals: ProposalRecord[];
	audit: AuditEvent[];
	counts: Record<ProposalStatus, number>;
};

type GateClient = Pick<RocketRideClient, 'tool' | 'use'>;
type RedisResult<T> = ({ success: true } & T) | { success: false; error: string; outcome: 'not_applied' | 'unknown' };
type DecisionRecord = { decision: ReviewDecision; at: number };

const prefix = `${WORKSPACE}:`;
const keys = {
	proposal: (id: string) => `proposal:${id}`,
	pending: (id: string) => `pending:${id}`,
	decision: (id: string) => `decision:${id}`,
	receipt: (id: string) => `receipt:${id}`,
	audit: (id: string) => `audit:${id}`,
	policy: 'policy',
};

function normalizeInput(input: ProposalInput): ProposalInput {
	if (input.action !== 'send-summary') throw new Error('This action is outside the demo allowlist.');
	if (!/^[A-Za-z0-9._:-]{1,100}$/.test(input.requestId)) {
		throw new Error('Enter a request ID with 1–100 letters, numbers, periods, underscores, colons, or hyphens.');
	}
	const target = input.target.trim();
	if (!/^[A-Za-z0-9._@#:-]{1,80}$/.test(target)) {
		throw new Error('Enter a target with 1–80 letters, numbers, or the characters . _ @ # : -');
	}
	const summary = input.summary.trim();
	if (!summary || summary.length > 400) throw new Error('Enter a summary of 1–400 characters.');
	if (!Number.isInteger(input.ttlSeconds) || input.ttlSeconds < 1 || input.ttlSeconds > MAX_TTL_SECONDS) {
		throw new Error(`Enter a lifetime of 1–${MAX_TTL_SECONDS} whole seconds.`);
	}
	return { requestId: input.requestId, action: input.action, target, summary, ttlSeconds: input.ttlSeconds };
}

async function proposalId(requestId: string) {
	const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${WORKSPACE}:${requestId}`));
	return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function requireMatchingInput(proposal: Proposal, input: ProposalInput) {
	if (proposal.action !== input.action || proposal.target !== input.target || proposal.summary !== input.summary || proposal.ttlSeconds !== input.ttlSeconds) {
		throw new Error('This request ID belongs to a different proposal. Use a new request ID.');
	}
}

function proposalEvent(proposal: Proposal, kind: AuditEvent['kind'], at: number, detail: string): AuditEvent {
	return {
		id: `${proposal.id}:${kind}`,
		workspace: WORKSPACE,
		proposalId: proposal.id,
		requestId: proposal.requestId,
		action: proposal.action,
		kind,
		at,
		detail,
	};
}

function createRedis(client: GateClient, token: string) {
	async function tool<T>(name: 'redis_get' | 'redis_set' | 'redis_scan', input: Record<string, unknown>): Promise<T> {
		let result: RedisResult<T>;
		try {
			result = await client.tool<RedisResult<T>>({ token, tool: name, nodeId: 'redis_1', input });
		} catch {
			if (name === 'redis_set') {
				throw new Error('Redis did not confirm the write. Refresh before retrying.');
			}
			throw new Error('Could not read Redis. Check the local RocketRide engine.');
		}
		if (!result.success) {
			const guidance = result.outcome === 'unknown' ? ' Refresh before retrying.' : '';
			throw new Error(`${result.error}${guidance}`);
		}
		return result;
	}

	return {
		async get<T>(key: string): Promise<T | null> {
			const result = await tool<{ value: string | null }>('redis_get', { key: prefix + key });
			return result.value === null ? null : (JSON.parse(result.value) as T);
		},
		async put(key: string, value: unknown, ttlSeconds = 0, onlyIfAbsent = true) {
			const { stored } = await tool<{ stored: boolean }>('redis_set', {
				key: prefix + key,
				value: JSON.stringify(value),
				ttl_seconds: ttlSeconds,
				...(onlyIfAbsent ? { condition: 'NX' } : {}),
			});
			return stored;
		},
		async scan() {
			const found = new Set<string>();
			let cursor = '0';
			do {
				const page = await tool<{ keys: string[]; cursor: string }>('redis_scan', { cursor, count: 100 });
				for (const key of page.keys) {
					if (key.startsWith(prefix)) found.add(key.slice(prefix.length));
				}
				cursor = page.cursor;
			} while (cursor !== '0');
			return [...found];
		},
	};
}

type Redis = ReturnType<typeof createRedis>;

async function inspect(redis: Redis, proposal: Proposal) {
	const [decision, receipt] = await Promise.all([redis.get<DecisionRecord>(keys.decision(proposal.id)), redis.get<Receipt>(keys.receipt(proposal.id))]);

	let status: ProposalStatus = 'pending';
	if (receipt) status = 'executed';
	else if (decision?.decision === 'reject') status = 'rejected';
	else if (Date.now() >= proposal.expiresAt) status = 'expired';
	else if (decision?.decision === 'approve') status = 'approved';

	const record: ProposalRecord = { ...proposal, status, reviewedAt: decision?.at ?? null, receipt };
	return { record, decision };
}

function auditFor(record: ProposalRecord, decision: DecisionRecord | null): AuditEvent[] {
	const events = [proposalEvent(record, 'proposed', record.createdAt, `Proposed sending a summary to ${record.target}.`)];
	if (decision) {
		const approved = decision.decision === 'approve';
		events.push(proposalEvent(record, approved ? 'approved' : 'rejected', decision.at, approved ? 'Approval claimed for this proposal.' : 'Reviewer rejected this proposal.'));
	}
	if (record.status === 'expired') {
		events.push(proposalEvent(record, 'expired', record.expiresAt, 'The Redis proposal lifetime ended without a receipt.'));
	}
	if (record.receipt) {
		events.push(proposalEvent(record, 'executed', record.receipt.at, `Simulation recorded a receipt for ${record.target}.`));
	}
	return events;
}

async function requirePolicy(redis: Redis, proposal: Proposal) {
	const policy = await redis.get<AuditEvent>(keys.policy);
	if (policy?.kind === 'policy-enabled') return;

	const blocked = proposalEvent(proposal, 'blocked', Date.now(), 'The workspace policy was disabled.');
	await redis.put(keys.audit(blocked.id), blocked);
	throw new Error('Enable the workspace policy to run this action.');
}

async function requirePending(redis: Redis, proposal: Proposal) {
	const pending = await redis.get<number>(keys.pending(proposal.id));
	if (Date.now() >= proposal.expiresAt) {
		throw new Error('This proposal expired. Create a new request to run the simulation.');
	}
	if (pending !== proposal.createdAt) {
		throw new Error('The pending Redis entry is unavailable. Submit the same request to restore it.');
	}
}

export function createActionGate(client: GateClient) {
	async function connect() {
		try {
			const { token } = await client.use({ pipeline: redisPipeline, useExisting: true, pipelineTraceLevel: 'none' });
			return createRedis(client, token);
		} catch {
			throw new Error('Could not start Action Gate. Check the local RocketRide engine and Redis service on port 6381.');
		}
	}

	async function loadProposal(id: string) {
		if (!/^[0-9a-f]{64}$/.test(id)) throw new Error('Invalid proposal ID.');
		const redis = await connect();
		const proposal = await redis.get<Proposal>(keys.proposal(id));
		if (!proposal) throw new Error('This proposal could not be found.');
		return { redis, proposal };
	}

	return {
		async list(): Promise<GateSnapshot> {
			const redis = await connect();
			const [allKeys, policy] = await Promise.all([redis.scan(), redis.get<AuditEvent>(keys.policy)]);
			const proposals: ProposalRecord[] = [];
			const events = new Map<string, AuditEvent>();
			const counts: Record<ProposalStatus, number> = { pending: 0, approved: 0, rejected: 0, expired: 0, executed: 0 };
			if (policy) events.set(policy.id, policy);

			// Read small batches so parallel requests stay within the node's Redis pool.
			const relevantKeys = allKeys.filter((key) => key.startsWith('proposal:') || key.startsWith('audit:'));
			for (let offset = 0; offset < relevantKeys.length; offset += 2) {
				await Promise.all(
					relevantKeys.slice(offset, offset + 2).map(async (key) => {
						if (key.startsWith('audit:')) {
							const event = await redis.get<AuditEvent>(key);
							if (event) events.set(event.id, event);
							return;
						}
						const proposal = await redis.get<Proposal>(key);
						if (!proposal) return;
						const { record, decision } = await inspect(redis, proposal);
						proposals.push(record);
						counts[record.status]++;
						for (const event of auditFor(record, decision)) events.set(event.id, event);
					})
				);
			}

			return {
				policyEnabled: policy?.kind === 'policy-enabled',
				proposals: proposals.sort((left, right) => right.createdAt - left.createdAt || left.id.localeCompare(right.id)),
				audit: [...events.values()].sort((left, right) => right.at - left.at || left.id.localeCompare(right.id)),
				counts,
			};
		},

		async propose(rawInput: ProposalInput): Promise<ProposalRecord> {
			const input = normalizeInput(rawInput);
			const id = await proposalId(input.requestId);
			const redis = await connect();
			let proposal = await redis.get<Proposal>(keys.proposal(id));
			if (!proposal) {
				const createdAt = Date.now();
				const candidate: Proposal = {
					...input,
					id,
					workspace: WORKSPACE,
					createdAt,
					expiresAt: createdAt + input.ttlSeconds * 1000,
				};
				// Reserve the immutable request before arming the TTL so an interrupted call can safely resume.
				const reserved = await redis.put(keys.proposal(id), candidate);
				proposal = reserved ? candidate : await redis.get<Proposal>(keys.proposal(id));
			}
			if (!proposal) throw new Error('The proposal could not be confirmed. Refresh and retry.');
			requireMatchingInput(proposal, input);
			const remaining = Math.ceil((proposal.expiresAt - Date.now()) / 1000);
			if (remaining > 0) await redis.put(keys.pending(id), proposal.createdAt, remaining);
			return (await inspect(redis, proposal)).record;
		},

		async review(id: string, choice: ReviewDecision): Promise<ProposalRecord> {
			if (choice !== 'approve' && choice !== 'reject') throw new Error('Invalid review decision.');
			const { redis, proposal } = await loadProposal(id);
			const state = await inspect(redis, proposal);
			if (state.decision) {
				if (state.decision.decision !== choice) throw new Error('This proposal already has a different review decision.');
				return state.record;
			}

			await requirePending(redis, proposal);
			const claim: DecisionRecord = { decision: choice, at: Date.now() };
			const won = await redis.put(keys.decision(id), claim);
			if (!won) {
				const winner = await redis.get<DecisionRecord>(keys.decision(id));
				if (winner?.decision !== choice) throw new Error('Another reviewer already decided this proposal.');
			}
			return (await inspect(redis, proposal)).record;
		},

		async execute(id: string): Promise<ProposalRecord> {
			const { redis, proposal } = await loadProposal(id);
			const state = await inspect(redis, proposal);
			if (state.record.status === 'executed') return state.record;
			if (state.decision?.decision !== 'approve') {
				throw new Error('This action needs a human approval before it can run.');
			}
			if (state.record.status === 'expired') throw new Error('This proposal expired. Create a new request to run the simulation.');
			await requirePolicy(redis, proposal);
			await requirePending(redis, proposal);
			// This key is the entire effect. SET NX permits one receipt across concurrent executions and retries.
			await redis.put(keys.receipt(id), { id: `${id}:receipt`, proposalId: id, target: proposal.target, at: Date.now() } satisfies Receipt);
			return (await inspect(redis, proposal)).record;
		},

		async setPolicy(enabled: boolean): Promise<void> {
			const redis = await connect();
			const previous = await redis.get<AuditEvent>(keys.policy);
			if ((previous?.kind === 'policy-enabled') === enabled) return;
			if (previous) await redis.put(keys.audit(previous.id), previous);

			const event: AuditEvent = {
				id: `policy:${crypto.randomUUID()}`,
				workspace: WORKSPACE,
				proposalId: null,
				requestId: null,
				action: null,
				kind: enabled ? 'policy-enabled' : 'policy-disabled',
				at: Date.now(),
				detail: enabled ? 'Workspace policy enabled simulated sends.' : 'Workspace policy disabled simulated sends.',
			};
			await redis.put(keys.policy, event, 0, false);
			await redis.put(keys.audit(event.id), event);
		},
	};
}
