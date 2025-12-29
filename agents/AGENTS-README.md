# Claude Code Agents

This directory contains specialized Claude Code agents for various development and maintenance tasks. Each agent is designed for specific use cases and provides intelligent automation for complex workflows.

## Available Agents

### 🔔 GitHub Notifications Triager (`github-notifications-triager.md`)
Automatically checks GitHub notifications and provides prioritized summaries of the most important items requiring attention.
- **Usage**: "What's the most important stuff I need to handle on GitHub today?"
- **Features**: Prioritizes by urgency, provides direct links, suggests actionable next steps

### 🤖 AI SDK Agent Architect (`ai-sdk-agent-architect.md`) 
Implements Vercel AI SDK 5 agents with streaming capabilities, tool orchestration, and reasoning visibility.
- **Usage**: "I need to implement a search agent with the new AI SDK"
- **Features**: Streaming reasoning, tool orchestration, personality-driven system prompts

### 🎭 Playwright Test Analyzer (`playwright-test-analyzer.md`)
Runs Playwright end-to-end tests with comprehensive visual analysis and UI/UX quality assessment.
- **Usage**: "Run the checkout flow tests and analyze the UI"
- **Features**: Screenshot capture, visual regression analysis, documentation-ready assets

### 🐳 DevContainer Setup (`devcontainer-setup.md`)
Sets up, configures, and verifies DevContainer environments with security hardening and development tools.
- **Usage**: "Set up a devcontainer for this project"
- **Features**: Security optimization, firewall configuration, automatic tool installation

### 📋 Project Handoff Auditor (`project-handoff-auditor.md`)
Prepares codebases for handoff to clients or new teams with comprehensive quality audits.
- **Usage**: "We need to prepare this project for client handoff next week"
- **Features**: Code quality assessment, documentation audit, deployment verification

### 📔 jrnlfish Builder (`jrnlfish-builder-agent.md`)
Specialized agent for building jrnlfish, an extremely simple daily journaling application.
- **Usage**: `/jrnlfish bootstrap minimal daily journaling app`
- **Features**: Bootstrap projects, maintain simplicity principles, comprehensive testing

### 📓 Simple Journal Builder (`jrnl_builder.md`)
Basic daily journaling application builder focused on extreme simplicity and reliability.
- **Usage**: Build straightforward journaling apps
- **Features**: One entry per day, bulletproof execution, minimal interface

## Usage Patterns

### Getting Started
Most agents can be invoked by describing your need in natural language:
```
"Check my GitHub notifications and tell me what I should focus on"
"Set up a secure DevContainer for this TypeScript project"
"Run end-to-end tests and capture screenshots for documentation"
```

### Agent Selection
- **Development**: Use `ai-sdk-agent-architect` for AI implementations, `devcontainer-setup` for environment setup
- **Testing**: Use `playwright-test-analyzer` for comprehensive UI testing and visual analysis
- **Maintenance**: Use `github-notifications-triager` for notification management, `project-handoff-auditor` for quality assurance
- **Specialized**: Use `jrnlfish-builder-agent` for journaling app development

### Best Practices
- Agents are designed to work autonomously once activated
- Each agent includes built-in error handling and quality assurance
- Most agents provide detailed reports and actionable recommendations
- Agents follow security best practices and maintain code quality standards

## Technical Details
- Agents use specialized models (sonnet, opus, inherit) optimized for their tasks
- All agents integrate with Claude Code's tool ecosystem
- Security-focused agents implement defense-in-depth strategies
- Quality-focused agents include comprehensive validation and testing

Copy any agent specification to your Claude Code agents directory to use them in your projects.