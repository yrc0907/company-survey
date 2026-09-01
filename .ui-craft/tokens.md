# Research Workbench Tokens

## Primitive

- Neutral: `#f7f8fa`, `#eef1f5`, `#d8dde6`, `#8b95a7`, `#4f5b6d`, `#1d2530`, `#10151d`.
- Accent: cobalt `#2059d6` with quiet tint `#eaf0ff`.
- Semantic states: verified `#137a56`, inference `#9a6800`, conflict `#b33b48`.
- Spacing: 4, 8, 12, 16, 24, 32, 48px.
- Radius: 6px inputs/buttons, 10px panels, 14px dialogs.
- Typography: system sans for reading; `ui-monospace` for source IDs, timestamps and evidence counts.

## Semantic

- Canvas: near-white `#f7f8fa`; raised surface: `#ffffff`; sidebar: `#f1f4f8`.
- Primary text: `#1d2530`; secondary: `#5f6b7c`; muted: `#8b95a7`.
- Border: `#dde3eb`; focus and primary action: cobalt.
- Shadows: subtle two-layer neutral shadows, used only for overlays and active rows.

## Component decisions

- Active navigation is a cobalt-tint row with a 3px left indicator.
- Report content is unframed; only source and AI tools receive framed panels.
- Citations use square source markers and monospace IDs, not colorful pills.
- Primary actions use cobalt; destructive actions remain text-first until explicit confirmation.
