# Vendored schema

`ext-skills-beta.schema.json` is `schema/beta/schema.json` from
[modelcontextprotocol/ext-skills](https://github.com/modelcontextprotocol/ext-skills)
at commit `c0705f9071caa539eeb2c9f5f2f77ac16b048ca6`, copied byte for byte
(sha256 `75895cdbf0044e8286212326122b0daf731b99904b99972e449836777b7dbc57`).
It is the JSON Schema (2020-12) for the Skills extension on protocol revision
2026-07-28, licensed Apache-2.0 by the MCP project.

`schema.test.ts` validates this server's 2026-07-28 responses against it. To
move to a newer spec commit, replace the file, update the commit and digest
here, and rerun `bun test conformance`.
