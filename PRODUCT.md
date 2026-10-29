# Codex Workbench

<!-- impeccable:product-schema 1 -->

## Platform

web

## Product Purpose

Codex Workbench is a local-first, bilingual browser workspace for Codex sessions, queued messages, approvals, files, and multiple development environments. It connects to Codex app-server. Source of truth: README.md, README.zh-CN.md, and the implemented application.

## Users

Inferred from the implemented workflows: developers working with local repositories and remote development environments over extended sessions. This is a working application, not a marketing site.

## Capabilities and Constraints

- Keep session creation, history search, navigation, drafts, queues, approvals, agent observation, files, diffs, environment connections, and settings functional.
- Keep Simplified Chinese and English, light/dark/system themes, configurable type and layout sizes, keyboard navigation, and responsive layouts.
- Existing stack: React, TypeScript, Vite, Tailwind, Radix UI, Lucide, Monaco, and TipTap. Avoid introducing dependencies for visual changes.
- The service is local to the user's machine. UI verification must not send real tasks, approve actions, or modify remote environments.
- Preserve existing uncommitted work and the global Impeccable runtime.

## Brand Commitments

Keep the Codex Workbench name and existing product icon. The user's explicit direction is a whole-project style and UX redesign that removes an AI-generated feel. The user delegated execution and requested the final result, so repository evidence and the supplied brief replace an additional design interview for this task.

## Product Principles

- Put the current task, content, and next action ahead of decoration.
- Make connection, delivery, approval, and file states understandable.
- Use familiar controls consistently across panels.
- Preserve real product information; do not invent activity, examples, or claims.

## Evidence on Hand

Existing source and tests, README documentation, real browser inspection at http://127.0.0.1:5180, and the shipped icon assets. No customer claims or marketing metrics are needed.
