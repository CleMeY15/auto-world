# `@auto-world/design-system`

Semantic tokens and server-compatible React primitives for Auto World. Import the generated stylesheet once in an application root:

```ts
import "@auto-world/design-system/styles.css";
```

Components are available from the package root or `@auto-world/design-system/primitives`. Tokens are available from `@auto-world/design-system/tokens`. Theme selection uses `data-aw-theme="light"` or `data-aw-theme="dark"` on an ancestor; without an explicit value, the operating-system preference is used.

All component selectors and custom properties use the `aw-` prefix. The package does not apply global element resets.

## Components and states

| Primitive | Contract |
| --- | --- |
| `Button` | Native button; default type button, primary/secondary, disabled/loading with retained label and `aria-busy`. |
| `Field` | Required id/label; associated hint/error, `aria-invalid`, native input attributes. |
| `Chip` | Native toggle button; required `pressed`, `aria-pressed`, selected/hover/active/focus/disabled states. |
| `Card` | Non-interactive surface; no invented role or click behavior. |
| `Skeleton` | Decorative reserved-geometry block; hidden from screen readers, animation off with reduced motion. |
| `Banner` | Info/success/warning status, danger alert; meaningful text required, not color-only status. |

Search, bookmark, filter, back and close vectors share one local 24×24 line-icon grammar; icons are decorative and unfocusable. Meaning belongs in the accompanying label.

`src/tokens.ts` is the authority for light/dark palette, named platform font stack, spacing, shape, focus, responsive breakpoints and motion. `src/styles.ts` generates `dist/styles.css`; do not hand-edit the generated file. Text/action/semantic contrast pairs are unit tested, and rendered states are checked by the web browser suite. Interactive targets are at least 44 CSS px, focus is 3 px with 2 px offset, feedback is 120 ms, and skeleton motion never carries essential information.

The package has only a React peer dependency: no data governance, connector, service or third-party UI framework. Web owns the page reset and layout; later native consumers may reuse tokens without inheriting web element behavior. Themes and example state are ephemeral in the preview; persistent favorites are later scope.
