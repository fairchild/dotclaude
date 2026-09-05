import { createServer } from 'node:http';
import { Readable } from 'node:stream';
import { readFileSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { checkedPath } from './core/files.ts';
import { handleRequest } from './http.ts';

/** Serve a trusted, prebuilt snapshot. Skill files are returned as bytes, never executed. */
export async function startServer(snapshot: string, host: string, port: number) {
  const root = realpathSync(join(snapshot, 'public'));
  JSON.parse(readFileSync(checkedPath(root, 'manifest.json'), 'utf8'));
  const assets = { async fetch(request: Request) {
    try {
      const rel = decodeURIComponent(new URL(request.url).pathname.slice(1));
      return new Response(readFileSync(checkedPath(root, rel)));
    } catch { return new Response('Not found', { status: 404 }); }
  } };
  const server = createServer(async (incoming, outgoing) => {
    try {
      // Fix the origin to this listener; an attacker-controlled Host cannot bypass Origin checks.
      const address = server.address();
      const boundPort = typeof address === 'object' && address ? address.port : port;
      const hostname = host.includes(':') ? `[${host}]` : host;
      const origin = `http://${hostname}:${boundPort}`;
      const url = new URL(incoming.url ?? '/', origin);
      if (url.origin !== origin) { outgoing.writeHead(400).end(); return; }
      const headers = new Headers();
      for (const [key, value] of Object.entries(incoming.headers)) {
        if (value !== undefined) headers.set(key, Array.isArray(value) ? value.join(', ') : value);
      }
      const method = incoming.method ?? 'GET';
      const init: RequestInit & { duplex?: string } = { method, headers };
      if (!['GET', 'HEAD'].includes(method)) { init.body = Readable.toWeb(incoming) as ReadableStream<Uint8Array>; init.duplex = 'half'; }
      const response = await handleRequest(new Request(url.href, init), { ASSETS: assets });
      outgoing.writeHead(response.status, Object.fromEntries(response.headers));
      if (response.body) Readable.fromWeb(response.body as import('node:stream/web').ReadableStream).pipe(outgoing);
      else outgoing.end();
    } catch { if (!outgoing.headersSent) outgoing.writeHead(500); outgoing.end('Request failed'); }
  });
  server.requestTimeout = 15_000;
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(port, host, () => { server.off('error', reject); resolve(); }); });
  return server;
}
