# Security review

## Purpose
A security review says what can go wrong with this specific system, how bad each problem is, and what to do about it. Start from the threat model, not from a checklist. The reader is an engineer who has to fix things and an approver who has to accept the residual risk.

## Structure: threat model first
1. **Assets:** what's worth protecting (data, credentials, systems, reputation).
2. **Trust boundaries:** where data or control crosses from less trusted to more trusted.
3. **Threats:** what an attacker can do at each boundary to each asset.
4. **Mitigations:** what's in place or proposed, pointing at the specific spot.
5. **Residual risk:** what's left after mitigation, and who accepts it.

## Output format
Section caps are in words (heading line excluded; field labels count). The soft rule in SKILL.md applies to every cap.

```
# Security review: <system>
Reviewer: <name>   Date: <YYYY-MM-DD>   Scope: <commit, doc, or env>

**Severity: <Critical | High | Medium | Low | None>.** <one line: worst finding and its asset>

## TL;DR                     (60)
Up to 3 bullets: top findings, overall verdict, and the ask.

## Assets                    (80)
List section: each bullet is asset (claim) + why it matters (evidence).

## Trust boundaries          (100)
List section: each bullet is boundary (claim) + what crosses it (evidence).

## Findings                  (60 per finding)
### F<n> [<severity>] <title>
- Asset: <which asset it threatens>   (required)
- Where: <file:line, endpoint, config key, or component>
- Threat: <what an attacker does>
- Fix: <the specific change at that spot>
Keep each finding ≤60 words. One fix action; put extras in Next steps. If still over after trim, flag and justify.

## Residual risk             (80)
Each remaining risk, with who accepts it.

## Next steps                (60)
```

## Rules
- The severity line comes before any detail. Base it on the worst finding.
- **Every finding names the asset it threatens.** If you can't name one, it isn't a finding.
- **No generic advice.** "Use strong encryption" or "validate input" isn't allowed unless you point at the exact spot and the exact change, for example: "`upload.ts:42` passes `filename` to `path.join` unsanitized; reject `..` segments."
- Order findings by severity, highest first.
- **Count each finding's body with a tool** before handoff. Four required bullets often land near the cap; trim the Fix to one action or flag.

## Anti-patterns
- **Restating the design doc.** Link to it. Describe only the parts that matter for security.
- **Listing tools instead of findings.** "We ran Semgrep and Trivy" isn't a result. Report what they found or say "none".
- **Compliance boilerplate padding.** SOC 2 or GDPR paragraphs that don't connect to a finding.
- Treating every finding as High. If everything is critical, nothing is.
- **Kitchen-sink Fix bullets.** Three mitigations in one Fix; pick the primary change and move the rest to Next steps.

## Worked example

**Severity: High.** Session tokens for the admin dashboard can be stolen through a stored XSS in project names.

### F1 [High] Stored XSS in project name
- Asset: admin session tokens
- Where: `dashboard/ProjectCard.tsx:31` renders `project.name` with `dangerouslySetInnerHTML`
- Threat: a user names a project `<img onerror=...>`, and an admin who views the list gets their cookie sent to the attacker
- Fix: render `project.name` as text (React default), not `dangerouslySetInnerHTML`

(HttpOnly on the session cookie is a separate Next-steps item, not a second Fix.)

**Bloated version of the same finding (what to avoid):**
> Cross-site scripting is a common web vulnerability (OWASP A03). The application should ensure that all user input is properly sanitized and that output encoding is applied consistently. We recommend following security best practices and using a modern framework's built-in protections.

The bloated version has no asset, no location, and no specific fix.

## Soft-rule flagging
Use the flag from SKILL.md. A Critical or High finding that still needs a reproduction detail after trim can justify going over its cap — flag it and route for sign-off. Assets and Trust boundaries almost never can.
