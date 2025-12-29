# GitHub Actions Workflows

## Preview Deployment (PRs)

`.github/workflows/preview-deployment.yml`:

```yaml
name: Preview Deployment

on:
  pull_request:
    branches: [main]

jobs:
  preview:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      pull-requests: write
      deployments: write

    steps:
      - uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: "20"
          cache: "npm"

      - name: Install dependencies
        run: npm ci

      - name: Build
        run: npm run build

      - name: Deploy to Cloudflare Workers (Preview)
        uses: cloudflare/wrangler-action@v3
        id: deploy
        with:
          apiToken: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          accountId: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
          command: deploy --env preview

      - name: Comment on PR
        uses: actions/github-script@v7
        with:
          script: |
            const deploymentUrl = '${{ steps.deploy.outputs.deployment-url }}';
            const body = `## Preview Deployment\n\nPreview ready at: ${deploymentUrl}`;

            const { data: comments } = await github.rest.issues.listComments({
              owner: context.repo.owner,
              repo: context.repo.repo,
              issue_number: context.issue.number
            });

            const botComment = comments.find(c =>
              c.user.type === 'Bot' && c.body.includes('Preview Deployment')
            );

            if (botComment) {
              await github.rest.issues.updateComment({
                owner: context.repo.owner,
                repo: context.repo.repo,
                comment_id: botComment.id,
                body
              });
            } else {
              await github.rest.issues.createComment({
                owner: context.repo.owner,
                repo: context.repo.repo,
                issue_number: context.issue.number,
                body
              });
            }
```

## Production Deployment (Push to Main)

`.github/workflows/production-deployment.yml`:

```yaml
name: Production Deployment

on:
  push:
    branches: [main]

concurrency:
  group: production
  cancel-in-progress: false

jobs:
  deploy:
    runs-on: ubuntu-latest
    permissions:
      contents: write
      deployments: write

    steps:
      - uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: "20"
          cache: "npm"

      - name: Install dependencies
        run: npm ci

      # Add if running Playwright tests
      - name: Install Playwright browsers
        run: npx playwright install --with-deps chromium

      - name: Run tests
        run: npm test
        env:
          CI: true

      - name: Build
        run: npm run build

      - name: Deploy to Cloudflare Workers (Production)
        uses: cloudflare/wrangler-action@v3
        with:
          apiToken: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          accountId: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
          command: deploy --env production

      - name: Create deployment tag
        run: |
          TAG="production-$(date +%Y%m%d-%H%M%S)"
          git tag $TAG
          git push origin $TAG
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

## Manual Production (Optional)

For manual deploys instead of auto-deploy on push:

```yaml
on:
  workflow_dispatch:
    inputs:
      reason:
        description: 'Reason for deployment'
        required: false
```

## Required GitHub Secrets

Set in repository Settings → Secrets and variables → Actions:

- `CLOUDFLARE_API_TOKEN` - Create at dash.cloudflare.com/profile/api-tokens with "Edit Cloudflare Workers" template
- `CLOUDFLARE_ACCOUNT_ID` - Found in Cloudflare dashboard URL or `wrangler whoami`

Set via CLI:
```bash
gh secret set CLOUDFLARE_API_TOKEN
gh secret set CLOUDFLARE_ACCOUNT_ID --body "your-account-id"
```
