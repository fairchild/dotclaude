/** Raw 2026-07-28 requests, as an HTTP client puts them on the wire. */
export const MODERN = "2026-07-28";

export const envelope = (client = "conformance") => ({
  "io.modelcontextprotocol/protocolVersion": MODERN,
  "io.modelcontextprotocol/clientInfo": { name: client, version: "0.0.0" },
  "io.modelcontextprotocol/clientCapabilities": {},
});

/** The headers a 2026-07-28 request carries: the revision, the method, and the name it targets. */
export function modernHeaders(method: string, params: Record<string, unknown> = {}): Record<string, string> {
  return {
    "Content-Type": "application/json",
    Accept: "application/json",
    "MCP-Protocol-Version": MODERN,
    "Mcp-Method": method,
    ...(method === "resources/read" && typeof params.uri === "string" ? { "Mcp-Name": params.uri } : {}),
  };
}

export function modernBody(id: number, method: string, params: Record<string, unknown> = {}, meta: object | null = envelope()): string {
  return JSON.stringify({ jsonrpc: "2.0", id, method, params: meta ? { ...params, _meta: meta } : params });
}

export function modernRequest(url: string, id: number, method: string, params: Record<string, unknown> = {}, headers: Record<string, string> = {}): Request {
  return new Request(url, {
    method: "POST",
    headers: { ...modernHeaders(method, params), ...headers },
    body: modernBody(id, method, params),
  });
}
