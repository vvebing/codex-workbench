# Codex Workbench

<!-- impeccable:product-schema 1 -->

## Platform

web

## Product Purpose

Codex Workbench is a local-first, bilingual browser workspace for Codex sessions, queued messages, approvals, project files, and development environments. Tasks run through Codex app-server in the selected environment.

## Users

Developers who work with local repositories and remote development machines, manage long-running coding sessions, and review the resulting changes.

## Core Workflows

- Connect an environment and organize sessions by project and section.
- Create a session, supply file and skill references, and queue follow-up messages.
- Follow execution, answer questions, handle approvals, and inspect subagent activity.
- Read and edit project files, compare Git changes, and review task results.
- Search, favorite, fork, archive, and export sessions.

## Capabilities and Constraints

- The web service runs on the local machine; remote execution uses SSH forwarding.
- Codex CLI provides authentication and app-server execution.
- English and Simplified Chinese are available, with light, dark, and system themes.
- Browser preferences control typography, layout, environment settings, and local recovery data.
- File access and task execution follow the permissions of the connected environment.
- Keyboard navigation, responsive layouts, and visible connection and delivery states are part of the working interface.

## Brand Commitments

Use the Codex Workbench name and product icon consistently. Present concrete workflows and product states without invented activity or unsupported claims.

## Product Principles

- Put the current task, content, and next action ahead of decoration.
- Make connection, delivery, approval, and file states understandable.
- Use familiar controls consistently across panels.
- Keep user choices and recoverable work visible.

## Technical Foundation

The client uses React, TypeScript, Vite, Tailwind CSS, Radix UI, Lucide, Monaco, and TipTap. The Node.js service serves the application and bridges environment connections. See [architecture](docs/architecture.md), [design system](DESIGN.md), and [user guide](docs/user-guide.md) for details.
