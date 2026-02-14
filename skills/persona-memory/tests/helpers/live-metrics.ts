import { appendFileSync } from "fs";

export interface LiveMetricEntry {
  test: string;
  model: string;
  latency_ms: number;
  input_tokens: number;
  output_tokens: number;
  estimated_cost_usd: number;
  timestamp: string;
}

export function estimateCostUsd(inputTokens: number, outputTokens: number): number {
  const inputRate = Number.parseFloat(process.env.AI_MEMORY_LIVE_INPUT_USD_PER_MTOK || "1");
  const outputRate = Number.parseFloat(process.env.AI_MEMORY_LIVE_OUTPUT_USD_PER_MTOK || "5");
  const inputCost = (inputTokens / 1_000_000) * inputRate;
  const outputCost = (outputTokens / 1_000_000) * outputRate;
  return Number((inputCost + outputCost).toFixed(8));
}

export function writeLiveMetric(entry: LiveMetricEntry): void {
  const outputFile = process.env.AI_MEMORY_LIVE_REPORT_FILE;
  if (!outputFile) return;
  appendFileSync(outputFile, JSON.stringify(entry) + "\n", "utf-8");
}
