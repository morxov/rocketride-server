CREATE TABLE IF NOT EXISTS agent_action_gate_audit (
    workspace_id text NOT NULL CHECK (btrim(workspace_id) <> ''),
    event_id text NOT NULL CHECK (btrim(event_id) <> ''),
    proposal_id text,
    request_id text,
    action text,
    kind text NOT NULL,
    occurred_at timestamptz NOT NULL,
    detail text NOT NULL,
    PRIMARY KEY (workspace_id, event_id)
);
