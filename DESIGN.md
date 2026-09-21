# Vercel Design System Specification (DESIGN.md)

This specification defines the visual language, design tokens, and UI principles inspired by the Vercel Geist design system.

---

## 1. Design Philosophy
- **Confident, Technical, Low-Noise**: High functional density, monochrome foundation (black, white, grays), with intentional, minimal color accents.
- **Borders over Shadows**: Favor 1px hairline borders (`border-border` / `border-zinc-200`) over heavy drop shadows.
- **Precision & Alignment**: Strict 4px/8px layout grid, optical alignment, and disciplined spacing scale.
- **Typography as Interface**: Clear hierarchy, negative letter spacing for headlines, tabular/monospace numbers for data and timestamps.

---

## 2. Color Tokens & Palette

### Monochrome Core
- **Canvas / Background**: `#ffffff` / `#fafafa` / `#f5f5f5` (`oklch(0.985 0 0)` to `oklch(1 0 0)`)
- **Primary / Ink**: `#171717` (`oklch(0.145 0 0)` / `oklch(0.205 0 0)`)
- **Secondary / Body Text**: `#4d4d4d` / `#737373`
- **Muted / Caption**: `#888888` / `#a1a1a1`
- **Border / Hairline**: `#ebebeb` / `#e5e5e5` (`oklch(0.922 0 0)`)
- **Input / Hover Background**: `#f4f4f5` / `#f9fafb`

### Accents & Semantic States
- **Accent / Link**: `#0070f3` (Vercel Blue)
- **Success**: `#0070f3` or subdued emerald (`#10b981`)
- **Warning**: `#f5a623` / `#d97706`
- **Destructive / Error**: `#ee0000` / `#ef4444`

---

## 3. Typography & Ramps

- **Primary Sans**: `Geist Sans`, `Inter`, system-ui, -apple-system, sans-serif
- **Monospace**: `Geist Mono`, ui-monospace, Menlo, Monaco, monospace

| Token | Size | Weight | Line Height | Tracking | Usage |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `display-lg` | 32px | 600 | 40px | -0.04em | Main page titles |
| `display-md` | 24px | 600 | 32px | -0.03em | Section headers |
| `display-sm` | 20px | 600 | 28px | -0.02em | Subsections, Card titles |
| `body-md` | 16px | 400/500 | 24px | 0 | Body text |
| `body-sm` | 14px | 400/500 | 20px | -0.01em | Standard UI, table cells, form labels |
| `caption` | 12px | 400/500 | 16px | 0 | Badges, secondary meta |
| `caption-mono`| 12px/13px | 400 | 16px | 0 | IDs, timestamps, Webhook tokens, table headers |

---

## 4. Spacing, Radius & Elevation

### Spacing Scale
- `xs`: 4px / 8px (`gap-1`, `gap-2`, `p-2`)
- `sm`: 12px (`gap-3`, `p-3`)
- `md`: 16px (`gap-4`, `p-4`)
- `lg`: 24px (`gap-6`, `p-6`)
- `xl`: 32px (`gap-8`, `p-8`)

### Border Radius
- `sm`: `6px` (`rounded-md` for buttons, badges, inputs)
- `md`: `8px` (`rounded-lg` for cards, dialogs)
- `lg`: `12px` (`rounded-xl` for container shells)
- `full`: `9999px` (`rounded-full` for pill badges, avatars)

---

## 5. Web Interface Guidelines & Content Rules

1. **Typographic Details**:
   - Use true ellipsis character `…` instead of `...`.
   - Use tabular numbers (`font-mono` or `tabular-nums`) for comparisons, time, counters, and statistics.
   - Use sentence case for button labels and UI copy.

2. **Form & Controls**:
   - Inputs must have clear `:focus-visible` focus ring styles.
   - Loading buttons should retain their label with an attached spinner and show loading states like `"保存中…"`.
   - Never disable paste on inputs.

3. **State Completeness**:
   - Every list/table must feature an Empty State (no empty dead-ends).
   - Destructive actions require explicit confirmation or undo mechanisms.
   - Redundant status cues: Don't rely on color alone; always provide textual badges.
