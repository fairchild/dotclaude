#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.11"
# dependencies = []
# ///
"""Generate a deterministic, aggregate-only AI coding usage report."""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import tempfile
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any


SCHEMA_VERSION = "analyze-usage-report/v1"
UTC = timezone.utc


def parse_instant(value: str) -> datetime:
    normalized = value[:-1] + "+00:00" if value.endswith("Z") else value
    try:
        parsed = datetime.fromisoformat(normalized)
    except ValueError as exc:
        raise argparse.ArgumentTypeError(f"invalid ISO-8601 timestamp: {value}") from exc
    if parsed.tzinfo is None:
        raise argparse.ArgumentTypeError(f"timestamp must include a UTC offset: {value}")
    return parsed.astimezone(UTC)


def iso_z(value: datetime) -> str:
    return value.astimezone(UTC).isoformat(timespec="microseconds").replace("+00:00", "Z")


def sql_timestamp(value: datetime) -> str:
    return value.astimezone(UTC).replace(tzinfo=None).isoformat(sep=" ", timespec="microseconds")


class Ledger:
    def __init__(self, db_path: Path) -> None:
        self.db_path = db_path

    def query(self, sql: str) -> list[dict[str, Any]]:
        result = subprocess.run(
            ["duckdb", "-json", str(self.db_path), "-c", sql],
            capture_output=True,
            text=True,
            timeout=60,
        )
        if result.returncode != 0:
            raise RuntimeError(result.stderr.strip() or "DuckDB query failed")
        return json.loads(result.stdout or "[]")

    def one(self, sql: str) -> dict[str, Any]:
        rows = self.query(sql)
        if len(rows) != 1:
            raise RuntimeError(f"expected one row, received {len(rows)}")
        return rows[0]


def window_clause(start: datetime, end: datetime, *, column: str = "timestamp") -> str:
    return (
        f"{column} >= TIMESTAMP '{sql_timestamp(start)}' "
        f"AND {column} < TIMESTAMP '{sql_timestamp(end)}'"
    )


def coverage(ledger: Ledger) -> tuple[datetime, datetime]:
    row = ledger.one(
        """
        SELECT MIN(timestamp) AS first_observation, MAX(timestamp) AS last_observation
        FROM (
            SELECT timestamp FROM messages WHERE timestamp IS NOT NULL
            UNION ALL
            SELECT timestamp FROM provider_usage_with_cost WHERE timestamp IS NOT NULL
        ) observations;
        """
    )
    if row["first_observation"] is None or row["last_observation"] is None:
        raise RuntimeError("the usage database contains no timestamped observations")
    first = parse_instant(row["first_observation"] + "Z")
    last = parse_instant(row["last_observation"] + "Z")
    return first, last


TOKEN_SUMS = """
    COALESCE(SUM(uncached_input_tokens), 0)::BIGINT AS uncachedInput,
    COALESCE(SUM(cached_input_tokens), 0)::BIGINT AS cachedInput,
    COALESCE(SUM(cache_write_tokens), 0)::BIGINT AS cacheWriteInput,
    COALESCE(SUM(output_tokens), 0)::BIGINT AS output,
    COALESCE(SUM(reasoning_output_tokens), 0)::BIGINT AS reasoningOutput,
    COALESCE(SUM(
        uncached_input_tokens + cached_input_tokens + cache_write_tokens + output_tokens
    ), 0)::BIGINT AS reportedTotal
"""

COST_SUMS = """
    ROUND(COALESCE(SUM(input_cost_usd), 0), 6) AS inputCostUsd,
    ROUND(COALESCE(SUM(cached_input_cost_usd), 0), 6) AS cachedInputCostUsd,
    ROUND(COALESCE(SUM(cache_write_cost_usd), 0), 6) AS cacheWriteCostUsd,
    ROUND(COALESCE(SUM(output_cost_usd), 0), 6) AS outputCostUsd,
    ROUND(COALESCE(SUM(cost_usd), 0), 6) AS apiEquivalent,
    ROUND(COALESCE(SUM(cost_without_cache_usd), 0), 6) AS noCacheBaseline,
    ROUND(COALESCE(SUM(cache_savings_usd), 0), 6) AS cacheImpact
"""


def grouped_ledger(
    ledger: Ledger,
    where: str,
    dimensions: str,
    order_by: str,
    *,
    group_by: str | None = None,
) -> list[dict[str, Any]]:
    return ledger.query(
        f"""
        SELECT
            {dimensions},
            COUNT(*)::BIGINT AS usageRows,
            COUNT(*) FILTER (WHERE pricing_status = 'priced')::BIGINT AS pricedRows,
            COUNT(*) FILTER (WHERE pricing_status <> 'priced')::BIGINT AS unpricedRows,
            COUNT(DISTINCT session_id)::BIGINT AS sessions,
            {TOKEN_SUMS},
            {COST_SUMS}
        FROM provider_usage_with_cost
        WHERE {where}
        GROUP BY {group_by or dimensions}
        ORDER BY {order_by};
        """
    )


def generate_report(
    ledger: Ledger,
    *,
    start: datetime | None,
    end: datetime | None,
    generated_at: datetime,
) -> dict[str, Any]:
    archive_first, archive_last = coverage(ledger)
    report_start = start or archive_first
    report_end = end or (archive_last + timedelta(microseconds=1))
    if report_start >= report_end:
        raise ValueError("report start must be before report end")

    message_where = window_clause(report_start, report_end)
    usage_where = window_clause(report_start, report_end)

    harnesses = ledger.query(
        f"""
        WITH harness_names(harness, tokenAccounting) AS (
            VALUES
                ('claude_code', 'recorded'),
                ('codex', 'recorded'),
                ('cursor', 'not_available')
        ), archive_activity AS (
            SELECT
                harness,
                COUNT(DISTINCT session_id)::BIGINT AS sessions,
                COUNT(*)::BIGINT AS messages,
                COUNT(DISTINCT CAST(timestamp AS DATE))::BIGINT AS activeDays,
                MIN(timestamp) AS firstObservation,
                MAX(timestamp) AS lastObservation
            FROM messages
            GROUP BY harness
        ), window_activity AS (
            SELECT
                harness,
                COUNT(DISTINCT session_id)::BIGINT AS sessions,
                COUNT(*)::BIGINT AS messages,
                COUNT(DISTINCT CAST(timestamp AS DATE))::BIGINT AS activeDays,
                MIN(timestamp) AS firstObservation,
                MAX(timestamp) AS lastObservation
            FROM messages
            WHERE {message_where}
            GROUP BY harness
        ), archive_usage AS (
            SELECT harness, COUNT(*)::BIGINT AS tokenRows
            FROM provider_usage_with_cost
            GROUP BY harness
        ), window_usage AS (
            SELECT harness, COUNT(*)::BIGINT AS tokenRows
            FROM provider_usage_with_cost
            WHERE {usage_where}
            GROUP BY harness
        )
        SELECT
            names.harness,
            names.tokenAccounting,
            COALESCE(archive_activity.sessions, 0)::BIGINT AS archiveSessionsWithMessages,
            COALESCE(archive_activity.messages, 0)::BIGINT AS archiveMessages,
            COALESCE(archive_activity.activeDays, 0)::BIGINT AS archiveActiveDays,
            COALESCE(archive_usage.tokenRows, 0)::BIGINT AS archiveTokenRows,
            archive_activity.firstObservation AS archiveFirstObservation,
            archive_activity.lastObservation AS archiveLastObservation,
            COALESCE(window_activity.sessions, 0)::BIGINT AS windowSessionsWithMessages,
            COALESCE(window_activity.messages, 0)::BIGINT AS windowMessages,
            COALESCE(window_activity.activeDays, 0)::BIGINT AS windowActiveDays,
            COALESCE(window_usage.tokenRows, 0)::BIGINT AS windowTokenRows,
            window_activity.firstObservation AS windowFirstObservation,
            window_activity.lastObservation AS windowLastObservation
        FROM harness_names names
        LEFT JOIN archive_activity USING (harness)
        LEFT JOIN window_activity USING (harness)
        LEFT JOIN archive_usage USING (harness)
        LEFT JOIN window_usage USING (harness)
        ORDER BY names.harness;
        """
    )
    for row in harnesses:
        for key in (
            "archiveFirstObservation",
            "archiveLastObservation",
            "windowFirstObservation",
            "windowLastObservation",
        ):
            if row[key] is not None:
                row[key] = iso_z(parse_instant(row[key] + "Z"))
        row["archiveCoverage"] = {
            "sessionsWithMessages": row.pop("archiveSessionsWithMessages"),
            "messages": row.pop("archiveMessages"),
            "activeDays": row.pop("archiveActiveDays"),
            "tokenRows": row.pop("archiveTokenRows"),
            "firstObservation": row.pop("archiveFirstObservation"),
            "lastObservation": row.pop("archiveLastObservation"),
        }
        row["reportWindow"] = {
            "sessionsWithMessages": row.pop("windowSessionsWithMessages"),
            "messages": row.pop("windowMessages"),
            "activeDays": row.pop("windowActiveDays"),
            "tokenRows": row.pop("windowTokenRows"),
            "firstObservation": row.pop("windowFirstObservation"),
            "lastObservation": row.pop("windowLastObservation"),
        }

    activity_totals = ledger.one(
        f"""
        SELECT
            COUNT(DISTINCT harness || ':' || session_id)::BIGINT AS sessionsWithMessages,
            COUNT(*)::BIGINT AS messages,
            COUNT(DISTINCT CAST(timestamp AS DATE))::BIGINT AS activeDays
        FROM messages
        WHERE {message_where};
        """
    )
    token_cost_totals = ledger.one(
        f"""
        SELECT
            {TOKEN_SUMS},
            {COST_SUMS},
            COUNT(*)::BIGINT AS usageRows,
            COUNT(*) FILTER (WHERE pricing_status = 'priced')::BIGINT AS pricedRows,
            COUNT(*) FILTER (WHERE pricing_status <> 'priced')::BIGINT AS unpricedRows,
            COALESCE(SUM(
                uncached_input_tokens + cached_input_tokens + cache_write_tokens + output_tokens
            ) FILTER (WHERE pricing_status = 'priced'), 0)::BIGINT AS pricedTokens,
            COALESCE(SUM(
                uncached_input_tokens + cached_input_tokens + cache_write_tokens + output_tokens
            ) FILTER (WHERE pricing_status <> 'priced'), 0)::BIGINT AS unpricedTokens
        FROM provider_usage_with_cost
        WHERE {usage_where};
        """
    )

    unknown_models = ledger.query(
        f"""
        SELECT provider, harness, model, COUNT(*)::BIGINT AS usageRows
        FROM provider_usage_with_cost
        WHERE {usage_where} AND pricing_status <> 'priced'
        GROUP BY provider, harness, model
        ORDER BY provider, harness, model;
        """
    )

    total_input = (
        token_cost_totals["uncachedInput"]
        + token_cost_totals["cachedInput"]
        + token_cost_totals["cacheWriteInput"]
    )
    cached_input = token_cost_totals["cachedInput"]
    baseline = token_cost_totals["noCacheBaseline"]
    cache_impact = token_cost_totals["cacheImpact"]

    totals = {
        "activity": activity_totals,
        "tokens": {key: token_cost_totals[key] for key in (
            "uncachedInput", "cachedInput", "cacheWriteInput", "output",
            "reasoningOutput", "reportedTotal",
        )},
        "costUsd": {
            "input": token_cost_totals["inputCostUsd"],
            "cachedInput": token_cost_totals["cachedInputCostUsd"],
            "cacheWrite": token_cost_totals["cacheWriteCostUsd"],
            "output": token_cost_totals["outputCostUsd"],
            "apiEquivalent": token_cost_totals["apiEquivalent"],
            "noCacheBaseline": token_cost_totals["noCacheBaseline"],
            "cacheImpact": token_cost_totals["cacheImpact"],
        },
        "cache": {
            "utilizationPct": round(100 * cached_input / total_input, 2) if total_input else None,
            "costReductionPct": round(100 * cache_impact / baseline, 2) if baseline else None,
        },
    }

    return {
        "schemaVersion": SCHEMA_VERSION,
        "generatedAt": iso_z(generated_at),
        "coverage": {
            "archive": {
                "firstObservation": iso_z(archive_first),
                "lastObservation": iso_z(archive_last),
            },
            "reportWindow": {
                "startInclusive": iso_z(report_start),
                "endExclusive": iso_z(report_end),
                "durationDays": round((report_end - report_start).total_seconds() / 86400, 6),
            },
        },
        "harnesses": harnesses,
        "totals": totals,
        "providers": grouped_ledger(ledger, usage_where, "provider, harness", "provider, harness"),
        "models": grouped_ledger(
            ledger,
            usage_where,
            "provider, harness, model, pricing_status AS pricingStatus",
            "provider, harness, model, pricingStatus",
            group_by="provider, harness, model, pricing_status",
        ),
        "repositories": grouped_ledger(
            ledger,
            usage_where,
            "provider, harness, COALESCE(repo_name, 'Unattributed') AS repository",
            "provider, harness, repository",
            group_by="provider, harness, COALESCE(repo_name, 'Unattributed')",
        ),
        "pricingCoverage": {
            "usageRows": token_cost_totals["usageRows"],
            "pricedRows": token_cost_totals["pricedRows"],
            "unpricedRows": token_cost_totals["unpricedRows"],
            "pricedTokens": token_cost_totals["pricedTokens"],
            "unpricedTokens": token_cost_totals["unpricedTokens"],
            "unknownModels": unknown_models,
        },
        "semantics": {
            "privacy": (
                "Aggregate-only output; prompts, responses, reasoning, tool arguments, "
                "paths, and session identifiers are excluded."
            ),
            "cost": (
                "API-equivalent estimate from recorded token fields and the ledger pricing "
                "tables; not an invoice or subscription spend."
            ),
            "pricingCoverage": (
                "Dollar totals include priced rows only. Inspect pricingCoverage before "
                "describing them as comprehensive."
            ),
            "reasoningTokens": (
                "reasoningOutput is a subset of output and is never added to reportedTotal."
            ),
            "cursorTokens": (
                "Cursor activity is included, but token and cost accounting is unavailable "
                "from the ingested Cursor source."
            ),
            "window": "All report metrics use startInclusive <= timestamp < endExclusive in UTC.",
            "activity": (
                "sessionsWithMessages counts distinct normalized message session "
                "identifiers, not every harness session record."
            ),
        },
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--db",
        type=Path,
        default=Path(
            os.environ.get(
                "ANALYZE_USAGE_DB",
                "~/.local/share/analyze-usage/usage.duckdb",
            )
        ).expanduser(),
        help="usage DuckDB path (default: ANALYZE_USAGE_DB or the standard data path)",
    )
    parser.add_argument(
        "--from",
        dest="start",
        type=parse_instant,
        help="inclusive UTC report boundary",
    )
    parser.add_argument(
        "--to",
        dest="end",
        type=parse_instant,
        help="exclusive UTC report boundary",
    )
    parser.add_argument("--generated-at", type=parse_instant, help=argparse.SUPPRESS)
    parser.add_argument("--output", type=Path, help="write JSON to this path instead of stdout")
    return parser.parse_args()


def main() -> int:
    os.umask(0o077)
    args = parse_args()
    if not args.db.is_file():
        print(f"error: usage database not found: {args.db}", file=sys.stderr)
        return 2
    try:
        report = generate_report(
            Ledger(args.db),
            start=args.start,
            end=args.end,
            generated_at=args.generated_at or datetime.now(UTC),
        )
    except (RuntimeError, ValueError) as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1

    rendered = json.dumps(report, indent=2, sort_keys=False) + "\n"
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        temporary_path: Path | None = None
        try:
            with tempfile.NamedTemporaryFile(
                mode="w",
                dir=args.output.parent,
                prefix=f".{args.output.name}.",
                delete=False,
            ) as temporary:
                temporary.write(rendered)
                temporary_path = Path(temporary.name)
            os.replace(temporary_path, args.output)
        finally:
            if temporary_path is not None and temporary_path.exists():
                temporary_path.unlink()
    else:
        sys.stdout.write(rendered)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
