#!/usr/bin/env bun
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { dirname, join } from "path";

export type RowKind = "event" | "query";
export type Verdict = "good" | "bad";
export type QualityTier = "synthetic_seed" | "hand_labeled_high";

export interface EvalEventRow {
  id: string;
  type: "fact" | "preference" | "decision" | "thread" | "relationship";
  content: string;
  confidence: "confirmed" | "observed" | "inferred";
  source: string;
  project_key: string;
  expected_status: "promoted" | "duplicate" | "skipped";
  expected_block: string;
  quality: QualityTier;
  label_source?: string;
}

export interface EvalQueryRow {
  id: string;
  cwd: string;
  query: string;
  expected_contains: string[];
  quality: QualityTier;
  label_source?: string;
}

export interface GoldEventRow {
  type: string;
  content: string;
}

export interface EvalConfig {
  dataset: {
    name: string;
    sessions: number;
    events: number;
    queries: number;
  };
  thresholds: {
    extraction_f1_min: number;
    route_accuracy_min: number;
    dedupe_precision_min: number;
    recall_at_3_min: number;
    runtime_ms_max: number;
    fail_open_required: boolean;
  };
}

export interface EventCorrection {
  content: string;
  expected_status: "promoted" | "duplicate" | "skipped";
  expected_block: string;
}

export interface QueryCorrection {
  query: string;
  expected_contains: string[];
}

export interface EventRowPatch {
  type?: EvalEventRow["type"];
  content?: string;
  confidence?: EvalEventRow["confidence"];
  source?: string;
  project_key?: string;
  expected_status?: EvalEventRow["expected_status"];
  expected_block?: string;
}

export interface QueryRowPatch {
  cwd?: string;
  query?: string;
  expected_contains?: string[];
}

interface AnnotationBase {
  label_id: string;
  row_id: string;
  verdict: Verdict;
  rationale: string;
  annotator: string;
  created_at: string;
  quality_tier: "hand_labeled_high";
  score?: number;
}

export interface EventLabel extends AnnotationBase {
  row_kind: "event";
  correction?: EventCorrection;
}

export interface QueryLabel extends AnnotationBase {
  row_kind: "query";
  correction?: QueryCorrection;
}

export type LabelRecord = EventLabel | QueryLabel;

export interface LabelInput {
  row_kind: RowKind;
  row_id: string;
  verdict: Verdict;
  rationale: string;
  annotator?: string;
  score?: number;
  correction?: EventCorrection | QueryCorrection;
}

export interface BaseRowEditInput {
  row_kind: RowKind;
  row_id: string;
  patch: EventRowPatch | QueryRowPatch;
}

export interface EvalsetStats {
  base_rows: {
    events: number;
    queries: number;
    total: number;
  };
  labeled_good: {
    events: number;
    queries: number;
    total: number;
  };
  labeled_bad: {
    events: number;
    queries: number;
    total: number;
  };
  compiled_high_quality: {
    events: number;
    queries: number;
    total: number;
  };
  unlabeled: {
    events: number;
    queries: number;
    total: number;
  };
  scored: {
    events: number;
    queries: number;
    total: number;
  };
  score_avg: {
    events: number | null;
    queries: number | null;
    total: number | null;
  };
}

export interface CompileSummary {
  base: {
    events: number;
    queries: number;
  };
  compiled: {
    events: number;
    queries: number;
  };
  labels: {
    events_total: number;
    queries_total: number;
    events_latest: number;
    queries_latest: number;
  };
  high_quality: {
    events: number;
    queries: number;
  };
}

export interface EvalsetRowsResponse<T> {
  source: "base" | "compiled";
  kind: "events" | "queries";
  rows: Array<
    T & {
      curation_status: "unlabeled" | "good_hq" | "bad_replaced";
      latest_label: LabelRecord | null;
    }
  >;
}

interface EvalsetLayout {
  root: string;
  baseDir: string;
  compiledDir: string;
  annotationsDir: string;
  legacy: {
    config: string;
    events: string;
    queries: string;
    goldEvents: string;
    goldBlocks: string;
  };
  base: {
    config: string;
    events: string;
    queries: string;
    goldEvents: string;
    goldBlocks: string;
  };
  compiled: {
    config: string;
    events: string;
    queries: string;
    goldEvents: string;
    goldBlocks: string;
  };
  annotations: {
    events: string;
    queries: string;
  };
}

const skillDir = join(import.meta.dir, "..");

function getLayout(): EvalsetLayout {
  const evalRoot = process.env.AI_MEMORY_EVALSET_ROOT || join(skillDir, "tests", "fixtures", "eval");
  const baseDir = join(evalRoot, "base");
  const compiledDir = join(evalRoot, "compiled");
  const annotationsDir = join(evalRoot, "annotations");

  return {
    root: evalRoot,
    baseDir,
    compiledDir,
    annotationsDir,
    legacy: {
      config: join(evalRoot, "config.json"),
      events: join(evalRoot, "events.jsonl"),
      queries: join(evalRoot, "queries.jsonl"),
      goldEvents: join(evalRoot, "gold-events.jsonl"),
      goldBlocks: join(evalRoot, "gold-blocks.json"),
    },
    base: {
      config: join(baseDir, "config.json"),
      events: join(baseDir, "events.jsonl"),
      queries: join(baseDir, "queries.jsonl"),
      goldEvents: join(baseDir, "gold-events.jsonl"),
      goldBlocks: join(baseDir, "gold-blocks.json"),
    },
    compiled: {
      config: join(compiledDir, "config.json"),
      events: join(compiledDir, "events.jsonl"),
      queries: join(compiledDir, "queries.jsonl"),
      goldEvents: join(compiledDir, "gold-events.jsonl"),
      goldBlocks: join(compiledDir, "gold-blocks.json"),
    },
    annotations: {
      events: join(annotationsDir, "events.labels.jsonl"),
      queries: join(annotationsDir, "queries.labels.jsonl"),
    },
  };
}

function ensureDir(path: string): void {
  if (!existsSync(path)) mkdirSync(path, { recursive: true });
}

function ensureFile(path: string, contents: string): void {
  if (!existsSync(path)) {
    ensureDir(dirname(path));
    writeFileSync(path, contents, "utf-8");
  }
}

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf-8")) as T;
}

function writeJson(path: string, value: unknown): void {
  ensureDir(dirname(path));
  writeFileSync(path, JSON.stringify(value, null, 2) + "\n", "utf-8");
}

function readJsonl<T>(path: string): T[] {
  if (!existsSync(path)) return [];
  const raw = readFileSync(path, "utf-8").trim();
  if (!raw) return [];

  const rows: T[] = [];
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      rows.push(JSON.parse(trimmed) as T);
    } catch {
      // skip malformed rows in append-only logs
    }
  }
  return rows;
}

function writeJsonl(path: string, rows: unknown[]): void {
  ensureDir(dirname(path));
  const out = rows.map((row) => JSON.stringify(row)).join("\n");
  writeFileSync(path, out + (rows.length > 0 ? "\n" : ""), "utf-8");
}

function appendJsonl(path: string, row: unknown): void {
  ensureDir(dirname(path));
  appendFileSync(path, JSON.stringify(row) + "\n", "utf-8");
}

function pad(num: number, width: number): string {
  return String(num).padStart(width, "0");
}

function ensureUniqueIds<T extends { id: string }>(rows: T[], prefix: string): T[] {
  const seen = new Set<string>();
  return rows.map((row, idx) => {
    let id = row.id?.trim() || `${prefix}-${pad(idx + 1, 3)}`;
    while (seen.has(id)) {
      id = `${id}-${pad(idx + 1, 3)}`;
    }
    seen.add(id);
    return {
      ...row,
      id,
    };
  });
}

function normalizeEvents(rows: Array<Partial<EvalEventRow>>): EvalEventRow[] {
  const withDefaults = rows.map((row, idx) => ({
    id: String(row.id || `ev-${pad(idx + 1, 3)}`),
    type: (row.type || "fact") as EvalEventRow["type"],
    content: String(row.content || ""),
    confidence: (row.confidence || "confirmed") as EvalEventRow["confidence"],
    source: String(row.source || "synthetic"),
    project_key: String(row.project_key || "default"),
    expected_status: (row.expected_status || "promoted") as EvalEventRow["expected_status"],
    expected_block: String(row.expected_block || "user-profile"),
    quality: (row.quality || "synthetic_seed") as QualityTier,
    label_source: row.label_source ? String(row.label_source) : undefined,
  }));
  return ensureUniqueIds(withDefaults, "ev");
}

function normalizeQueries(rows: Array<Partial<EvalQueryRow>>): EvalQueryRow[] {
  const withDefaults = rows.map((row, idx) => ({
    id: String(row.id || `q-${pad(idx + 1, 3)}`),
    cwd: String(row.cwd || "/tmp"),
    query: String(row.query || ""),
    expected_contains: Array.isArray(row.expected_contains)
      ? row.expected_contains.map((item) => String(item)).filter((item) => item.trim().length > 0)
      : [],
    quality: (row.quality || "synthetic_seed") as QualityTier,
    label_source: row.label_source ? String(row.label_source) : undefined,
  }));
  return ensureUniqueIds(withDefaults, "q");
}

function migrateLegacyToBase(layout: EvalsetLayout): void {
  if (existsSync(layout.base.events) && existsSync(layout.base.queries) && existsSync(layout.base.config)) {
    return;
  }

  const hasLegacy = [
    layout.legacy.events,
    layout.legacy.queries,
    layout.legacy.config,
    layout.legacy.goldEvents,
    layout.legacy.goldBlocks,
  ].every((path) => existsSync(path));

  if (!hasLegacy) {
    throw new Error(
      "Evalset base fixtures missing and no legacy fixtures found. Expected tests/fixtures/eval/base or legacy files.",
    );
  }

  const legacyEvents = readJsonl<Partial<EvalEventRow>>(layout.legacy.events);
  const legacyQueries = readJsonl<Partial<EvalQueryRow>>(layout.legacy.queries);
  const legacyGoldEvents = readJsonl<GoldEventRow>(layout.legacy.goldEvents);
  const legacyGoldBlocks = readJson<Record<string, string[]>>(layout.legacy.goldBlocks);
  const legacyConfig = readJson<EvalConfig>(layout.legacy.config);

  writeJsonl(layout.base.events, normalizeEvents(legacyEvents));
  writeJsonl(layout.base.queries, normalizeQueries(legacyQueries));
  writeJsonl(layout.base.goldEvents, legacyGoldEvents);
  writeJson(layout.base.goldBlocks, legacyGoldBlocks);
  writeJson(layout.base.config, legacyConfig);
}

export function ensureEvalsetInitialized(): EvalsetLayout {
  const layout = getLayout();
  ensureDir(layout.root);
  ensureDir(layout.baseDir);
  ensureDir(layout.compiledDir);
  ensureDir(layout.annotationsDir);

  migrateLegacyToBase(layout);

  // normalize base rows in-place to guarantee IDs and quality markers.
  writeJsonl(layout.base.events, normalizeEvents(readJsonl<Partial<EvalEventRow>>(layout.base.events)));
  writeJsonl(layout.base.queries, normalizeQueries(readJsonl<Partial<EvalQueryRow>>(layout.base.queries)));

  ensureFile(layout.annotations.events, "");
  ensureFile(layout.annotations.queries, "");

  return layout;
}

function latestByRowId<T extends LabelRecord>(rows: T[]): Map<string, T> {
  const map = new Map<string, T>();
  for (const row of rows) {
    map.set(row.row_id, row);
  }
  return map;
}

function sanitizeText(input: string): string {
  return String(input || "").trim();
}

function validateScore(value: unknown): number | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const score = Number(value);
  if (!Number.isFinite(score) || !Number.isInteger(score)) {
    throw new Error("score must be an integer between 1 and 5");
  }
  if (score < 1 || score > 5) {
    throw new Error("score must be between 1 and 5");
  }
  return score;
}

function validateEventCorrection(value: unknown): EventCorrection {
  const correction = (value || {}) as Partial<EventCorrection>;
  const content = sanitizeText(String(correction.content || ""));
  const expectedBlock = sanitizeText(String(correction.expected_block || ""));
  const expectedStatus = correction.expected_status;

  if (!content) {
    throw new Error("event.bad requires correction.content");
  }
  if (!expectedBlock) {
    throw new Error("event.bad requires correction.expected_block");
  }
  if (expectedStatus !== "promoted" && expectedStatus !== "duplicate" && expectedStatus !== "skipped") {
    throw new Error("event.bad requires correction.expected_status in promoted|duplicate|skipped");
  }

  return {
    content,
    expected_block: expectedBlock,
    expected_status: expectedStatus,
  };
}

function validateQueryCorrection(value: unknown): QueryCorrection {
  const correction = (value || {}) as Partial<QueryCorrection>;
  const query = sanitizeText(String(correction.query || ""));
  const expectedContains = Array.isArray(correction.expected_contains)
    ? correction.expected_contains.map((item) => sanitizeText(String(item))).filter((item) => item.length > 0)
    : [];

  if (!query) {
    throw new Error("query.bad requires correction.query");
  }
  if (expectedContains.length === 0) {
    throw new Error("query.bad requires non-empty correction.expected_contains");
  }

  return {
    query,
    expected_contains: expectedContains,
  };
}

function toIsoNow(nowIso?: string): string {
  if (nowIso) return nowIso;
  return new Date().toISOString();
}

export function buildLabelRecord(input: LabelInput, nowIso?: string): LabelRecord {
  const rowKind = input.row_kind;
  const rowId = sanitizeText(input.row_id);
  const verdict = input.verdict;
  const rationale = sanitizeText(input.rationale);
  const score = validateScore(input.score);

  if (rowKind !== "event" && rowKind !== "query") {
    throw new Error("row_kind must be event or query");
  }
  if (!rowId) {
    throw new Error("row_id is required");
  }
  if (verdict !== "good" && verdict !== "bad") {
    throw new Error("verdict must be good or bad");
  }
  if (!rationale) {
    throw new Error("rationale is required");
  }

  const base = {
    label_id: `lbl-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    row_id: rowId,
    verdict,
    rationale,
    annotator: sanitizeText(input.annotator || "fairchild"),
    created_at: toIsoNow(nowIso),
    quality_tier: "hand_labeled_high" as const,
    score,
  };

  if (rowKind === "event") {
    const record: EventLabel = {
      ...base,
      row_kind: "event",
    };
    if (verdict === "bad") {
      record.correction = validateEventCorrection(input.correction);
    }
    return record;
  }

  const record: QueryLabel = {
    ...base,
    row_kind: "query",
  };
  if (verdict === "bad") {
    record.correction = validateQueryCorrection(input.correction);
  }
  return record;
}

function rowExists(layout: EvalsetLayout, kind: RowKind, rowId: string): boolean {
  if (kind === "event") {
    return normalizeEvents(readJsonl<Partial<EvalEventRow>>(layout.base.events)).some((row) => row.id === rowId);
  }
  return normalizeQueries(readJsonl<Partial<EvalQueryRow>>(layout.base.queries)).some((row) => row.id === rowId);
}

export function appendLabel(input: LabelInput): LabelRecord {
  const layout = ensureEvalsetInitialized();
  const record = buildLabelRecord(input);

  if (!rowExists(layout, input.row_kind, record.row_id)) {
    throw new Error(`Unknown row_id '${record.row_id}' for ${input.row_kind}`);
  }

  const target = input.row_kind === "event" ? layout.annotations.events : layout.annotations.queries;
  appendJsonl(target, record);
  return record;
}

function validateEventPatch(value: unknown): EventRowPatch {
  const patch = (value && typeof value === "object") ? (value as Record<string, unknown>) : {};
  const out: EventRowPatch = {};

  if (Object.prototype.hasOwnProperty.call(patch, "type")) {
    const type = String(patch.type || "");
    if (type !== "fact" && type !== "preference" && type !== "decision" && type !== "thread" && type !== "relationship") {
      throw new Error("event patch.type must be fact|preference|decision|thread|relationship");
    }
    out.type = type;
  }

  if (Object.prototype.hasOwnProperty.call(patch, "confidence")) {
    const confidence = String(patch.confidence || "");
    if (confidence !== "confirmed" && confidence !== "observed" && confidence !== "inferred") {
      throw new Error("event patch.confidence must be confirmed|observed|inferred");
    }
    out.confidence = confidence;
  }

  if (Object.prototype.hasOwnProperty.call(patch, "expected_status")) {
    const expectedStatus = String(patch.expected_status || "");
    if (expectedStatus !== "promoted" && expectedStatus !== "duplicate" && expectedStatus !== "skipped") {
      throw new Error("event patch.expected_status must be promoted|duplicate|skipped");
    }
    out.expected_status = expectedStatus;
  }

  if (Object.prototype.hasOwnProperty.call(patch, "content")) {
    const content = sanitizeText(String(patch.content || ""));
    if (!content) throw new Error("event patch.content cannot be empty");
    out.content = content;
  }

  if (Object.prototype.hasOwnProperty.call(patch, "source")) {
    const source = sanitizeText(String(patch.source || ""));
    if (!source) throw new Error("event patch.source cannot be empty");
    out.source = source;
  }

  if (Object.prototype.hasOwnProperty.call(patch, "project_key")) {
    const projectKey = sanitizeText(String(patch.project_key || ""));
    if (!projectKey) throw new Error("event patch.project_key cannot be empty");
    out.project_key = projectKey;
  }

  if (Object.prototype.hasOwnProperty.call(patch, "expected_block")) {
    const expectedBlock = sanitizeText(String(patch.expected_block || ""));
    if (!expectedBlock) throw new Error("event patch.expected_block cannot be empty");
    out.expected_block = expectedBlock;
  }

  if (Object.keys(out).length === 0) {
    throw new Error("event edit patch must include at least one editable field");
  }
  return out;
}

function validateQueryPatch(value: unknown): QueryRowPatch {
  const patch = (value && typeof value === "object") ? (value as Record<string, unknown>) : {};
  const out: QueryRowPatch = {};

  if (Object.prototype.hasOwnProperty.call(patch, "cwd")) {
    const cwd = sanitizeText(String(patch.cwd || ""));
    if (!cwd) throw new Error("query patch.cwd cannot be empty");
    out.cwd = cwd;
  }

  if (Object.prototype.hasOwnProperty.call(patch, "query")) {
    const query = sanitizeText(String(patch.query || ""));
    if (!query) throw new Error("query patch.query cannot be empty");
    out.query = query;
  }

  if (Object.prototype.hasOwnProperty.call(patch, "expected_contains")) {
    const expectedContainsRaw = patch.expected_contains;
    const expectedContains = Array.isArray(expectedContainsRaw)
      ? expectedContainsRaw.map((item) => sanitizeText(String(item))).filter((item) => item.length > 0)
      : [];
    if (expectedContains.length === 0) {
      throw new Error("query patch.expected_contains must be a non-empty array");
    }
    out.expected_contains = expectedContains;
  }

  if (Object.keys(out).length === 0) {
    throw new Error("query edit patch must include at least one editable field");
  }
  return out;
}

export function updateBaseRow(input: BaseRowEditInput): EvalEventRow | EvalQueryRow {
  const layout = ensureEvalsetInitialized();
  const rowKind = input.row_kind;
  const rowId = sanitizeText(input.row_id);

  if (rowKind !== "event" && rowKind !== "query") {
    throw new Error("row_kind must be event or query");
  }
  if (!rowId) {
    throw new Error("row_id is required");
  }

  if (rowKind === "event") {
    const rows = normalizeEvents(readJsonl<Partial<EvalEventRow>>(layout.base.events));
    const idx = rows.findIndex((row) => row.id === rowId);
    if (idx < 0) throw new Error(`Unknown row_id '${rowId}' for event`);
    const patch = validateEventPatch(input.patch);
    const updated: EvalEventRow = {
      ...rows[idx],
      ...patch,
      id: rows[idx].id,
    };
    rows[idx] = updated;
    writeJsonl(layout.base.events, rows);
    return updated;
  }

  const rows = normalizeQueries(readJsonl<Partial<EvalQueryRow>>(layout.base.queries));
  const idx = rows.findIndex((row) => row.id === rowId);
  if (idx < 0) throw new Error(`Unknown row_id '${rowId}' for query`);
  const patch = validateQueryPatch(input.patch);
  const updated: EvalQueryRow = {
    ...rows[idx],
    ...patch,
    id: rows[idx].id,
  };
  rows[idx] = updated;
  writeJsonl(layout.base.queries, rows);
  return updated;
}

function applyEventLabel(row: EvalEventRow, label: EventLabel): EvalEventRow {
  if (label.verdict === "good") {
    return {
      ...row,
      quality: "hand_labeled_high",
      label_source: label.label_id,
    };
  }

  const correction = label.correction;
  if (!correction) {
    throw new Error(`Missing correction for bad event label ${label.label_id}`);
  }

  return {
    ...row,
    content: correction.content,
    expected_status: correction.expected_status,
    expected_block: correction.expected_block,
    quality: "hand_labeled_high",
    label_source: label.label_id,
  };
}

function applyQueryLabel(row: EvalQueryRow, label: QueryLabel): EvalQueryRow {
  if (label.verdict === "good") {
    return {
      ...row,
      quality: "hand_labeled_high",
      label_source: label.label_id,
    };
  }

  const correction = label.correction;
  if (!correction) {
    throw new Error(`Missing correction for bad query label ${label.label_id}`);
  }

  return {
    ...row,
    query: correction.query,
    expected_contains: correction.expected_contains,
    quality: "hand_labeled_high",
    label_source: label.label_id,
  };
}

export function compileEvalset(): CompileSummary {
  const layout = ensureEvalsetInitialized();

  const baseEvents = normalizeEvents(readJsonl<Partial<EvalEventRow>>(layout.base.events));
  const baseQueries = normalizeQueries(readJsonl<Partial<EvalQueryRow>>(layout.base.queries));
  const baseConfig = readJson<EvalConfig>(layout.base.config);
  const baseGoldEvents = readJsonl<GoldEventRow>(layout.base.goldEvents);
  const baseGoldBlocks = readJson<Record<string, string[]>>(layout.base.goldBlocks);

  const eventLabels = readJsonl<EventLabel>(layout.annotations.events).filter((row) => row.row_kind === "event");
  const queryLabels = readJsonl<QueryLabel>(layout.annotations.queries).filter((row) => row.row_kind === "query");

  const latestEventLabels = latestByRowId(eventLabels);
  const latestQueryLabels = latestByRowId(queryLabels);

  const compiledEvents = baseEvents.map((row) => {
    const label = latestEventLabels.get(row.id);
    return label ? applyEventLabel(row, label) : row;
  });
  const compiledQueries = baseQueries.map((row) => {
    const label = latestQueryLabels.get(row.id);
    return label ? applyQueryLabel(row, label) : row;
  });

  writeJsonl(layout.compiled.events, compiledEvents);
  writeJsonl(layout.compiled.queries, compiledQueries);
  writeJsonl(layout.compiled.goldEvents, baseGoldEvents);
  writeJson(layout.compiled.goldBlocks, baseGoldBlocks);
  writeJson(layout.compiled.config, baseConfig);

  const highQualityEvents = compiledEvents.filter((row) => row.quality === "hand_labeled_high").length;
  const highQualityQueries = compiledQueries.filter((row) => row.quality === "hand_labeled_high").length;

  return {
    base: {
      events: baseEvents.length,
      queries: baseQueries.length,
    },
    compiled: {
      events: compiledEvents.length,
      queries: compiledQueries.length,
    },
    labels: {
      events_total: eventLabels.length,
      queries_total: queryLabels.length,
      events_latest: latestEventLabels.size,
      queries_latest: latestQueryLabels.size,
    },
    high_quality: {
      events: highQualityEvents,
      queries: highQualityQueries,
    },
  };
}

function asStatus(label: LabelRecord | undefined): "unlabeled" | "good_hq" | "bad_replaced" {
  if (!label) return "unlabeled";
  return label.verdict === "good" ? "good_hq" : "bad_replaced";
}

function loadLatestLabelMaps(layout: EvalsetLayout): {
  events: Map<string, EventLabel>;
  queries: Map<string, QueryLabel>;
} {
  const eventLabels = readJsonl<EventLabel>(layout.annotations.events).filter((row) => row.row_kind === "event");
  const queryLabels = readJsonl<QueryLabel>(layout.annotations.queries).filter((row) => row.row_kind === "query");

  return {
    events: latestByRowId(eventLabels),
    queries: latestByRowId(queryLabels),
  };
}

export function getEvalsetRows(source: "base" | "compiled", kind: "events" | "queries"): EvalsetRowsResponse<EvalEventRow | EvalQueryRow> {
  const layout = ensureEvalsetInitialized();
  if (
    source === "compiled" &&
    (!existsSync(layout.compiled.events) || !existsSync(layout.compiled.queries))
  ) {
    compileEvalset();
  }
  const latest = loadLatestLabelMaps(layout);

  const paths = source === "base" ? layout.base : layout.compiled;
  if (kind === "events") {
    const rows = normalizeEvents(readJsonl<Partial<EvalEventRow>>(paths.events)).map((row) => {
      const label = latest.events.get(row.id) || null;
      return {
        ...row,
        curation_status: asStatus(label || undefined),
        latest_label: label,
      };
    });

    return {
      source,
      kind,
      rows,
    };
  }

  const rows = normalizeQueries(readJsonl<Partial<EvalQueryRow>>(paths.queries)).map((row) => {
    const label = latest.queries.get(row.id) || null;
    return {
      ...row,
      curation_status: asStatus(label || undefined),
      latest_label: label,
    };
  });

  return {
    source,
    kind,
    rows,
  };
}

export function getEvalsetStats(): EvalsetStats {
  const layout = ensureEvalsetInitialized();
  const latest = loadLatestLabelMaps(layout);

  const baseEvents = normalizeEvents(readJsonl<Partial<EvalEventRow>>(layout.base.events));
  const baseQueries = normalizeQueries(readJsonl<Partial<EvalQueryRow>>(layout.base.queries));

  if (!existsSync(layout.compiled.events) || !existsSync(layout.compiled.queries)) {
    compileEvalset();
  }

  const compiledEvents = normalizeEvents(readJsonl<Partial<EvalEventRow>>(layout.compiled.events));
  const compiledQueries = normalizeQueries(readJsonl<Partial<EvalQueryRow>>(layout.compiled.queries));

  const labeledGoodEvents = Array.from(latest.events.values()).filter((label) => label.verdict === "good").length;
  const labeledBadEvents = Array.from(latest.events.values()).filter((label) => label.verdict === "bad").length;
  const labeledGoodQueries = Array.from(latest.queries.values()).filter((label) => label.verdict === "good").length;
  const labeledBadQueries = Array.from(latest.queries.values()).filter((label) => label.verdict === "bad").length;
  const scoredEventValues = Array.from(latest.events.values())
    .map((label) => (typeof label.score === "number" ? label.score : null))
    .filter((value): value is number => value !== null);
  const scoredQueryValues = Array.from(latest.queries.values())
    .map((label) => (typeof label.score === "number" ? label.score : null))
    .filter((value): value is number => value !== null);

  const highQualityEvents = compiledEvents.filter((row) => row.quality === "hand_labeled_high").length;
  const highQualityQueries = compiledQueries.filter((row) => row.quality === "hand_labeled_high").length;
  const scoreAvgEvents = scoredEventValues.length > 0
    ? scoredEventValues.reduce((sum, value) => sum + value, 0) / scoredEventValues.length
    : null;
  const scoreAvgQueries = scoredQueryValues.length > 0
    ? scoredQueryValues.reduce((sum, value) => sum + value, 0) / scoredQueryValues.length
    : null;
  const allScores = scoredEventValues.concat(scoredQueryValues);
  const scoreAvgTotal = allScores.length > 0
    ? allScores.reduce((sum, value) => sum + value, 0) / allScores.length
    : null;

  return {
    base_rows: {
      events: baseEvents.length,
      queries: baseQueries.length,
      total: baseEvents.length + baseQueries.length,
    },
    labeled_good: {
      events: labeledGoodEvents,
      queries: labeledGoodQueries,
      total: labeledGoodEvents + labeledGoodQueries,
    },
    labeled_bad: {
      events: labeledBadEvents,
      queries: labeledBadQueries,
      total: labeledBadEvents + labeledBadQueries,
    },
    compiled_high_quality: {
      events: highQualityEvents,
      queries: highQualityQueries,
      total: highQualityEvents + highQualityQueries,
    },
    unlabeled: {
      events: baseEvents.length - latest.events.size,
      queries: baseQueries.length - latest.queries.size,
      total: baseEvents.length + baseQueries.length - latest.events.size - latest.queries.size,
    },
    scored: {
      events: scoredEventValues.length,
      queries: scoredQueryValues.length,
      total: scoredEventValues.length + scoredQueryValues.length,
    },
    score_avg: {
      events: scoreAvgEvents,
      queries: scoreAvgQueries,
      total: scoreAvgTotal,
    },
  };
}

export function getEvalsetLayoutPaths(): Record<string, string> {
  const layout = getLayout();
  return {
    root: layout.root,
    base_dir: layout.baseDir,
    compiled_dir: layout.compiledDir,
    annotations_dir: layout.annotationsDir,
    base_events: layout.base.events,
    base_queries: layout.base.queries,
    compiled_events: layout.compiled.events,
    compiled_queries: layout.compiled.queries,
    labels_events: layout.annotations.events,
    labels_queries: layout.annotations.queries,
  };
}

export function getDefaultCompiledDatasetDir(): string {
  const layout = getLayout();
  return layout.compiledDir;
}
