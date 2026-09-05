#!/usr/bin/env bun
import { parseArgs } from "node:util";
import { join } from "node:path";
import { buildSnapshot } from "./snapshot.ts";
const { values } = parseArgs({ options: {
  root: { type: "string", default: join(import.meta.dir, "../../skills") },
  out: { type: "string", default: join(import.meta.dir, "dist") },
  "base-url": { type: "string", default: "https://skills.cloudcompute.com" },
} });
buildSnapshot({ root: values.root!, out: values.out!, baseUrl: values["base-url"]!, sourceSha: process.env.GITHUB_SHA });
