-- Canonical cross-harness agent schema for analyze-usage.
--
-- Naming conventions:
-- - Every table has an `id` primary key.
-- - Foreign keys follow `{table}_id` and reference `id`.
-- - Provider-native identifiers use `external_*`.
--
-- DuckDB note:
-- - `updated_at` defaults on insert.
-- - DuckDB does not support triggers, so loaders must set
--   `updated_at = CURRENT_TIMESTAMP` on update.

CREATE SEQUENCE IF NOT EXISTS agent_sessions_id_seq START 1;
CREATE SEQUENCE IF NOT EXISTS agent_raw_events_id_seq START 1;
CREATE SEQUENCE IF NOT EXISTS agent_contexts_id_seq START 1;
CREATE SEQUENCE IF NOT EXISTS agent_events_id_seq START 1;
CREATE SEQUENCE IF NOT EXISTS agent_parts_id_seq START 1;
CREATE SEQUENCE IF NOT EXISTS agent_tool_calls_id_seq START 1;
CREATE SEQUENCE IF NOT EXISTS agent_tool_results_id_seq START 1;
CREATE SEQUENCE IF NOT EXISTS agent_tokens_id_seq START 1;

CREATE TABLE IF NOT EXISTS agent_sessions (
    id BIGINT PRIMARY KEY DEFAULT nextval('agent_sessions_id_seq'),
    harness VARCHAR NOT NULL,
    interface VARCHAR,
    external_session_id VARCHAR,
    title VARCHAR,
    started_at TIMESTAMP,
    ended_at TIMESTAMP,
    cwd_first VARCHAR,
    cwd_last VARCHAR,
    repo_name VARCHAR,
    worktree_branch VARCHAR,
    summary_json JSON NOT NULL DEFAULT '{}',
    metadata_json JSON NOT NULL DEFAULT '{}',
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (harness, external_session_id)
);

CREATE TABLE IF NOT EXISTS agent_raw_events (
    id BIGINT PRIMARY KEY DEFAULT nextval('agent_raw_events_id_seq'),
    agent_session_id BIGINT NOT NULL REFERENCES agent_sessions(id),
    harness VARCHAR NOT NULL,
    source_file VARCHAR NOT NULL,
    source_offset BIGINT,
    occurred_at TIMESTAMP,
    event_type VARCHAR NOT NULL,
    external_event_id VARCHAR,
    external_parent_event_id VARCHAR,
    payload JSON NOT NULL,
    payload_sha256 VARCHAR NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (harness, source_file, source_offset)
);

CREATE TABLE IF NOT EXISTS agent_contexts (
    id BIGINT PRIMARY KEY DEFAULT nextval('agent_contexts_id_seq'),
    agent_session_id BIGINT NOT NULL REFERENCES agent_sessions(id),
    agent_raw_event_id BIGINT REFERENCES agent_raw_events(id),
    sequence INTEGER NOT NULL,
    occurred_at TIMESTAMP,
    provider VARCHAR,
    model VARCHAR,
    reasoning_effort VARCHAR,
    cwd VARCHAR,
    repo_name VARCHAR,
    git_branch VARCHAR,
    interface VARCHAR,
    instructions_sha256 VARCHAR,
    metadata_json JSON NOT NULL DEFAULT '{}',
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (agent_session_id, sequence)
);

CREATE TABLE IF NOT EXISTS agent_events (
    id BIGINT PRIMARY KEY DEFAULT nextval('agent_events_id_seq'),
    agent_session_id BIGINT NOT NULL REFERENCES agent_sessions(id),
    agent_context_id BIGINT REFERENCES agent_contexts(id),
    agent_raw_event_id BIGINT REFERENCES agent_raw_events(id),
    parent_agent_event_id BIGINT REFERENCES agent_events(id),
    sequence INTEGER NOT NULL,
    occurred_at TIMESTAMP,
    event_kind VARCHAR NOT NULL,
    role VARCHAR,
    phase VARCHAR,
    status VARCHAR,
    external_event_id VARCHAR,
    metadata_json JSON NOT NULL DEFAULT '{}',
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (agent_session_id, sequence)
);

CREATE TABLE IF NOT EXISTS agent_parts (
    id BIGINT PRIMARY KEY DEFAULT nextval('agent_parts_id_seq'),
    agent_event_id BIGINT NOT NULL REFERENCES agent_events(id),
    sequence INTEGER NOT NULL,
    part_kind VARCHAR NOT NULL,
    mime_type VARCHAR,
    text_value VARCHAR,
    json_value JSON,
    tool_call_id VARCHAR,
    tool_name VARCHAR,
    file_path VARCHAR,
    file_url VARCHAR,
    annotation_json JSON NOT NULL DEFAULT '{}',
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (agent_event_id, sequence)
);

CREATE TABLE IF NOT EXISTS agent_tool_calls (
    id BIGINT PRIMARY KEY DEFAULT nextval('agent_tool_calls_id_seq'),
    agent_event_id BIGINT NOT NULL REFERENCES agent_events(id),
    tool_call_id VARCHAR,
    tool_name VARCHAR NOT NULL,
    args_json JSON NOT NULL DEFAULT '{}',
    transport VARCHAR,
    server_name VARCHAR,
    duration_ms INTEGER,
    metadata_json JSON NOT NULL DEFAULT '{}',
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS agent_tool_results (
    id BIGINT PRIMARY KEY DEFAULT nextval('agent_tool_results_id_seq'),
    agent_event_id BIGINT NOT NULL REFERENCES agent_events(id),
    agent_tool_call_id BIGINT REFERENCES agent_tool_calls(id),
    output_text VARCHAR,
    output_json JSON,
    is_error BOOLEAN NOT NULL DEFAULT FALSE,
    error_type VARCHAR,
    metadata_json JSON NOT NULL DEFAULT '{}',
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS agent_tokens (
    id BIGINT PRIMARY KEY DEFAULT nextval('agent_tokens_id_seq'),
    agent_event_id BIGINT NOT NULL REFERENCES agent_events(id),
    input_tokens INTEGER,
    output_tokens INTEGER,
    cache_write_tokens INTEGER,
    cache_read_tokens INTEGER,
    reasoning_tokens INTEGER,
    cost_usd DOUBLE,
    pricing_source VARCHAR,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (agent_event_id)
);

CREATE INDEX IF NOT EXISTS idx_agent_raw_events_session_time
    ON agent_raw_events(agent_session_id, occurred_at);
CREATE INDEX IF NOT EXISTS idx_agent_events_session_time
    ON agent_events(agent_session_id, occurred_at);
CREATE INDEX IF NOT EXISTS idx_agent_events_parent
    ON agent_events(parent_agent_event_id);
CREATE INDEX IF NOT EXISTS idx_agent_parts_event
    ON agent_parts(agent_event_id, sequence);
CREATE INDEX IF NOT EXISTS idx_agent_tool_calls_event
    ON agent_tool_calls(agent_event_id);
CREATE INDEX IF NOT EXISTS idx_agent_tool_results_call
    ON agent_tool_results(agent_tool_call_id);
