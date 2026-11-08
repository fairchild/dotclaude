# Consequential rubric

Each question is answered with a probability. The situations below anchor that number: the "yes"
lists are what a probability near 1 looks like, the "no" lists what a probability near 0 looks like.
A change that matches nothing listed is judged by its nearest neighbour here. Edit this file as the
owner's corrections come in; the five headings must stay, because the router asks one question per
heading.

## hard_to_undo

Yes:
- A database migration that drops or rewrites a column, table, or index, or backfills data in place.
- A release, a published package version, a tag, or anything pushed to a registry or app store.
- Deleting a branch, bucket, queue, or stored object; changing a retention or lifecycle rule.
- A message, email, or webhook sent to people or systems outside the repo the moment it deploys.
- Renaming or removing a public API route, CLI flag, or config key other code already calls.

No:
- Code, tests, or docs that a revert commit fully restores.
- A new feature behind a flag that defaults off.
- An additive migration (new nullable column, new table) with no backfill.

## weakens_security

Yes:
- Widening permissions: a workflow's `permissions:`, an IAM policy, a CORS origin, a firewall rule,
  a token scope, or a role grant.
- Removing or loosening authentication, authorization, input validation, CSRF, or rate limiting.
- `pull_request_target`, `workflow_run`, or a self-hosted runner that executes code from a fork.
- Unpinning a dependency or action from a hash, or adding a dependency from an unfamiliar source.
- Disabling TLS verification, a secret scanner, a sandbox, or a security test.

No:
- Tightening any of the above.
- Bumping a pinned dependency to a newer pinned version from the same publisher.

## costs_money

Yes:
- A new paid service, plan upgrade, or API whose calls are billed.
- Raising instance sizes, replica counts, retention, request limits, or CI matrix width.
- A scheduled job, cron, or loop that calls a billed API more often than before.
- Moving a model call to a more expensive model or a higher effort.

No:
- Work within an existing budget that changes no volume, size, or tier.
- Lowering any of the above.

## product_decision

Yes:
- Changing what users see or pay: pricing, plans, limits, copy on a landing or checkout page.
- Adding, removing, or renaming a user-facing feature, setting, or default.
- Choosing between options the issue left open, or doing something no issue asked for.
- Changing a public promise: license, privacy policy, terms, SLA, deprecation date.

No:
- Implementing exactly what an issue or spec already decided.
- Internal refactors, test coverage, build tooling, and fixes that restore stated behavior.

## exposes_private_data

Yes:
- Logging, printing, or returning request bodies, tokens, emails, addresses, or IDs that were not
  exposed before.
- Making a bucket, page, endpoint, repo, or artifact public, or widening who can read it.
- Committing real names, private repo names, hostnames, credentials, or customer data to a public repo.
- Sending data to a new third party, including an analytics script or an LLM API.

No:
- Redacting, scoping down, or deleting stored data.
- Test fixtures made of obviously fake data.
