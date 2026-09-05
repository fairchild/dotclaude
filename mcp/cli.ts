#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createSkillsServer } from './index.ts';
import { FsStore } from './fs.ts';
import { buildSnapshot } from './http.ts';
import { startServer } from './node-server.ts';
import { version } from './version.ts';

try {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: {
    help: { type: 'boolean' }, version: { type: 'boolean' }, root: { type: 'string' },
    out: { type: 'string' }, 'base-url': { type: 'string' }, snapshot: { type: 'string' },
    host: { type: 'string', default: '127.0.0.1' }, port: { type: 'string', default: '3000' },
  } });
  if (values.version) console.log(version);
  else if (values.help) console.log(`skill-server ${version}\nstdio --root <skills>\nbuild --root <skills> --out <output> --base-url <origin>\nserve --snapshot <output> [--host 127.0.0.1] [--port 3000]`);
  else {
    const required = (name: 'root' | 'out' | 'base-url' | 'snapshot') => {
      const value = values[name];
      if (!value) throw new Error(`--${name} is required`);
      return value;
    };
    if (positionals.length !== 1) throw new Error('Choose stdio, build, or serve; see --help');
    switch (positionals[0]) {
      case 'stdio': {
        const server = createSkillsServer(new FsStore(required('root')), { name: 'skill-server', version });
        await server.connect(new StdioServerTransport());
        for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => { void server.close().then(() => process.exit(0)); });
        break;
      }
      case 'build': buildSnapshot({ root: required('root'), out: required('out'), baseUrl: required('base-url'), sourceSha: process.env.GITHUB_SHA }); break;
      case 'serve': {
        const port = Number(values.port);
        if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('Invalid port');
        const server = await startServer(required('snapshot'), values.host!, port);
        console.error(`Listening on ${JSON.stringify(server.address())}`);
        for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => { server.close(); server.closeAllConnections(); });
        break;
      }
      default: throw new Error('Unknown command; see --help');
    }
  }
} catch (error) { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; }
