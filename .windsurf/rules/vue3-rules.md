---
trigger: always_on
description:
globs:
---

## Route Rules
- All routes must be declared in `src/router/defaultRoutes.ts` under the appropriate module section.

## View Rules
- New pages must be developed under the appropriate module directory in `src/views/`.
- Page and component file names must use PascalCase, e.g. `UserList.vue`. Never use `index.vue` as a page or component name.
- When creating a `.vue` file, always create a corresponding `.less` file with the same name, e.g. `ComponentName.vue` + `ComponentName.less`.
- The structure order inside a `.vue` file must be: `<template>`, `<script>`, `<style>`. The `<style>` block should simply import the corresponding `.less` file (e.g. `@import './ComponentName.less';`).
- A page's `.vue` file and its corresponding `.less` file should be placed together in a dedicated folder under the appropriate `src/views/` module directory, to avoid having too many files directly in `src/views/**` which makes browsing difficult.
- The outermost `<div>` of every page should use the `full-container` class (defined in `common.less`) as the default container style.

## CSS rules

- Use Less (`.less`) for component styles.
- Prefer editing styles in `.less` files rather than inline styles or `<style>` blocks in `.vue` files.

### Class Naming (BEM)
- Use BEM naming convention for CSS classes.
- When block nesting exceeds 3 levels, keep only the last 3 levels. For example, `a-block__b-block__c-block__d-block__alpha-element` should be shortened to `b-block__c-block__d-block__alpha-element`.
- **Do NOT use `&` nesting selectors.** Write all selectors flat. For example, use `.user-card__avatar` instead of `.user-card { &__avatar {} }`.

### Color Usage
- Use `oklch()` for colors. Refer to Tailwind CSS color palette oklch values as a design reference when choosing colors.
