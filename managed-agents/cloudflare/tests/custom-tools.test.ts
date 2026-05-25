import { describe, expect, it } from "vitest";
import { customTools } from "../runtime/tools/custom-tools.ts";

describe("custom tools", () => {
  const echo = customTools.find((t) => t.name === "echo")!;
  const httpGet = customTools.find((t) => t.name === "http_get")!;

  it("registers echo and http_get", () => {
    expect(echo).toBeDefined();
    expect(httpGet).toBeDefined();
  });

  it("echo schema accepts a string message", () => {
    const parsed = echo.schema.parse({ message: "hi" });
    expect(parsed).toEqual({ message: "hi" });
  });

  it("echo rejects non-string message", () => {
    expect(() => echo.schema.parse({ message: 42 })).toThrow();
  });

  it("http_get schema requires a valid URL", () => {
    expect(() => httpGet.schema.parse({ url: "not a url" })).toThrow();
    const parsed = httpGet.schema.parse({ url: "https://example.com" });
    expect((parsed as { url: string }).url).toBe("https://example.com");
  });

  it("http_get caps max_bytes at 1MB", () => {
    expect(() => httpGet.schema.parse({ url: "https://example.com", max_bytes: 2_000_000 })).toThrow();
  });

  it("http_get defaults max_bytes to 100_000", () => {
    const parsed = httpGet.schema.parse({ url: "https://example.com" });
    expect((parsed as { max_bytes: number }).max_bytes).toBe(100_000);
  });
});
