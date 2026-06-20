# Firebase Center — Design System

Light, warm-paper control panel. Restrained palette, one deep-teal accent, monospace for machine values (keys, IDs, tokens, project ids). Left-sidebar app shell. Tables over card grids. Hierarchy from weight + scale, not boxes.

## Hard rules (do not break)
- **Preserve every `data-test="..."` attribute and the exact visible text the tests assert** (e.g. page titles like "Sites", button labels). Styling only — add classes/markup wrappers, never remove test hooks or change asserted strings.
- No `#000`/`#fff` — use the tinted tokens. No side-stripe accent borders, no gradient text, no glassmorphism, no hero-metric cards, no identical icon-card grids, no modal-first flows. No em dashes in UI copy.
- Motion: ease-out only, ≤180ms, never animate layout properties.

## Tokens — `app/assets/css/main.css` `:root`
```css
:root {
  /* warm-paper neutrals (tinted toward hue 95) */
  --bg:        oklch(0.985 0.004 95);   /* app canvas */
  --surface:   oklch(0.995 0.002 95);   /* panels, table bg */
  --surface-2: oklch(0.965 0.005 95);   /* sidebar, subtle fills, zebra */
  --border:    oklch(0.905 0.006 95);
  --border-strong: oklch(0.84 0.008 95);
  /* ink (cool-dark, never pure black) */
  --text:      oklch(0.28 0.018 265);
  --text-muted:oklch(0.52 0.014 265);
  --text-faint:oklch(0.64 0.012 265);
  /* accent: deep desaturated teal (not firebase-amber, not messaging-blue) */
  --accent:    oklch(0.48 0.082 200);
  --accent-hover: oklch(0.42 0.085 200);
  --accent-weak:  oklch(0.95 0.02 200);  /* tint for active nav / selected */
  --on-accent: oklch(0.99 0.004 95);
  /* status (badges/text only) */
  --ok:    oklch(0.55 0.10 155);  --ok-weak:   oklch(0.95 0.03 155);
  --warn:  oklch(0.65 0.11 75);   --warn-weak: oklch(0.96 0.04 75);
  --danger:oklch(0.55 0.16 25);   --danger-weak:oklch(0.96 0.04 25);
  --muted-badge: oklch(0.60 0.015 265); --muted-weak: oklch(0.95 0.004 265);
  /* type */
  --font-sans: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, Inter, sans-serif;
  --font-mono: ui-monospace, "SF Mono", "JetBrains Mono", Menlo, Consolas, monospace;
  /* scale (1.25) */
  --t-xs:.78rem; --t-sm:.875rem; --t-base:1rem; --t-lg:1.25rem; --t-xl:1.6rem; --t-2xl:2rem;
  /* space, radius, shadow */
  --r-sm:6px; --r-md:9px; --r-lg:13px;
  --sh-1: 0 1px 2px oklch(0.28 0.02 265 / 0.06), 0 1px 1px oklch(0.28 0.02 265 / 0.04);
  --sh-2: 0 4px 14px oklch(0.28 0.02 265 / 0.08);
}
```

## Base
- `body { background: var(--bg); color: var(--text); font: 400 var(--t-sm)/1.5 var(--font-sans); -webkit-font-smoothing: antialiased; }`
- Headings: tight line-height, weight 600. `code, .mono { font-family: var(--font-mono); font-size: .9em; }`
- Links: `var(--accent)`, underline on hover only.
- Focus-visible: `outline: 2px solid var(--accent); outline-offset: 2px;` — never remove focus rings.

## App shell — `app/layouts/default.vue`
Grid: fixed **240px sidebar** + fluid main. Sidebar `--surface-2`, right border `--border`.
- **Sidebar:** wordmark "Firebase Center" (weight 600, a small teal dot mark), then nav groups. Primary nav: **Sites**, **Compose**, **Send history**. Nav items: 8px radius, muted text; hover `--surface`; active = `--accent-weak` bg + `--accent` text + weight 550. Footer of sidebar: signed-in email + **Sign out**.
- **Topbar (in main, sticky):** page title slot on the left, contextual actions on the right; thin bottom border.
- **Main:** max-width ~1100px content, generous top/side padding (28–36px), vertical rhythm via varied spacing (section gaps larger than row gaps).
- Login page uses NO shell: centered single panel on `--bg`.

## Components (class contracts — apply these names)
- **Page header** `.page-head` — title (`--t-xl`, 600) + optional one-line muted subtitle + right-aligned primary action.
- **Panel** `.panel` — `--surface`, `1px solid --border`, `--r-lg`, `--sh-1`, padding 20–24px. Use for forms and grouped content. Never nest panels.
- **Button** `.btn` (base: 8px 14px, `--r-md`, weight 550, `--t-sm`, ease-out): `.btn-primary` (accent bg, `--on-accent`, hover `--accent-hover`), `.btn-ghost` (transparent, `--border`, `--text`), `.btn-danger` (text/border `--danger`, hover fill `--danger-weak`). Disabled: 0.5 opacity, not-allowed.
- **Field** `.field` (label block weight 550 `--t-xs` `--text-muted` + input). Inputs/selects/textarea: full-width, `--surface`, `1px solid --border-strong`, `--r-sm`, 9px 11px, focus border `--accent`. Monospace inputs for tokens/keys.
- **Table** `.table` — full width, `--surface`, `--border` 1px frame, `--r-md` clipped. `th` `--surface-2`, `--t-xs` uppercase tracking, `--text-muted`, left-aligned. `td` 10–12px padding, `--border` bottom hairline, vertical-align middle. Row hover `--surface-2`. IDs/tokens/keys in `.mono` + `--text-muted`. No zebra needed; hairlines carry it.
- **Badge** `.badge` (`--t-xs`, weight 550, 2px 8px, `--r-sm`, weak-bg + strong-text): `.badge-ok` (sent/active/ready), `.badge-danger` (failed/invalid/revoked), `.badge-warn` (gave_up/not_ready), `.badge-muted` (queued/sending). Map delivery + readiness statuses to these.
- **Callout** `.callout` (warn variant for "you won't see this key again") — `--warn-weak` bg, `1px solid --warn`, `--r-md`, padding 12–14px; the key itself in a `.mono` copy field with a copy button. NOT a modal.
- **Empty state** `.empty` — centered, `--text-muted`, a one-line "what to do next" + a primary action. Every list page has one.
- **Key reveal** for issued send/ingest keys: inline `.callout` with the full key in mono, "shown once" wording, copy affordance; afterwards lists show only the prefix.

## Patterns
- **Sites list** → table (name, app count, status badge) + "New Site" primary; row click → site detail.
- **Site detail / App** → header + tabbed sub-nav (Apps, then per-app: Credentials, Devices, Ingest keys, Send keys). Tabs = underline-active, not boxes.
- **Credentials** → table per (provider, platform) with a readiness badge; write-only add form in a panel; secret fields show "configured ✓ · project_id" never the secret.
- **Compose** → a focused form panel: Site/App select, message, mode + priority, target (all / specific devices), then a live **recipient preview broken down per (provider, platform)** with not-ready flags, then a prominent Send. Right-rail or below: nothing flashy.
- **Send history** → table (title, when, sent/failed/invalid/gave-up/not-ready counts as small badges, status) + drill-in.

Implementation: one global stylesheet (`app/assets/css/main.css`) wired via `nuxt.config` `css: []`; components apply the classes above. Keep it framework-free (no Tailwind add) to avoid churn.
