import { describe, test, expect } from "bun:test";
import { parseExtractionJson } from "./extract-lib.ts";

const extractionJson = {
  summary: "Investigated chronicle extraction failures.",
  goal: "Diagnose why auto-extracted blocks fall back.",
  accomplished: ["Added debug logging"],
  challenges: [],
  pending: [],
  nextSteps: ["Run a real SessionEnd hook with CHRONICLE_DEBUG=1"],
};

describe("parseExtractionJson", () => {
  test("parses plain JSON", () => {
    expect(parseExtractionJson(JSON.stringify(extractionJson))).toEqual(extractionJson);
  });

  test("parses fenced JSON with language tag", () => {
    const response = `\`\`\`json
${JSON.stringify(extractionJson)}
\`\`\``;
    expect(parseExtractionJson(response)).toEqual(extractionJson);
  });

  test("parses JSON embedded in surrounding text", () => {
    const response = `Here is the extracted block:
${JSON.stringify(extractionJson)}
Done.`;
    expect(parseExtractionJson(response)).toEqual(extractionJson);
  });
});
