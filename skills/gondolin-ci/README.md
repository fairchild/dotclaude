# gondolin-ci

Run one GitHub Actions suite for a pull request inside a micro-VM on your Mac. The VM exists for one
job and is discarded afterwards. It sees no host filesystem, and its only way out is HTTP to an
allowlist, filtered by method and path.

It is for private repositories whose hosted runners are unavailable, or whose suites you would
rather not run directly on your laptop. A run happens only when someone with write access dispatches
one for a commit they read.

See [SKILL.md](SKILL.md) for use, [references/setup.md](references/setup.md) for setup, and
[references/design.md](references/design.md) for the threat model.

## Status

Experimental. It is contained against accidents and casual malice, and not yet safe against code
actively trying to escape: the job's tokens reach the guest, and a VM escape lands in your user
account. Public repositories and pull requests from forks are refused for that reason. Read
[Gaps](references/design.md#gaps) before relying on it.

It runs on macOS on Apple silicon only.

## Credits

Built on [gondolin](https://github.com/earendil-works/gondolin), Apache-2.0, which supplies the
micro-VM, the in-process network stack and the HTTP hooks the egress policy runs in. The guest runs
GitHub's [actions/runner](https://github.com/actions/runner), MIT.

## License

Apache-2.0, like the rest of this repository.
