import { tokens } from "./tokens.js";

function variables(theme: keyof typeof tokens.color): string {
  const color = tokens.color[theme];
  return `
  --aw-color-canvas: ${color.canvas};
  --aw-color-surface: ${color.surface};
  --aw-color-surface-subtle: ${color.surfaceSubtle};
  --aw-color-text: ${color.text};
  --aw-color-text-muted: ${color.textMuted};
  --aw-color-border: ${color.border};
  --aw-color-control-border: ${color.controlBorder};
  --aw-color-action: ${color.action};
  --aw-color-on-action: ${color.onAction};
  --aw-color-success: ${color.success};
  --aw-color-on-success: ${color.onSuccess};
  --aw-color-warning: ${color.warning};
  --aw-color-on-warning: ${color.onWarning};
  --aw-color-danger: ${color.danger};
  --aw-color-on-danger: ${color.onDanger};
  --aw-color-focus: ${color.focus};`;
}

export const styles = `:root, [data-aw-theme="light"] {${variables("light")}
  --aw-font-family: ${tokens.font.family};
  --aw-font-numeric: ${tokens.font.monoNumeric};
  --aw-font-size-small: ${tokens.font.size.small};
  --aw-font-size-body: ${tokens.font.size.body};
  --aw-font-size-title: ${tokens.font.size.title};
  --aw-line-height-small: ${tokens.font.lineHeight.small};
  --aw-line-height-body: ${tokens.font.lineHeight.body};
  --aw-line-height-title: ${tokens.font.lineHeight.title};
  --aw-space-1: ${tokens.space[1]};
  --aw-space-2: ${tokens.space[2]};
  --aw-space-3: ${tokens.space[3]};
  --aw-space-4: ${tokens.space[4]};
  --aw-space-6: ${tokens.space[6]};
  --aw-space-8: ${tokens.space[8]};
  --aw-radius-control: ${tokens.radius.control};
  --aw-radius-card: ${tokens.radius.card};
  --aw-size-touch: ${tokens.size.touch};
  --aw-elevation-raised: ${tokens.elevation.raised};
  --aw-motion-quick: ${tokens.motion.quick};
  --aw-motion-standard: ${tokens.motion.standard};
  --aw-motion-skeleton: ${tokens.motion.skeleton};
  --aw-motion-easing: ${tokens.motion.easing};
  --aw-breakpoint-compact: ${tokens.breakpoint.compact};
  --aw-breakpoint-wide: ${tokens.breakpoint.wide};
  --aw-layout-content-max: ${tokens.layout.contentMax};
  --aw-layout-reading-max: ${tokens.layout.readingMax};
}

[data-aw-theme="dark"] {${variables("dark")}}

@media (prefers-color-scheme: dark) {
  :root:not([data-aw-theme]) {${variables("dark")}}
}

.aw-button, .aw-field, .aw-field *, .aw-chip, .aw-card, .aw-banner, .aw-skeleton, .aw-icon { box-sizing: border-box; }

.aw-button {
  align-items: center;
  background: var(--aw-color-action);
  border: 1px solid transparent;
  border-radius: var(--aw-radius-control);
  color: var(--aw-color-on-action);
  cursor: pointer;
  display: inline-flex;
  font: 600 1rem/1 var(--aw-font-family);
  gap: 0.5rem;
  justify-content: center;
  min-height: var(--aw-size-touch);
  min-width: var(--aw-size-touch);
  padding: 0.75rem 1rem;
  transition: background-color var(--aw-motion-quick) var(--aw-motion-easing), border-color var(--aw-motion-quick) var(--aw-motion-easing);
}

.aw-button--secondary { background: var(--aw-color-surface); border-color: var(--aw-color-control-border); color: var(--aw-color-text); }
.aw-button:disabled { cursor: not-allowed; opacity: 0.58; }
.aw-button:focus-visible, .aw-field__control:focus-visible, .aw-chip:focus-visible {
  outline: ${tokens.focus.width} solid var(--aw-color-focus);
  outline-offset: ${tokens.focus.offset};
}

.aw-field { color: var(--aw-color-text); display: grid; font-family: var(--aw-font-family); gap: 0.5rem; }
.aw-field__label { font-size: 0.875rem; font-weight: 650; line-height: 1.35; }
.aw-field__control {
  appearance: none;
  background: var(--aw-color-surface);
  border: 1px solid var(--aw-color-control-border);
  border-radius: var(--aw-radius-control);
  color: var(--aw-color-text);
  font: 400 1rem/1.5 var(--aw-font-family);
  min-height: var(--aw-size-touch);
  padding: 0.625rem 0.75rem;
  width: 100%;
}
.aw-field__control[aria-invalid="true"] { border-color: var(--aw-color-danger); }
.aw-field__hint, .aw-field__error { font-size: 0.875rem; line-height: 1.35; margin: 0; }
.aw-field__hint { color: var(--aw-color-text-muted); }
.aw-field__error { color: var(--aw-color-danger); font-weight: 600; }

.aw-chip {
  align-items: center;
  background: var(--aw-color-surface);
  border: 1px solid var(--aw-color-control-border);
  border-radius: var(--aw-radius-control);
  color: var(--aw-color-text);
  cursor: pointer;
  display: inline-flex;
  font: 600 0.875rem/1.2 var(--aw-font-family);
  min-height: var(--aw-size-touch);
  min-width: var(--aw-size-touch);
  padding: 0.5rem 0.75rem;
}
.aw-chip[aria-pressed="true"] { background: var(--aw-color-action); border-color: var(--aw-color-action); color: var(--aw-color-on-action); }

.aw-card { background: var(--aw-color-surface); border: 1px solid var(--aw-color-border); border-radius: var(--aw-radius-card); color: var(--aw-color-text); padding: 1rem; }

.aw-banner { border-left: 3px solid currentColor; color: var(--aw-color-text); font: 400 0.9375rem/1.5 var(--aw-font-family); padding: 0.75rem 1rem; }
.aw-banner--info { background: var(--aw-color-surface-subtle); }
.aw-banner--success { background: color-mix(in srgb, var(--aw-color-success) 14%, var(--aw-color-surface)); color: var(--aw-color-success); }
.aw-banner--warning { background: color-mix(in srgb, var(--aw-color-warning) 14%, var(--aw-color-surface)); color: var(--aw-color-warning); }
.aw-banner--danger { background: color-mix(in srgb, var(--aw-color-danger) 12%, var(--aw-color-surface)); color: var(--aw-color-danger); }

.aw-skeleton { animation: aw-skeleton-pulse var(--aw-motion-skeleton) var(--aw-motion-easing) infinite alternate; background: var(--aw-color-surface-subtle); border-radius: 0.25rem; display: block; min-height: 1rem; }
.aw-icon { display: inline-block; flex: 0 0 auto; height: ${tokens.size.icon}; stroke: currentColor; stroke-linecap: round; stroke-linejoin: round; stroke-width: 1.75; width: ${tokens.size.icon}; }

@media (hover: hover) {
  .aw-button:not(:disabled):hover { background: color-mix(in srgb, var(--aw-color-action) 90%, black); }
  .aw-button--secondary:not(:disabled):hover, .aw-chip:not(:disabled):hover { background: var(--aw-color-surface-subtle); }
  .aw-chip[aria-pressed="true"]:not(:disabled):hover { background: color-mix(in srgb, var(--aw-color-action) 90%, black); }
}
.aw-button:not(:disabled):active { background: color-mix(in srgb, var(--aw-color-action) 84%, black); }
.aw-button--secondary:not(:disabled):active, .aw-chip:not(:disabled):active { background: color-mix(in srgb, var(--aw-color-surface-subtle) 84%, black); }
.aw-chip[aria-pressed="true"]:not(:disabled):active { background: color-mix(in srgb, var(--aw-color-action) 84%, black); }

@keyframes aw-skeleton-pulse { from { opacity: 0.58; } to { opacity: 1; } }
@media (prefers-reduced-motion: reduce) { .aw-button, .aw-skeleton { animation: none; transition: none; } }
`;
