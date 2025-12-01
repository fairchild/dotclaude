---
description: Bootstrap a new project with interactive brainstorming and structure generation
---

You are helping the user bootstrap a new project or create a fresh starting point. Your goal is to:

1. **Understand the context** - Ask clarifying questions about:
   - What type of project (web app, API, library, CLI tool, etc.)
   - Technology stack preferences (if any)
   - Development methodology (incremental, TDD, DDID, etc.)
   - Any specific requirements or constraints
   - Whether they want to use an existing template or start fresh

2. **Present strategic options** - Based on their context, present 3-5 different architectural/structural approaches:
   - Progressive/incremental approaches (like DDID - Demo-Driven Incremental Development)
   - Contract-first approaches (API-first, schema-first)
   - Template-based vs custom generation
   - Simple-first vs feature-complete starters
   - Monorepo vs single-repo structures

3. **Synthesize a unified plan** - Take the best elements from the options (or as the user directs) and create a concrete plan that includes:
   - Directory structure
   - Key files needed (with purposes)
   - Development workflow
   - Testing/verification approach
   - Documentation strategy

4. **Execute the plan** - Create the actual directory structure with:
   - Configuration files (package.json, tsconfig.json, etc.)
   - Starter source code
   - Documentation (README.md, ROADMAP.md, API.md, etc.)
   - Demo/test scripts (if applicable)
   - Development utilities

## Approach Options

### Option A: Use existing template
If the user wants a template-based start:
- Ask what template (or suggest finding one)
- Use tools like `degit` or `git clone` to pull template
- Customize based on their specific needs
- Add any additional documentation or structure

### Option B: Custom generation
If starting fresh:
- Create files from scratch based on brainstormed plan
- Ensure all files are complete and functional
- Include executable demos/tests where appropriate
- Make scripts executable (chmod +x)

### Option C: Hybrid
- Start with a minimal template
- Extend with custom files and documentation
- Add project-specific methodology (like DDID)

## Key Principles

1. **Incremental over complex** - Start simple, add complexity only as needed
2. **Executable verification** - Include ways to verify each step works
3. **Clear documentation** - README, ROADMAP, API docs that evolve
4. **Git-friendly** - Proper .gitignore, clear commit points
5. **Developer experience** - Hot reload, clear error messages, fast feedback

## Example Workflows

### Demo-Driven Incremental Development (DDID)
- Each milestone has ONE new capability
- Executable demo script verifies it works
- Manual verification steps included
- Git tags mark completion
- API.md updated when contracts change
- Regression testing via run-all script

### Test-Driven Development (TDD)
- Write tests first
- Minimal implementation
- Refactor with confidence
- Continuous integration

### Contract-First Development
- Define API/schema first (OpenAPI, GraphQL, etc.)
- Generate types/stubs
- Implement against contract
- Version contracts explicitly

## Deliverables

When complete, ensure you've created:
- [ ] Complete directory structure
- [ ] All configuration files
- [ ] Starter source code (functional, not just comments)
- [ ] Documentation (README with quick start)
- [ ] Any demo/test scripts (marked executable)
- [ ] Example environment variables (.env.example)
- [ ] .gitignore file

## Important Notes

- **ALWAYS** use the TodoWrite tool to track progress
- Create files at the correct path (verify with pwd if needed)
- Make scripts executable with chmod +x
- Verify the complete structure with `tree` before finishing
- The goal is to hand off a **fully functional starting point** for a new Claude Code session

## Usage Patterns

The user might invoke this as:
- `/bootstrap` - Full interactive brainstorming
- `/bootstrap [description]` - Quick bootstrap with context
- Example: `/bootstrap new API with Cloudflare Workers and Hono`

Start by understanding what they're building, then guide them through the process thoughtfully.
