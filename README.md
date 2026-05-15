# omarchy-slack-theme

A tiny browser extension that makes the Slack web app follow your
[Omarchy](https://omarchy.org/) theme — including auto-flipping Slack's
Light/Dark Color Mode whenever you switch omarchy themes, and painting the
main message pane with your terminal's background color so Slack visually
blends into the rest of your desktop.

Built and tested on Brave on Arch Linux + Omarchy. Should work on Chrome and
Chromium with one flag change to `install.sh`.

## What it does

- **Main pane background** matches your terminal's background (read from
  `~/.config/omarchy/current/theme/alacritty.toml`).
- **Sidebar, top nav, channel header** are tinted to match your terminal
  color (a couple of shades off so they're visually distinct from the chat).
- **Slack's Light/Dark Color Mode** flips automatically when you switch
  themes — the extension opens Preferences → Appearance, picks the right
  radio, and closes the dialog (all hidden from view).
- **Pushes updates instantly** when you switch themes. A small Python
  native-messaging host polls `~/.config/omarchy/current/` and sends the new
  state to the extension within a second.

## How it works

```
┌──────────────┐   length-prefixed JSON   ┌────────────────────┐
│  Python      │ ────────────────────────►│  Browser service   │
│  native host │ ◄──────────────────────  │  worker (MV3 bg)   │
│  (stdio)     │                          └────────┬───────────┘
└──────────────┘                                   │ chrome.tabs.sendMessage
   reads:                                          ▼
   ~/.config/omarchy/current/        ┌────────────────────────────┐
     theme.name                      │  Content script on Slack   │
     theme.day / theme.night         │  • injects themed CSS      │
     theme/alacritty.toml            │  • drives the Appearance   │
     theme/colors.toml               │    radio via Preferences   │
                                     │    modal automation        │
                                     └────────────────────────────┘
```

Slack's Color Mode is flipped by:

1. Clicking the workspace-actions button (`[data-qa="workspace_actions_button"]`)
2. Clicking the "Preferences" menu item
3. Clicking the Appearance tab in the prefs dialog
4. Calling React's `onChange` directly on the hidden `<input type="radio">`
   for Light/Dark, via a MAIN-world bridge script (Slack's React handler
   doesn't fire reliably for synthetic mouse events)
5. Closing the dialog via the X button
6. Dismissing any leftover open menus with Escape

Dark/Light is decided by **WCAG relative luminance** of the terminal
background — robust to themes that don't use the obvious day/night naming
(e.g. an Omarchy "day" theme that happens to use a dark palette).

## Requirements

- Brave (or Chrome / Chromium) — Manifest V3
- Python 3.8+
- Linux + [Omarchy](https://omarchy.org/) with `~/.config/omarchy/current/`
  populated
- A terminal config under `~/.config/omarchy/current/theme/alacritty.toml`
  (the host falls back to `colors.toml` if that's missing)

## Install

1. **Load the unpacked extension**
   - Open `brave://extensions`
   - Toggle on **Developer mode**
   - Click **Load unpacked** and select the `extension/` folder
   - Copy the **extension ID** Brave shows on the card (32 letters a–p)

2. **Install the native-messaging host**

   ```sh
   ./install.sh <EXTENSION_ID>
   ```

   For Chrome / Chromium add `--browser chrome` or `--browser chromium`.

   This writes `~/.config/BraveSoftware/Brave-Browser/NativeMessagingHosts/com.omarchy.slack_theme.json`
   (or the equivalent for Chrome/Chromium) pointing at `native-host/omarchy-theme-host.py`
   and allow-listing your extension ID.

3. **Restart the browser** (fully quit, not just close the window — `pkill brave` if needed).

4. **Open `app.slack.com`.** Switch omarchy themes and Slack should follow
   within a second.

## Verifying it works

Open DevTools on the Slack tab and filter the console by `omarchy`. A
successful theme switch looks like:

```
[omarchy] flipping Slack to Dark
[omarchy] opening preferences (Ctrl+,)
[omarchy] using workspace-actions menu
[omarchy] clicking workspace-name button: ...
[omarchy] activating Preferences menu item: ...
[omarchy] preferences dialog opened via menu: true
[omarchy] clicking Appearance tab
[omarchy] clicking Dark radio
[omarchy] dispatchClick didn't take; using React handler for Dark
[omarchy bridge] called onChange on INPUT c-input_radio themeRadio__IHvrr
[omarchy] React click confirmed Dark
[omarchy] closing prefs via close button
[omarchy] Slack color mode now Dark
```

## Customization

All visual rules live in `extension/content.js` inside the big template
string. Search for `===== main / message area =====`, `===== left tab rail`,
etc. — each block is annotated.

Common tweaks:

- **Sidebar shade**: change `dir * 0.04` (in the `sidebarBg` calculation
  near the top of `applyTheme`) to a bigger number for more contrast.
- **Selected channel highlight**: search for `withAlpha(accent, 0.35)` — that's
  the selected-row tint. Drop to 0.2 for subtler, raise for more punch.
- **Use day/night nomenclature instead of luminance**: replace the
  `relLuminance(...) < 0.5` check in `applyTheme` with `theme.is_night`.

After editing, reload the extension on `brave://extensions` and refresh the
Slack tab.

## Limitations / known gotchas

- **Slack rebrands its CSS classes occasionally.** The selectors anchor on
  `data-qa` attributes where possible (which are more stable), but expect
  occasional breakage when Slack ships a redesign. The console will say
  things like `'Preferences' menu item not found` — those messages tell you
  which selector died.
- **Synthetic `Ctrl+,` doesn't open Preferences** in some Brave builds (the
  React handler appears to check `event.isTrusted`). The menu-click path is
  the real workhorse; the keyboard attempt is best-effort.
- **The native host polls file mtimes once per second.** Switching omarchy
  themes faster than that and reloading the Slack tab in the same breath can
  put the extension on stale state for ≤1s. The content script issues a
  "fresh read" request before triggering the auto-flip, so it self-corrects.
- **Only one workspace at a time has been tested.** Multi-workspace setups
  should work since the selectors are workspace-agnostic, but PRs welcome.
- **No popup UI, no options page.** This is intentional — the extension has
  no user-facing controls, just a content script and a service worker.

## Repository layout

```
extension/
├── manifest.json                   # MV3 manifest
├── background.js                   # service worker; manages native port
├── content.js                      # injects CSS + drives prefs automation
└── inject-prefers-color-scheme.js  # MAIN-world bridge: matchMedia shim + React onClick

native-host/
├── omarchy-theme-host.py           # length-prefixed JSON over stdio
└── com.omarchy.slack_theme.json.template

install.sh                          # writes native-host manifest into the browser's dir
```

## License

MIT — see [LICENSE](./LICENSE).
