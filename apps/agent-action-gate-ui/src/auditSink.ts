import type { RocketRideClient } from 'rocketride';
import type { AuditEvent } from './actionGate';
import managedPipeline from './audit-managed.pipe';
import postgresPipeline from './audit-postgres.pipe';

export type SqlAuditMode = 'managed' | 'postgres';

type SqlAuditClient = Pick<RocketRideClient, 'use' | 'tool'>;

const insertAuditEvents = `
	INSERT INTO agent_action_gate_audit
		(workspace_id, event_id, proposal_id, request_id, action, kind, occurred_at, detail)
	SELECT workspace_id, event_id, proposal_id, request_id, action, kind, occurred_at, detail
	FROM jsonb_to_recordset(CAST($1 AS jsonb)) AS events (
		workspace_id text, event_id text, proposal_id text, request_id text,
		action text, kind text, occurred_at timestamptz, detail text
	)
	ON CONFLICT (workspace_id, event_id) DO NOTHING`;

export async function syncSqlAudit(client: SqlAuditClient, events: readonly AuditEvent[], mode: SqlAuditMode): Promise<number> {
	if (events.length === 0) return 0;

	const records = events.map((event) => ({
		workspace_id: event.workspace,
		event_id: event.id,
		proposal_id: event.proposalId,
		request_id: event.requestId,
		action: event.action,
		kind: event.kind,
		occurred_at: new Date(event.at).toISOString(),
		detail: event.detail,
	}));
	const pipeline = mode === 'managed' ? managedPipeline : postgresPipeline;
	let token: string;
	try {
		({ token } = await client.use({ pipeline, useExisting: true, pipelineTraceLevel: 'none' }));
	} catch {
		throw new Error(mode === 'managed' ? 'Could not start the RocketRide SQL audit. Check the managed database connection.' : 'Could not start the PostgreSQL audit. Check the engine’s PostgreSQL connection settings.');
	}

	let result: { affected_rows?: number };
	try {
		result = await client.tool({
			token,
			tool: 'execute',
			nodeId: 'audit_1',
			input: { sql: insertAuditEvents, params: [JSON.stringify(records)] },
		});
	} catch {
		throw new Error('Could not sync the SQL audit. Check that the audit schema is installed and writable.');
	}
	const inserted = result?.affected_rows;
	if (typeof inserted !== 'number' || !Number.isInteger(inserted) || inserted < 0 || inserted > events.length) {
		throw new Error('SQL audit sync did not return a valid write count.');
	}
	return inserted;
}
