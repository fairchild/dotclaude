# .claude-plugin/plugins

Plugins of this repository that are more than one skill. A plugin here owns a directory with its
own `.claude-plugin/plugin.json`, skills, scripts and — later — agents and hooks, and appears in
[`marketplace.json`](../marketplace.json) with that directory as its `source`.

They sit under `.claude-plugin/` rather than at a root `plugins/` because this repository *is*
`~/.claude`, where Claude Code keeps its own installed-plugin cache at `plugins/` — `.gitignore`
reserves that path. `.claude-plugin/plugins/<name>` is the layout the plugin tooling already
recognizes for a plugin hosted in the repository that serves it.

- **[`shipyard`](shipyard/)**: the multi-seat development pattern — a lead seat, a reviewer seat,
  implementers between them, and a setup seat that fits the three to one repository.

Three homes, three shapes, and the shape decides:

- `skills/<name>` with a marketplace entry whose `source` is `./` and whose `skills` array names one
  directory — a plugin that is one skill, and the same skill a machine running this repository as
  `~/.claude` already has.
- `mods/<name>` — a plugin whose hooks *module* runs inside the engine, with the session's
  permissions, and can answer tools of its own. That is what `mods/` means. A plugin here may
  still carry ordinary command hooks, which run as separate processes and can only read what they
  are given; `shipyard` does, and it is not a mod.
- `.claude-plugin/plugins/<name>` — several components under one name, installed as a unit.

A plugin here pins no `version`, for the reason [`mods/README.md`](../../mods/README.md) gives: without
one, a GitHub install resolves to the commit SHA and `claude plugin update` follows `main`. None
carries a `bin/` directory either — claude.ai and Cowork refuse to install a plugin that has one, so
executables go in the plugin's `scripts/` and are reached through `${CLAUDE_PLUGIN_ROOT}`.
