---
trigger: always_on
description: typescript usage rules and yarn rules
globs:
---

# Typescript Usage Rules:


## Iteration rules:
1. Prefer `for` loops or `Array.prototype.map` for iteration.
2. Never use `forEach` — use `for...of`, `for`, or `map` instead.

## Package Install Rules:
1. The project uses Yarn workspaces. Always use `yarn add -W` to install packages to the workspace root.
2. For dev dependencies, use `yarn add -W -D`.


## File Naming Rules
1. TypeScript files must use camelCase + suffix naming. A file name has at most **two** dot-separated suffixes (name + type suffix + extension), e.g. `userStore.type.ts`, `message.dao.ts`, `chatMessage.service.ts`. Never use more than two suffixes like `.user.store.type.ts`.

## Import Rules
1. Always prefer alias imports (e.g. `@renderer/`, `@main/`, `@preload/`) over relative paths (e.g. `../../`).
2. Use `import type` when importing types or interfaces that are only used at the type level.

## Code style
1. Always end statements with a semicolon (`;`).

## Date rules:
- 如果项目是web项目使用dayjs处理所有日期对象;如果项目是nodejs或electron项目则使用momentjs处理所有日期对象.
