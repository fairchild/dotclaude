#!/usr/bin/env bun
/**
 * Simple static file server for the Claude Config Visualizer
 */

const PORT = process.env.PORT || 3000;

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html",
  ".css": "text/css",
  ".js": "application/javascript",
  ".json": "application/json",
  ".png": "image/png",
  ".svg": "image/svg+xml",
};

Bun.serve({
  port: Number(PORT),
  async fetch(req) {
    const url = new URL(req.url);
    let path = url.pathname;

    // Default to index.html
    if (path === "/") path = "/index.html";

    const filePath = import.meta.dir + path;
    const file = Bun.file(filePath);

    if (!(await file.exists())) {
      return new Response("Not Found", { status: 404 });
    }

    const ext = path.substring(path.lastIndexOf("."));
    const contentType = MIME_TYPES[ext] || "application/octet-stream";

    return new Response(file, {
      headers: { "Content-Type": contentType },
    });
  },
});

console.log(`\n  Claude Config Visualizer`);
console.log(`  http://localhost:${PORT}\n`);
