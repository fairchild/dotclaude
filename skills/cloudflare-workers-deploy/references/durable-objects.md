# Durable Objects

For stateful applications: sessions, scheduled tasks, real-time features.

## wrangler.jsonc Config

Add to both top-level and each environment:

```jsonc
{
  "durable_objects": {
    "bindings": [
      { "name": "MY_DO", "class_name": "MyDurableObject" }
    ]
  },
  "migrations": [
    { "tag": "v1-sqlite", "new_sqlite_classes": ["MyDurableObject"] }
  ],
  "env": {
    "preview": {
      "durable_objects": {
        "bindings": [
          { "name": "MY_DO", "class_name": "MyDurableObject" }
        ]
      }
    },
    "production": {
      "durable_objects": {
        "bindings": [
          { "name": "MY_DO", "class_name": "MyDurableObject" }
        ]
      }
    }
  }
}
```

Note: `durable_objects` is NOT inherited by environments - must be in each env.

## Durable Object Class

```typescript
import { DurableObject } from "cloudflare:workers";
import type { Env } from "../env";

export class MyDurableObject extends DurableObject<Env> {
  private sql: SqlStorage;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.initSchema();
  }

  private initSchema(): void {
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS items (
        id TEXT PRIMARY KEY,
        data TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
    `);
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === "/items") {
      const items = this.sql.exec("SELECT * FROM items").toArray();
      return Response.json(items);
    }

    if (request.method === "POST" && url.pathname === "/items") {
      const data = await request.json();
      this.sql.exec(
        "INSERT INTO items (id, data, created_at) VALUES (?, ?, ?)",
        crypto.randomUUID(), JSON.stringify(data), Date.now()
      );
      return new Response("OK");
    }

    return new Response("Not found", { status: 404 });
  }
}
```

## Using DO from Routes

```typescript
// Get DO instance by name
const id = c.env.MY_DO.idFromName("singleton"); // or per-user ID
const stub = c.env.MY_DO.get(id);

// Call DO methods via fetch
const response = await stub.fetch(new Request("https://do/items", {
  method: "POST",
  body: JSON.stringify({ foo: "bar" })
}));
```

## Alarms (Scheduled Tasks)

Use DO alarms instead of `setInterval` - Workers can't maintain background processes.

```typescript
export class SchedulerDO extends DurableObject<Env> {
  async fetch(request: Request): Promise<Response> {
    if (request.method === "POST") {
      const { runAt } = await request.json();
      await this.ctx.storage.setAlarm(runAt); // epoch ms
      return new Response("Scheduled");
    }
    return new Response("OK");
  }

  async alarm(): Promise<void> {
    // Called at scheduled time
    console.log("Alarm fired!");

    // Do work here...

    // Reschedule if recurring
    const nextRun = Date.now() + 60000; // 1 minute
    await this.ctx.storage.setAlarm(nextRun);
  }
}
```

## env.d.ts with DO

```typescript
import type { MyDurableObject } from "./durable/MyDurableObject";

export interface Env {
  ENVIRONMENT: string;
  ASSETS: Fetcher;
  MY_DO: DurableObjectNamespace<MyDurableObject>;
}
```

## Export from Entry Point

```typescript
// workers/index.ts
import { MyDurableObject } from "./durable/MyDurableObject";

// ... app setup ...

export { MyDurableObject };
export default app;
```
