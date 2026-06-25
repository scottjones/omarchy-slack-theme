# CLAUDE.md

Guidance for working in this repo. Keep it short; update it when the architecture changes.

## What this is

A small **Manifest V3 browser extension** (Brave/Chrome/Chromium) that makes the
**Slack web app** (`app.slack.com`) follow the current [Omarchy](https://omarchy.org/)
theme. It repaints Slack's chrome/sidebar/message pane to match the terminal
background and auto-flips Slack's Light/Dark Color Mode when you switch omarchy
themes. A **Python native-messaging host** watches `~/.config/omarchy/current/`
and pushes theme changes to the extension within ~1s.

This is end-user desktop tooling, not a web service. There is no build step, no
package manager, and no test suite — it's plain JS + a Python script loaded as an
unpacked extension.

## Layout

- `extension/` — the unpacked extension
  - `content.js` — **the bulk of the work.** Builds the themed CSS from the
    pushed theme and injects it; also drives Slack's Preferences modal to flip
    Color Mode. See "content.js structure" below.
  - `background.js` — MV3 service worker. Holds the native-messaging port,
    rebroadcasts pushed themes to Slack tabs, answers `request-fresh-theme`.
  - `inject-prefers-color-scheme.js` — runs in the page's MAIN world at
    `document_start`; spoofs `matchMedia('(prefers-color-scheme)')` so Slack's
    "Sync with OS" appearance follows omarchy instead of the OS.
  - `manifest.json` — permissions + content-script registration.
- `native-host/` — `omarchy-theme-host.py` (polls omarchy config, emits
  length-prefixed JSON over stdio) + the native-messaging manifest template.
- `install.sh` — installs the native-messaging host manifest for a given
  extension ID (`--browser chrome|chromium|brave`, default brave).

## content.js structure

1. **Color helpers** — `hexToRgb`, `relLuminance`, `shade`, `withAlpha`, `mix`.
   Dark vs. light is decided by **WCAG relative luminance** of the terminal bg
   (`< 0.5` = dark), *not* by the theme's day/night name.
2. **`applyTheme(theme)`** — derives surfaces (`sidebarBg`, `chromeBg`,
   `hoverBg`, `selectedBg`, …) from `theme.bg/fg/accent/chrome`, then builds one
   big CSS template string and injects it into a `<style id="omarchy-slack-style">`.
3. **Inline-important overrides** — Slack sets its own high-specificity inline
   styles (CSS custom props like `--rainbow-*`, `--saf-*`, and direct
   `background-color` on the rail/sidebar/nav on blur). External `!important` CSS
   loses to inline styles, so we re-write the same vars + direct paints
   **inline with `setProperty(..., "important")`** to win the cascade.
4. **`paintActiveRows()`** — paints the selected-channel pill inline because
   Slack's React re-render stomps our CSS; a MutationObserver re-runs it.
5. **MutationObservers** — re-inject the style if Slack removes it, keep active-row
   paint current, etc.
6. **Color-mode automation** — `ensureSlackColorMode(isDark)` opens
   Preferences → Appearance and toggles the radio via a MAIN-world React bridge
   (synthetic clicks don't fire Slack's handler reliably).

## How the CSS rules are written (important conventions)

- Selectors use **attribute-substring matches** like `[class*="p-activity_ia4_page"]`
  because Slack ships **hashed/minified class names** that change between builds.
  Never hard-code a full class name; match a stable substring prefix.
- Almost every rule needs `html body …` prefixes and `!important` to beat Slack's
  specificity. Follow the existing pattern.
- Rules are grouped into annotated `/* ===== section ===== */` blocks (main pane,
  tab rail, channel sidebar, top nav, message hover, DMs/Activity list, badges,
  text readability). Add new work to the matching block or a new annotated block.
- Theme-derived values come from CSS vars (`--omarchy-bg`, `--omarchy-fg`,
  `--omarchy-accent`, `--omarchy-sidebar-bg`, `--omarchy-hover-bg`,
  `--omarchy-selected-bg`, `--omarchy-fg-strong`). Use these rather than literals.

## Dev / test workflow

There's no automated harness — changes are verified by hand against live Slack:

1. Edit files under `extension/`.
2. Reload the unpacked extension at `brave://extensions` (or Chrome equivalent).
3. Reload the Slack tab. Filter the DevTools console by `omarchy` to see logs.
4. To find selectors for a Slack UI element, **inspect the live DOM in DevTools**
   (Slack's class names are hashed, so you must read them off the running app —
   don't guess). The repo can't be inspected locally because the markup is Slack's.

Note: Brave normally runs **without** a remote-debugging port, so an automated
browser (Playwright) can't attach to the logged-in session. Inspect via DevTools
in the user's own browser, or have the user paste DOM/console output.

## Conventions

- Vanilla JS only (no framework, no bundler). Keep the heavy inline comments —
  they explain *why* a given hack beats Slack's cascade; preserve that context.
- Don't open PRs or push without confirming with the user.
