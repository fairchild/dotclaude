import { describe, expect, test } from "bun:test";
import Anthropic from "@anthropic-ai/sdk";
import { estimateCostUsd, writeLiveMetric } from "../helpers/live-metrics.ts";

function extractJson(text: string): Record<string, unknown> {
  const trimmed = text.trim();
  const direct = (() => {
    try {
      return JSON.parse(trimmed) as Record<string, unknown>;
    } catch {
      return null;
    }
  })();
  if (direct) return direct;

  const match = trimmed.match(/\{[\s\S]*\}/);
  if (!match) throw new Error(`Could not parse JSON from response: ${trimmed}`);
  return JSON.parse(match[0]) as Record<string, unknown>;
}

const enabled = process.env.AI_MEMORY_TEST_LIVE === "1";
const provider = process.env.AI_MEMORY_TEST_PROVIDER || "anthropic";
const apiKey = process.env.ANTHROPIC_API_KEY || "";
const model = process.env.AI_MEMORY_TEST_MODEL || "claude-3-5-haiku-latest";
const shouldRun = enabled && provider === "anthropic" && apiKey.length > 0;

describe("live anthropic consolidate smoke", () => {
  (shouldRun ? test : test.skip)("validates consolidation schema", async () => {
    const client = new Anthropic({ apiKey });
    const started = Date.now();

    const response = await client.messages.create({
      model,
      max_tokens: 240,
      temperature: 0,
      messages: [
        {
          role: "user",
          content:
            'Return only JSON: {"canonical":"...","duplicates":["..."],"decision":"promote"}. Inputs: 1) Use deterministic harness as PR gate. 2) Use deterministic test harness for PR gating.',
        },
      ],
    });

    const latencyMs = Date.now() - started;
    const text = response.content.find((item) => item.type === "text");
    expect(text?.type).toBe("text");
    if (!text || text.type !== "text") throw new Error("No text response from Anthropic");

    const parsed = extractJson(text.text);
    expect(typeof parsed.canonical).toBe("string");
    expect(Array.isArray(parsed.duplicates)).toBe(true);
    expect(parsed.decision === "promote" || parsed.decision === "skip").toBe(true);

    const inputTokens = response.usage.input_tokens;
    const outputTokens = response.usage.output_tokens;
    writeLiveMetric({
      test: "anthropic.consolidate.smoke",
      model,
      latency_ms: latencyMs,
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      estimated_cost_usd: estimateCostUsd(inputTokens, outputTokens),
      timestamp: new Date().toISOString(),
    });
  });
});
