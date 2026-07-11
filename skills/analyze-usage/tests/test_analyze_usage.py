#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.11"
# dependencies = []
# ///
"""Regression tests for analyze-usage.

Usage:
  uv run skills/analyze-usage/tests/test_analyze_usage.py
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

TESTS: list[tuple[str, bool, str]] = []
SCRIPT_PATH = Path(__file__).resolve().parent.parent / "scripts" / "analyze-usage"


def test(name: str):
    def decorator(fn):
        def wrapper() -> None:
            try:
                fn()
                TESTS.append((name, True, ""))
            except Exception as exc:  # pragma: no cover - harness output only
                TESTS.append((name, False, str(exc)))

        return wrapper

    return decorator


def run(cmd: list[str], *, env: dict[str, str], cwd: Path | None = None) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        cmd,
        cwd=str(cwd) if cwd else None,
        env=env,
        capture_output=True,
        text=True,
        timeout=60,
    )


def duckdb_query(db_path: Path, sql: str) -> list[str]:
    result = subprocess.run(
        ["duckdb", "-csv", "-noheader", str(db_path), "-c", sql],
        capture_output=True,
        text=True,
        timeout=30,
        check=True,
    )
    return [line for line in result.stdout.strip().splitlines() if line]


def make_env(home: Path, db_path: Path) -> dict[str, str]:
    env = os.environ.copy()
    env["ANALYZE_USAGE_DB"] = str(db_path)
    env["CLAUDE_PROJECTS_DIR"] = str(home / ".claude" / "projects")
    env["CODEX_HOME"] = str(home / ".codex")
    env["CURSOR_USER_DIR"] = str(home / ".cursor-user")
    env["XDG_DATA_HOME"] = str(home / ".local" / "share")
    return env


def copy_standalone_script(target_dir: Path) -> Path:
    script_copy = target_dir / "analyze-usage"
    shutil.copy2(SCRIPT_PATH, script_copy)
    script_copy.chmod(0o755)
    return script_copy


def install_schema(home: Path) -> Path:
    schema_source = Path(__file__).resolve().parent.parent / "references" / "canonical-agent-schema.duckdb.sql"
    schema_target = home / ".local" / "share" / "analyze-usage" / "canonical-agent-schema.duckdb.sql"
    schema_target.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(schema_source, schema_target)
    return schema_target


def write_fixture(home: Path, *, cwd: str | None = None) -> Path:
    claude_dir = home / ".claude" / "projects" / "demo"
    claude_dir.mkdir(parents=True, exist_ok=True)
    session_file = claude_dir / "session.jsonl"
    cwd = cwd or "/Users/fairchild/conductor/workspaces/services/demo"
    entries = [
        {
            "uuid": "u1",
            "parentUuid": None,
            "sessionId": "s1",
            "type": "user",
            "timestamp": "2026-04-19T00:00:00Z",
            "cwd": cwd,
            "entrypoint": "cli",
            "isSidechain": False,
            "message": {"content": "hello"},
        },
        {
            "uuid": "a1",
            "parentUuid": "u1",
            "sessionId": "s1",
            "type": "assistant",
            "timestamp": "2026-04-19T00:00:01Z",
            "cwd": cwd,
            "entrypoint": "cli",
            "isSidechain": False,
            "message": {
                "model": "claude-sonnet-4-5-20250929",
                "usage": {
                    "input_tokens": 10,
                    "output_tokens": 5,
                    "cache_creation_input_tokens": 0,
                    "cache_read_input_tokens": 0,
                },
                "content": [
                    {"type": "text", "text": "hi"},
                    {"type": "tool_use", "name": "Bash", "input": {"command": "pwd"}},
                ],
            },
        },
        {
            "uuid": "sys1",
            "sessionId": "s1",
            "type": "system",
            "subtype": "turn_duration",
            "timestamp": "2026-04-19T00:00:02Z",
            "cwd": cwd,
            "gitBranch": "main",
            "durationMs": 123,
            "version": "1.0.0",
            "isSidechain": False,
        },
        {
            "sessionId": "s1",
            "type": "queue-operation",
            "timestamp": "2026-04-19T00:00:03Z",
            "operation": "enqueue",
            "content": "later",
        },
        {
            "sessionId": "s1",
            "type": "pr-link",
            "timestamp": "2026-04-19T00:00:04Z",
            "prNumber": 42,
            "prUrl": "https://example.com/pr/42",
            "prRepository": "fairchild/demo",
        },
    ]
    session_file.write_text("".join(json.dumps(entry) + "\n" for entry in entries))
    return session_file


def write_codex_fixture(
    home: Path,
    *,
    cwd: str | None = None,
    session_id: str = "019e6296-7f0f-7090-8572-a48ddfa5d34a",
    model: str = "gpt-5.5",
    token_usage: dict[str, int] | None = None,
) -> tuple[str, Path]:
    codex_home = home / ".codex"
    session_dir = codex_home / "sessions" / "2026" / "05" / "26"
    session_dir.mkdir(parents=True, exist_ok=True)
    session_file = session_dir / f"rollout-2026-05-26T00-00-00-{session_id}.jsonl"
    cwd = cwd or "/Users/fairchild/.worktrees/dotclaude/codex-import"
    token_usage = token_usage or {
        "input_tokens": 10,
        "cached_input_tokens": 2,
        "output_tokens": 5,
        "reasoning_output_tokens": 1,
        "total_tokens": 15,
    }
    entries = [
        {
            "timestamp": "2026-05-26T00:00:00.000Z",
            "type": "session_meta",
            "payload": {
                "id": session_id,
                "timestamp": "2026-05-26T00:00:00.000Z",
                "cwd": cwd,
                "source": "cli",
                "originator": "codex_cli_rs",
                "cli_version": "1.0.0",
                "model_provider": "openai",
                "git": {
                    "branch": "feature/codex",
                    "commit_hash": "abc123",
                    "repository_url": "https://github.com/fairchild/dotclaude.git",
                },
            },
        },
        {
            "timestamp": "2026-05-26T00:00:01.000Z",
            "type": "turn_context",
            "payload": {
                "cwd": cwd,
                "model": model,
                "effort": "medium",
            },
        },
        {
            "timestamp": "2026-05-26T00:00:02.000Z",
            "type": "response_item",
            "payload": {
                "type": "message",
                "role": "developer",
                "content": [{"type": "input_text", "text": "developer policy"}],
            },
        },
        {
            "timestamp": "2026-05-26T00:00:03.000Z",
            "type": "response_item",
            "payload": {
                "type": "message",
                "role": "user",
                "content": [{"type": "input_text", "text": "show status"}],
            },
        },
        {
            "timestamp": "2026-05-26T00:00:04.000Z",
            "type": "response_item",
            "payload": {
                "type": "function_call",
                "name": "exec_command",
                "arguments": json.dumps({"cmd": "pwd", "workdir": cwd}),
            },
        },
        {
            "timestamp": "2026-05-26T00:00:05.000Z",
            "type": "response_item",
            "payload": {
                "type": "message",
                "role": "assistant",
                "content": [{"type": "output_text", "text": "working tree clean"}],
            },
        },
        {
            "timestamp": "2026-05-26T00:00:06.000Z",
            "type": "event_msg",
            "payload": {
                "type": "token_count",
                "info": {
                    "last_token_usage": token_usage,
                    "model_context_window": 258400,
                },
            },
        },
    ]
    session_file.write_text("".join(json.dumps(entry) + "\n" for entry in entries))
    with (codex_home / "session_index.jsonl").open("a") as index_file:
        index_file.write(
            json.dumps(
                {
                    "id": session_id,
                    "thread_name": "fixture thread",
                    "updated_at": "2026-05-26T00:00:07.000Z",
                }
            )
            + "\n"
        )
    return session_id, session_file


def create_legacy_db(db_path: Path) -> None:
    sql = """
CREATE TABLE claude_tools (
    timestamp TIMESTAMP,
    session_id VARCHAR,
    project_dir VARCHAR,
    model VARCHAR,
    tool_name VARCHAR,
    context VARCHAR,
    input_tokens INTEGER,
    output_tokens INTEGER,
    cache_write_tokens INTEGER,
    cache_read_tokens INTEGER,
    repo_name VARCHAR,
    worktree_branch VARCHAR,
    is_worktree BOOLEAN,
    source_file VARCHAR
);
CREATE TABLE messages (
    uuid VARCHAR,
    parent_uuid VARCHAR,
    session_id VARCHAR,
    role VARCHAR,
    harness VARCHAR,
    model VARCHAR,
    content VARCHAR,
    thinking VARCHAR,
    timestamp TIMESTAMP,
    project_dir VARCHAR,
    git_branch VARCHAR,
    repo_name VARCHAR,
    worktree_branch VARCHAR,
    is_worktree BOOLEAN,
    is_sidechain BOOLEAN,
    input_tokens INTEGER,
    output_tokens INTEGER,
    cache_write_tokens INTEGER,
    cache_read_tokens INTEGER,
    tool_use_count INTEGER,
    source_file VARCHAR
);
CREATE TABLE _loaded_files (
    file_path VARCHAR PRIMARY KEY,
    mtime_ns BIGINT,
    loaded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
"""
    subprocess.run(["duckdb", str(db_path)], input=sql, text=True, check=True, timeout=30)


def assert_ok(result: subprocess.CompletedProcess[str]) -> None:
    if result.returncode != 0:
        raise AssertionError(f"command failed: {' '.join(result.args)}\nSTDOUT:\n{result.stdout}\nSTDERR:\n{result.stderr}")


@test("reload bootstraps canonical schema")
def test_reload_bootstraps_schema() -> None:
    with tempfile.TemporaryDirectory() as tmp:
        home = Path(tmp) / "home"
        home.mkdir()
        session_file = write_fixture(home)
        db_path = Path(tmp) / "usage.duckdb"
        env = make_env(home, db_path)

        result = run([str(SCRIPT_PATH), "reload"], env=env)
        assert_ok(result)

        tables = duckdb_query(
            db_path,
            "SELECT table_name FROM information_schema.tables "
            "WHERE table_schema='main' AND table_name LIKE 'agent_%' ORDER BY table_name;",
        )
        assert tables == [
            "agent_contexts",
            "agent_events",
            "agent_parts",
            "agent_raw_events",
            "agent_sessions",
            "agent_tokens",
            "agent_tool_calls",
            "agent_tool_results",
        ], tables

        interface_source = duckdb_query(
            db_path,
            "SELECT interface, source_file FROM claude_tools LIMIT 1;",
        )
        assert interface_source == [f"conductor,{session_file}"], interface_source

        message_rows = duckdb_query(
            db_path,
            "SELECT role, interface, tool_use_count FROM messages "
            "WHERE harness='claude_code' ORDER BY timestamp;",
        )
        assert message_rows == ["user,conductor,0", "assistant,conductor,1"], message_rows

        schema_output = run([str(SCRIPT_PATH), "--schema"], env=env)
        assert_ok(schema_output)
        assert "CANONICAL REFERENCE TABLES" in schema_output.stdout
        assert "agent_sessions" in schema_output.stdout
        assert "updated_at" in schema_output.stdout


@test("standalone installed script boots from installed schema file")
def test_standalone_script_bootstraps_schema() -> None:
    with tempfile.TemporaryDirectory() as tmp:
        home = Path(tmp) / "home"
        home.mkdir()
        write_fixture(home)
        installed_schema = install_schema(home)
        db_path = Path(tmp) / "usage.duckdb"
        bin_dir = Path(tmp) / "bin"
        bin_dir.mkdir()
        standalone_script = copy_standalone_script(bin_dir)
        env = make_env(home, db_path)

        result = run([str(standalone_script), "reload"], env=env)
        assert_ok(result)

        tables = duckdb_query(
            db_path,
            "SELECT table_name FROM information_schema.tables "
            "WHERE table_schema='main' AND table_name LIKE 'agent_%' ORDER BY table_name;",
        )
        assert tables == [
            "agent_contexts",
            "agent_events",
            "agent_parts",
            "agent_raw_events",
            "agent_sessions",
            "agent_tokens",
            "agent_tool_calls",
            "agent_tool_results",
        ], tables
        assert installed_schema.exists()


@test("reload imports Codex transcripts")
def test_reload_imports_codex_transcripts() -> None:
    with tempfile.TemporaryDirectory() as tmp:
        home = Path(tmp) / "home"
        home.mkdir()
        session_id, _session_file = write_codex_fixture(home)
        db_path = Path(tmp) / "usage.duckdb"
        env = make_env(home, db_path)

        result = run([str(SCRIPT_PATH), "reload"], env=env)
        assert_ok(result)

        codex_tools = duckdb_query(
            db_path,
            "SELECT tool_name, context, repo_name, worktree_branch FROM codex_tools;",
        )
        assert codex_tools == ["exec_command,pwd,dotclaude,codex-import"], codex_tools

        codex_messages = duckdb_query(
            db_path,
            "SELECT role, harness, interface, repo_name FROM messages "
            "WHERE harness='codex' ORDER BY role;",
        )
        assert codex_messages == [
            "assistant,codex,NULL,dotclaude",
            "user,codex,NULL,dotclaude",
        ], codex_messages

        codex_metadata = duckdb_query(
            db_path,
            "SELECT thread_name, git_branch, tool_count FROM codex_sessions;",
        )
        assert codex_metadata == ["fixture thread,feature/codex,1"], codex_metadata

        token_counts = duckdb_query(
            db_path,
            "SELECT input_tokens, cached_input_tokens, output_tokens, total_tokens "
            "FROM codex_token_counts;",
        )
        assert token_counts == ["10,2,5,15"], token_counts

        developer_messages = duckdb_query(
            db_path,
            "SELECT content FROM codex_developer_messages;",
        )
        assert developer_messages == ["developer policy"], developer_messages

        overview = duckdb_query(
            db_path,
            f"SELECT summary, git_branch FROM session_overview WHERE session_id='{session_id}';",
        )
        assert overview == ["fixture thread,feature/codex"], overview


@test("update imports Codex transcripts without Claude logs")
def test_update_imports_codex_without_claude_logs() -> None:
    with tempfile.TemporaryDirectory() as tmp:
        home = Path(tmp) / "home"
        home.mkdir()
        write_codex_fixture(home)
        db_path = Path(tmp) / "usage.duckdb"
        env = make_env(home, db_path)

        result = run([str(SCRIPT_PATH), "update"], env=env)
        assert_ok(result)
        assert "Binder Error" not in result.stderr, result.stderr

        codex_counts = duckdb_query(
            db_path,
            "SELECT COUNT(*), COUNT(DISTINCT session_id) FROM codex_tools;",
        )
        assert codex_counts == ["1,1"], codex_counts

        loaded_files = duckdb_query(
            db_path,
            "SELECT COUNT(*) FROM _loaded_files WHERE file_path LIKE '%.codex/%';",
        )
        assert loaded_files == ["2"], loaded_files


@test("update upgrades legacy table order safely")
def test_update_legacy_db_upgrade() -> None:
    with tempfile.TemporaryDirectory() as tmp:
        home = Path(tmp) / "home"
        home.mkdir()
        session_file = write_fixture(home)
        db_path = Path(tmp) / "legacy.duckdb"
        create_legacy_db(db_path)
        env = make_env(home, db_path)

        result = run([str(SCRIPT_PATH), "update"], env=env)
        assert_ok(result)

        interface_source = duckdb_query(
            db_path,
            "SELECT interface, source_file FROM claude_tools LIMIT 1;",
        )
        assert interface_source == [f"conductor,{session_file}"], interface_source

        model_rows = duckdb_query(
            db_path,
            "SELECT interface, model, source_file FROM messages "
            "WHERE harness='claude_code' ORDER BY timestamp;",
        )
        assert model_rows == [
            f"conductor,NULL,{session_file}",
            f"conductor,claude-sonnet-4-5-20250929,{session_file}",
        ], model_rows

        canonical_count = duckdb_query(
            db_path,
            "SELECT COUNT(*) FROM information_schema.tables "
            "WHERE table_schema='main' AND table_name LIKE 'agent_%';",
        )
        assert canonical_count == ["8"], canonical_count


@test("update migrates legacy db even when tracked files are unchanged")
def test_update_legacy_db_no_change_migration() -> None:
    with tempfile.TemporaryDirectory() as tmp:
        home = Path(tmp) / "home"
        home.mkdir()
        session_file = write_fixture(home)
        db_path = Path(tmp) / "legacy-current.duckdb"
        create_legacy_db(db_path)
        env = make_env(home, db_path)

        mtime_ns = session_file.stat().st_mtime_ns
        subprocess.run(
            [
                "duckdb",
                str(db_path),
                "-c",
                (
                    "INSERT INTO _loaded_files (file_path, mtime_ns) "
                    f"VALUES ('{session_file}', {mtime_ns});"
                ),
            ],
            text=True,
            check=True,
            timeout=30,
        )

        result = run([str(SCRIPT_PATH), "update"], env=env)
        assert_ok(result)

        columns = duckdb_query(
            db_path,
            "SELECT column_name FROM information_schema.columns "
            "WHERE table_name='claude_tools' ORDER BY ordinal_position;",
        )
        assert "interface" in columns, columns

        interface_source = duckdb_query(
            db_path,
            "SELECT interface, source_file FROM claude_tools LIMIT 1;",
        )
        assert interface_source == [f"conductor,{session_file}"], interface_source


@test("incremental update removes deleted source rows")
def test_update_removes_deleted_sources() -> None:
    with tempfile.TemporaryDirectory() as tmp:
        home = Path(tmp) / "home"
        home.mkdir()
        session_file = write_fixture(home)
        db_path = Path(tmp) / "usage.duckdb"
        env = make_env(home, db_path)

        assert_ok(run([str(SCRIPT_PATH), "reload"], env=env))
        session_file.unlink()
        result = run([str(SCRIPT_PATH), "update"], env=env)
        assert_ok(result)

        assert duckdb_query(
            db_path,
            "SELECT COUNT(*) FROM messages WHERE harness='claude_code';",
        ) == ["0"]
        assert duckdb_query(db_path, "SELECT COUNT(*) FROM _loaded_files;") == ["0"]


@test("incremental update detects same-second same-size content changes")
def test_update_detects_nanosecond_mtime_changes() -> None:
    with tempfile.TemporaryDirectory() as tmp:
        home = Path(tmp) / "home"
        home.mkdir()
        session_file = write_fixture(home)
        db_path = Path(tmp) / "usage.duckdb"
        env = make_env(home, db_path)

        assert_ok(run([str(SCRIPT_PATH), "reload"], env=env))
        original_stat = session_file.stat()
        session_file.write_text(session_file.read_text().replace("hello", "jello"))
        original_second = (original_stat.st_mtime_ns // 1_000_000_000) * 1_000_000_000
        changed_ns = original_second + ((original_stat.st_mtime_ns + 1) % 1_000_000_000)
        os.utime(session_file, ns=(original_stat.st_atime_ns, changed_ns))

        result = run([str(SCRIPT_PATH), "update"], env=env)
        assert_ok(result)
        content = duckdb_query(
            db_path,
            "SELECT content FROM messages WHERE harness='claude_code' AND role='user';",
        )
        assert content == ["jello"], content


@test("paths and searches safely handle commas and apostrophes")
def test_special_character_paths_and_search() -> None:
    with tempfile.TemporaryDirectory(prefix="analyze,'usage-") as tmp:
        home = Path(tmp) / "home"
        home.mkdir()
        session_file = write_fixture(home)
        entries = [json.loads(line) for line in session_file.read_text().splitlines()]
        entries[0]["message"]["content"] = "don't panic"
        duplicate_uuid = entries[0].copy()
        duplicate_uuid["sessionId"] = "duplicate-uuid-session"
        duplicate_uuid["timestamp"] = "2026-04-19T00:00:05Z"
        duplicate_uuid["message"] = {"content": "don't duplicate IDs"}
        entries.append(duplicate_uuid)
        session_file.write_text("".join(json.dumps(entry) + "\n" for entry in entries))
        db_path = Path(tmp) / "usage.duckdb"
        env = make_env(home, db_path)

        assert_ok(run([str(SCRIPT_PATH), "reload"], env=env))

        literal = run([str(SCRIPT_PATH), "search", "don't"], env=env)
        assert_ok(literal)
        assert "don't panic" in literal.stdout, literal.stdout

        fts = run([str(SCRIPT_PATH), "search", "don't", "--fts"], env=env)
        assert_ok(fts)
        assert "don't panic" in fts.stdout, fts.stdout


@test("incremental failures propagate and preserve the database")
def test_update_failure_is_atomic() -> None:
    with tempfile.TemporaryDirectory() as tmp:
        home = Path(tmp) / "home"
        home.mkdir()
        session_file = write_fixture(home)
        db_path = Path(tmp) / "usage.duckdb"
        env = make_env(home, db_path)
        assert_ok(run([str(SCRIPT_PATH), "reload"], env=env))

        invalid_schema = Path(tmp) / "invalid-schema.sql"
        invalid_schema.write_text("THIS IS NOT SQL;")
        failed_env = env.copy()
        failed_env["ANALYZE_USAGE_SCHEMA"] = str(invalid_schema)
        session_file.write_text(session_file.read_text().replace("hello", "changed"))

        result = run([str(SCRIPT_PATH), "update"], env=failed_env)
        assert result.returncode != 0, result.stdout
        assert "Incremental update complete" not in result.stdout
        assert duckdb_query(
            db_path,
            "SELECT content FROM messages WHERE harness='claude_code' AND role='user';",
        ) == ["hello"]


@test("cost accounting charges each assistant turn once")
def test_turn_level_cost_accounting() -> None:
    with tempfile.TemporaryDirectory() as tmp:
        home = Path(tmp) / "home"
        home.mkdir()
        session_file = write_fixture(home)
        entries = [json.loads(line) for line in session_file.read_text().splitlines()]
        assistant = next(entry for entry in entries if entry.get("type") == "assistant")
        assistant["message"]["content"].append(
            {
                "type": "tool_use",
                "name": "Read",
                "input": {"file_path": "/tmp/demo"},
            }
        )
        duplicate_turn = json.loads(json.dumps(assistant))
        duplicate_turn["message"]["content"] = [
            {"type": "text", "text": "duplicate transcript copy"}
        ]
        entries.append(duplicate_turn)
        session_file.write_text("".join(json.dumps(entry) + "\n" for entry in entries))
        db_path = Path(tmp) / "usage.duckdb"
        env = make_env(home, db_path)

        assert_ok(run([str(SCRIPT_PATH), "reload"], env=env))
        assert duckdb_query(db_path, "SELECT COUNT(*) FROM claude_tools;") == ["2"]
        usage = duckdb_query(
            db_path,
            "SELECT COUNT(*), SUM(input_tokens), SUM(output_tokens), "
            "SUM(cost_usd) FROM usage_with_cost;",
        )
        assert usage == ["1,10,5,0.000105"], usage


@test("pricing is current, unknown-safe, and editable")
def test_model_pricing_semantics() -> None:
    with tempfile.TemporaryDirectory() as tmp:
        home = Path(tmp) / "home"
        home.mkdir()
        session_file = write_fixture(home)
        db_path = Path(tmp) / "usage.duckdb"
        env = make_env(home, db_path)

        assert_ok(run([str(SCRIPT_PATH), "reload"], env=env))
        rates = duckdb_query(
            db_path,
            "SELECT model, CAST(input_rate AS DOUBLE), CAST(output_rate AS DOUBLE) "
            "FROM model_pricing WHERE model IN "
            "('claude-fable-5', 'claude-opus-4-5-20251101', "
            "'claude-haiku-4-5-20251001') "
            "ORDER BY model;",
        )
        assert rates == [
            "claude-fable-5,10.0,50.0",
            "claude-haiku-4-5-20251001,1.0,5.0",
            "claude-opus-4-5-20251101,5.0,25.0",
        ], rates

        subprocess.run(
            [
                "duckdb",
                str(db_path),
                "-c",
                "UPDATE model_pricing SET input_rate=99 "
                "WHERE model='claude-sonnet-4-5-20250929';",
            ],
            check=True,
            timeout=30,
        )
        session_file.write_text(session_file.read_text().replace("hello", "updated"))
        assert_ok(run([str(SCRIPT_PATH), "update"], env=env))
        assert duckdb_query(
            db_path,
            "SELECT CAST(input_rate AS DOUBLE) FROM model_pricing "
            "WHERE model='claude-sonnet-4-5-20250929';",
        ) == ["99.0"]

        entries = [json.loads(line) for line in session_file.read_text().splitlines()]
        assistant = next(entry for entry in entries if entry.get("type") == "assistant")
        assistant["message"]["model"] = "claude-future-unknown"
        session_file.write_text("".join(json.dumps(entry) + "\n" for entry in entries))
        assert_ok(run([str(SCRIPT_PATH), "update"], env=env))
        unknown = duckdb_query(
            db_path,
            "SELECT pricing_status, cost_usd IS NULL FROM usage_with_cost;",
        )
        assert unknown == ["unknown_model,true"], unknown


@test("provider cost views price tokens and quantify cache savings")
def test_provider_cost_and_cache_semantics() -> None:
    with tempfile.TemporaryDirectory() as tmp:
        home = Path(tmp) / "home"
        home.mkdir()
        write_fixture(home)
        write_codex_fixture(home)
        write_codex_fixture(
            home,
            session_id="019e6296-7f0f-7090-8572-a48ddfa5d34b",
            model="gpt-5.6-sol",
            token_usage={
                "input_tokens": 300_000,
                "cached_input_tokens": 200_000,
                "output_tokens": 1_000,
                "reasoning_output_tokens": 400,
                "total_tokens": 301_000,
            },
        )
        db_path = Path(tmp) / "usage.duckdb"
        env = make_env(home, db_path)

        assert_ok(run([str(SCRIPT_PATH), "reload"], env=env))

        codex_costs = duckdb_query(
            db_path,
            "SELECT model, uncached_input_tokens, cached_input_tokens, "
            "output_tokens, is_long_context, cost_usd, "
            "cost_without_cache_usd, cache_savings_usd "
            "FROM codex_usage_with_cost ORDER BY model;",
        )
        assert codex_costs == [
            "gpt-5.5,8,2,5,false,0.000191,0.0002,9e-06",
            "gpt-5.6-sol,100000,200000,1000,true,1.245,3.045,1.8",
        ], codex_costs

        provider_rows = duckdb_query(
            db_path,
            "SELECT provider, harness, model, pricing_status, cost_usd "
            "FROM provider_usage_with_cost ORDER BY provider, model;",
        )
        assert provider_rows == [
            "anthropic,claude_code,claude-sonnet-4-5-20250929,priced,0.000105",
            "openai,codex,gpt-5.5,priced,0.000191",
            "openai,codex,gpt-5.6-sol,priced,1.245",
        ], provider_rows

        cache_rows = duckdb_query(
            db_path,
            "SELECT provider, model, cache_utilization_pct, "
            "cost_reduction_pct FROM cache_efficiency_summary "
            "ORDER BY provider, model;",
        )
        assert cache_rows == [
            "anthropic,claude-sonnet-4-5-20250929,0.0,0.0",
            "openai,gpt-5.5,20.0,4.5",
            "openai,gpt-5.6-sol,66.67,59.11",
        ], cache_rows


@test("Codex-managed worktrees use repository and branch metadata")
def test_codex_managed_worktree_attribution() -> None:
    with tempfile.TemporaryDirectory() as tmp:
        home = Path(tmp) / "home"
        home.mkdir()
        write_codex_fixture(
            home,
            cwd="/Users/fairchild/.codex/worktrees/abc123/dotclaude",
        )
        db_path = Path(tmp) / "usage.duckdb"
        env = make_env(home, db_path)

        assert_ok(run([str(SCRIPT_PATH), "reload"], env=env))
        attribution = duckdb_query(
            db_path,
            "SELECT repo_name, worktree_branch, is_worktree FROM codex_tools;",
        )
        assert attribution == ["dotclaude,feature/codex,true"], attribution


@test("calendar views use the system local timezone")
def test_calendar_views_use_local_timezone() -> None:
    with tempfile.TemporaryDirectory() as tmp:
        home = Path(tmp) / "home"
        home.mkdir()
        write_fixture(home)
        db_path = Path(tmp) / "usage.duckdb"
        env = make_env(home, db_path)
        env["TZ"] = "America/Los_Angeles"

        assert_ok(run([str(SCRIPT_PATH), "reload"], env=env))
        assert duckdb_query(
            db_path,
            "SELECT hour_of_day FROM peak_hours WHERE source='claude_code';",
        ) == ["17"]
        assert duckdb_query(
            db_path,
            "SELECT date FROM daily_summary WHERE claude_tools > 0;",
        ) == ["2026-04-18"]


@test("incremental update accepts sparse Claude files")
def test_incremental_sparse_claude_file() -> None:
    with tempfile.TemporaryDirectory() as tmp:
        home = Path(tmp) / "home"
        home.mkdir()
        write_fixture(home)
        db_path = Path(tmp) / "usage.duckdb"
        env = make_env(home, db_path)
        assert_ok(run([str(SCRIPT_PATH), "reload"], env=env))

        sparse_dir = home / ".claude" / "projects" / "sparse"
        sparse_dir.mkdir()
        sparse_file = sparse_dir / "sparse.jsonl"
        sparse_entries = [
            {
                "uuid": "sparse-user",
                "parentUuid": None,
                "sessionId": "sparse-session",
                "type": "user",
                "timestamp": "2026-07-11T12:00:00Z",
                "cwd": "/Users/fairchild/code/sparse",
                "entrypoint": "cli",
                "isSidechain": False,
                "message": {"content": "sparse input"},
            },
            {
                "uuid": "sparse-assistant",
                "parentUuid": "sparse-user",
                "sessionId": "sparse-session",
                "type": "assistant",
                "timestamp": "2026-07-11T12:00:01Z",
                "cwd": "/Users/fairchild/code/sparse",
                "entrypoint": "cli",
                "isSidechain": False,
                "message": {
                    "model": "claude-sonnet-5",
                    "usage": {"input_tokens": 2, "output_tokens": 1},
                    "content": [{"type": "text", "text": "done"}],
                },
            },
        ]
        sparse_file.write_text(
            "".join(json.dumps(entry) + "\n" for entry in sparse_entries)
        )

        result = run([str(SCRIPT_PATH), "update"], env=env)
        assert_ok(result)
        assert duckdb_query(
            db_path,
            "SELECT COUNT(*) FROM messages WHERE session_id='sparse-session';",
        ) == ["2"]
        assert duckdb_query(db_path, "SELECT COUNT(*) FROM pr_links;") == ["1"]


@test("repository attribution rejects arbitrary directory names")
def test_repository_attribution_provenance() -> None:
    with tempfile.TemporaryDirectory() as tmp:
        home = Path(tmp) / "home"
        home.mkdir()
        write_fixture(home, cwd="/private/tmp/files-mentioned/627")
        write_codex_fixture(home, cwd="/private/tmp/files-mentioned/627")
        db_path = Path(tmp) / "usage.duckdb"
        env = make_env(home, db_path)

        assert_ok(run([str(SCRIPT_PATH), "reload"], env=env))
        assert duckdb_query(
            db_path,
            "SELECT BOOL_AND(repo_name IS NULL) FROM messages "
            "WHERE harness='claude_code';",
        ) == ["true"]
        assert duckdb_query(
            db_path,
            "SELECT DISTINCT repo_name FROM messages WHERE harness='codex';",
        ) == ["dotclaude"]


@test("Codex incremental updates preserve unaffected sessions")
def test_codex_incremental_session_scope() -> None:
    with tempfile.TemporaryDirectory() as tmp:
        home = Path(tmp) / "home"
        home.mkdir()
        first_id = "019e6296-7f0f-7090-8572-a48ddfa5d34a"
        second_id = "019e6296-7f0f-7090-8572-a48ddfa5d34b"
        _, first_file = write_codex_fixture(home, session_id=first_id)
        write_codex_fixture(home, session_id=second_id)
        db_path = Path(tmp) / "usage.duckdb"
        env = make_env(home, db_path)
        assert_ok(run([str(SCRIPT_PATH), "reload"], env=env))
        assert duckdb_query(db_path, "SELECT COUNT(*) FROM codex_tools;") == ["2"]

        first_file.write_text(first_file.read_text().replace("pwd", "git status"))
        assert_ok(run([str(SCRIPT_PATH), "update"], env=env))
        assert duckdb_query(
            db_path,
            "SELECT COUNT(*), COUNT(DISTINCT session_id) FROM codex_tools;",
        ) == ["2,2"]
        assert duckdb_query(
            db_path,
            f"SELECT context FROM codex_tools WHERE session_id='{first_id}';",
        ) == ["git status"]

        first_file.unlink()
        assert_ok(run([str(SCRIPT_PATH), "update"], env=env))
        assert duckdb_query(
            db_path,
            "SELECT COUNT(*), MIN(session_id) FROM codex_tools;",
        ) == [f"1,{second_id}"]


def main() -> None:
    tests = [
        test_reload_bootstraps_schema,
        test_standalone_script_bootstraps_schema,
        test_reload_imports_codex_transcripts,
        test_update_imports_codex_without_claude_logs,
        test_update_legacy_db_upgrade,
        test_update_legacy_db_no_change_migration,
        test_update_removes_deleted_sources,
        test_update_detects_nanosecond_mtime_changes,
        test_special_character_paths_and_search,
        test_update_failure_is_atomic,
        test_turn_level_cost_accounting,
        test_model_pricing_semantics,
        test_provider_cost_and_cache_semantics,
        test_codex_managed_worktree_attribution,
        test_calendar_views_use_local_timezone,
        test_incremental_sparse_claude_file,
        test_repository_attribution_provenance,
        test_codex_incremental_session_scope,
    ]
    for fn in tests:
        fn()

    passed = sum(1 for _, ok, _ in TESTS if ok)
    failed = sum(1 for _, ok, _ in TESTS if not ok)
    print(f"\n=== analyze-usage tests: {passed} passed, {failed} failed ===\n")
    for name, ok, err in TESTS:
        status = "PASS" if ok else "FAIL"
        line = f"  {status}  {name}"
        if err:
            line += f"  ({err})"
        print(line)

    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
