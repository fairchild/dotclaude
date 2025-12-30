---
description: Audit a private repo before making it public
---

You are performing a pre-open-source audit to ensure no sensitive data, secrets, or private information will be exposed when the repository is made public.

## Audit Checklist

Run these checks systematically and report findings in a summary table.

### 1. Secrets Detection

Search for potential secrets in tracked files:

```bash
# API keys and tokens
git grep -i -E '(api[_-]?key|apikey|secret[_-]?key|access[_-]?token|auth[_-]?token|bearer)' -- ':!*.md' ':!*test*' ':!*spec*' | head -20

# AWS patterns
git grep -E '(AKIA[0-9A-Z]{16}|aws[_-]?secret|aws[_-]?access)' | head -10

# Private keys
git grep -l -E '(BEGIN (RSA|DSA|EC|OPENSSH) PRIVATE KEY|BEGIN PRIVATE KEY)'

# Common secret patterns
git grep -i -E '(password|passwd|pwd)\s*[=:]\s*["\x27][^"\x27]+["\x27]' -- ':!*.md' | head -10
```

### 2. Sensitive Files Check

Look for files that shouldn't be committed:

```bash
# Check for sensitive file patterns in tracked files
git ls-files | grep -iE '\.(pem|key|p12|pfx|keystore|env|env\..+|secret|credentials)$'

# Check for common sensitive directories
git ls-files | grep -iE '^(\.aws|\.ssh|\.gnupg|secrets|credentials|private)/'
```

### 3. Personal Information

Search for personal data:

```bash
# Email addresses (excluding common false positives)
git grep -h -oE '[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}' -- ':!*.lock' ':!package*.json' ':!*.md' | sort -u | head -20

# IP addresses (internal ranges)
git grep -E '(192\.168\.|10\.|172\.(1[6-9]|2[0-9]|3[01])\.)[0-9]+\.[0-9]+' | head -10

# Hardcoded localhost with ports (potential internal services)
git grep -E 'localhost:[0-9]{4,5}' -- ':!*.md' ':!*test*' | head -10
```

### 4. Git History Audit

Check for secrets in commit history:

```bash
# Large files in history
git rev-list --objects --all | git cat-file --batch-check='%(objecttype) %(objectname) %(objectsize) %(rest)' | awk '/^blob/ && $3 > 1048576 {print $3, $4}' | sort -rn | head -10

# Files that were deleted but in history
git log --diff-filter=D --summary --name-only --pretty=format: | grep -iE '\.(env|pem|key|secret|credentials)' | sort -u

# Check for sensitive patterns in commit messages
git log --oneline --all | grep -iE '(secret|password|credential|api.?key|token)' | head -10
```

### 5. License & Documentation

```bash
# Check for LICENSE
ls -la LICENSE* COPYING* 2>/dev/null || echo "WARNING: No LICENSE file found"

# Check for README
ls -la README* 2>/dev/null || echo "WARNING: No README file found"

# Check for attribution files
ls -la NOTICE* CREDITS* THIRD_PARTY* ATTRIBUTION* 2>/dev/null || echo "INFO: No attribution files (may be OK)"
```

### 6. Gitignore Coverage

```bash
# Check if common sensitive patterns are in .gitignore
for pattern in '.env' '*.pem' '*.key' '.aws' '.ssh' 'secrets/' 'credentials'; do
  grep -q "$pattern" .gitignore 2>/dev/null && echo "✓ $pattern" || echo "✗ $pattern missing from .gitignore"
done
```

### 7. Hardcoded URLs

```bash
# Internal/private URLs
git grep -E 'https?://[^/]*(internal|private|staging|dev|local|corp|intra)[^/]*\.' -- ':!*.md' | head -10

# Private GitHub repos referenced
git grep -E 'github\.com/[^/]+/[^/]+' -- ':!*.md' ':!*.lock' | grep -v 'github.com/\(actions\|anthropics\|nodejs\|microsoft\|google\)' | head -10
```

### 8. External Security Scanners

Run dedicated secret-scanning tools for deeper analysis. Check if installed and run:

```bash
# gitleaks - comprehensive secret scanner (recommended)
# Install: brew install gitleaks
if command -v gitleaks &>/dev/null; then
  echo "=== Running gitleaks ==="
  gitleaks detect --source . --verbose 2>&1 | head -50
else
  echo "⚠ gitleaks not installed (brew install gitleaks)"
fi

# trufflehog - scans git history for high-entropy strings
# Install: brew install trufflehog
if command -v trufflehog &>/dev/null; then
  echo "=== Running trufflehog ==="
  trufflehog git file://. --only-verified 2>&1 | head -50
else
  echo "⚠ trufflehog not installed (brew install trufflehog)"
fi

# git-secrets - AWS-focused secret prevention
# Install: brew install git-secrets
if command -v git-secrets &>/dev/null; then
  echo "=== Running git-secrets ==="
  git secrets --scan 2>&1 | head -30
else
  echo "⚠ git-secrets not installed (brew install git-secrets)"
fi
```

**Tool comparison:**

| Tool | Strengths | Install |
|------|-----------|---------|
| **gitleaks** | Fast, configurable rules, CI-friendly | `brew install gitleaks` |
| **trufflehog** | Deep history scan, entropy detection | `brew install trufflehog` |
| **git-secrets** | AWS-focused, commit hooks | `brew install git-secrets` |
| **detect-secrets** | Baseline tracking, plugin system | `pip install detect-secrets` |

**GitHub native scanning:**
Once public, GitHub automatically scans for known secret patterns and alerts.
Enable in Settings → Code security → Secret scanning.

## Output Format

Present findings as:

### Summary

| Category | Status | Issues Found |
|----------|--------|--------------|
| Secrets | ✓/⚠/✗ | count |
| Sensitive Files | ✓/⚠/✗ | count |
| Personal Info | ✓/⚠/✗ | count |
| Git History | ✓/⚠/✗ | count |
| License | ✓/⚠/✗ | details |
| Gitignore | ✓/⚠/✗ | missing patterns |

### Critical Issues (must fix)
List any secrets, credentials, or private keys found.

### Warnings (should review)
List items that need human judgment.

### Recommendations
Specific actions to remediate issues found.

## If Issues Found in Git History

If secrets were found in git history, recommend:

1. **BFG Repo-Cleaner** for removing sensitive data:
   ```bash
   bfg --delete-files '*.pem' --delete-files '.env'
   bfg --replace-text passwords.txt
   ```

2. **git-filter-repo** for more complex rewrites

3. **Rotate any exposed credentials** - history rewriting doesn't prevent exposure if the repo was ever accessible

## Final Checklist

Before making public, confirm:
- [ ] All secrets removed or rotated
- [ ] Personal emails replaced with project emails
- [ ] Internal URLs removed
- [ ] LICENSE file present and appropriate
- [ ] README explains what the project is
- [ ] .gitignore covers sensitive patterns
- [ ] Git history clean (or accept exposure risk)
- [ ] Third-party code properly attributed
