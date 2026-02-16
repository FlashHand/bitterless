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
1. TypeScript files must use camelCase + Angular-style suffix naming, e.g. `userDetail.service.ts`, `message.store.ts`, `chatMessage.type.ts`.

## Code style
1. Always end statements with a semicolon (`;`).
