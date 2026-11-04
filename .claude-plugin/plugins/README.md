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

A skill inside a plugin declares its tier in `SKILL.md` frontmatter like any other, but it is not
in the README's generated tier tables: `scripts/catalog.py` globs `skills/*/SKILL.md`, and merging
plugin skills into tables described as that directory would make both harder to read. The plugin's
own README is where its skills and their tiers are listed. `.github/scripts/validate-config.py`
does check their frontmatter, so the declaration is enforced wherever it lives.

A plugin here reaches a cloud session too: the bundle
[`cloud-bundle.yml`](../../.github/workflows/cloud-bundle.yml) publishes carries `.claude-plugin/`,
and [`cloud-bootstrap.sh`](../../scripts/cloud-bootstrap.sh) installs these alongside the mods into
one directory marketplace named `dotclaude`, enabled from the first session. `DOTCLAUDE_PLUGINS`
narrows which, and `none` installs none. A plugin here that declares `dependencies` is installed
only when they are all present, since one does not load without them: narrowing the mods away
takes a plugin that depends on them too, and the status line says which dependency was missing.

A plugin here pins no `version`, for the reason [`mods/README.md`](../../mods/README.md) gives: without
one, a GitHub install resolves to the commit SHA and `claude plugin update` follows `main`. None
carries a `bin/` directory either — claude.ai and Cowork refuse to install a plugin that has one, so
executables go in the plugin's `scripts/` and are reached through `${CLAUDE_PLUGIN_ROOT}`.
