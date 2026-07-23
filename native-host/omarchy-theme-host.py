#!/usr/bin/env python3
"""
Native messaging host for the Omarchy Slack Theme extension.

Reads the active Omarchy theme and reports the background color, foreground
color, and accent. Polls for changes once per second; pushes an update to the
extension whenever the theme changes.

Omarchy 4 relocated the 'current' theme state from ~/.config/omarchy/current to
the XDG state dir ~/.local/state/omarchy/current. The internal layout is
unchanged (a theme/ dir holding alacritty.toml / colors.toml / chromium.theme,
plus a theme.name file), so we just try the new location first and fall back to
the old one for pre-4 installs. omarchy-theme-set replaces current/theme
wholesale on every switch, so the files' mtimes bump and the poller notices.
"""

import json
import os
import re
import select
import struct
import sys
from pathlib import Path

STATE_CURRENT = Path.home() / ".local" / "state" / "omarchy" / "current"  # Omarchy 4+
CONFIG_CURRENT = Path.home() / ".config" / "omarchy" / "current"  # pre-4 fallback
POLL_INTERVAL = 1.0  # seconds


def _read_text(path: Path) -> str:
    try:
        return path.read_text().strip()
    except FileNotFoundError:
        return ""
    except OSError:
        return ""


def _parse_alacritty_bg(path: Path):
    try:
        text = path.read_text()
    except OSError:
        return None
    in_primary = False
    for line in text.splitlines():
        s = line.strip()
        if s.startswith("["):
            in_primary = (s == "[colors.primary]")
            continue
        if in_primary:
            m = re.match(r'background\s*=\s*"(#[0-9a-fA-F]{6,8})"', s)
            if m:
                return m.group(1)
    return None


def _parse_colors_toml(path: Path):
    out = {}
    try:
        text = path.read_text()
    except OSError:
        return out
    for line in text.splitlines():
        m = re.match(r'(\w+)\s*=\s*"(#[0-9a-fA-F]{6,8})"', line.strip())
        if m:
            out[m.group(1)] = m.group(2)
    return out


def _parse_chromium_theme(path: Path):
    """omarchy ships browser chrome color as 'r,g,b' decimal CSV in chromium.theme.
    Most stock themes omit the file — omarchy-theme-set-browser then falls back
    to #1c2027, but here we return None and let the extension apply its own
    fallback so it can be theme-aware about the choice."""
    try:
        text = path.read_text().strip()
    except OSError:
        return None
    parts = [p.strip() for p in text.split(",")]
    if len(parts) != 3:
        return None
    try:
        r, g, b = [int(p) for p in parts]
    except ValueError:
        return None
    if not all(0 <= c <= 255 for c in (r, g, b)):
        return None
    return f"#{r:02x}{g:02x}{b:02x}"


def _current_dir():
    """Locate omarchy's 'current' theme-state dir (Omarchy 4 first, then pre-4)."""
    for base in (STATE_CURRENT, CONFIG_CURRENT):
        if (base / "theme").exists():
            return base
    # Neither present — return the Omarchy 4 path so the parsers apply their own
    # fallbacks (bg -> #1e1e2e, chrome -> None) instead of crashing.
    return STATE_CURRENT


def get_state():
    cur = _current_dir()
    name = _read_text(cur / "theme.name")
    bg = _parse_alacritty_bg(cur / "theme" / "alacritty.toml")
    colors = _parse_colors_toml(cur / "theme" / "colors.toml")
    chrome = _parse_chromium_theme(cur / "theme" / "chromium.theme")
    if not bg:
        bg = colors.get("background")
    if not bg:
        bg = "#1e1e2e"  # fallback
    # The extension decides dark vs. light purely from bg luminance, so we don't
    # report a day/night flag.
    return {
        "theme_name": name,
        "bg": bg,
        "fg": colors.get("foreground"),
        "accent": colors.get("accent"),
        "selection_bg": colors.get("selection_background"),
        # Browser chrome color from chromium.theme — used by Slack extension for
        # the tab rail + top nav so those regions match Brave's toolbar tint.
        # None when the theme doesn't ship chromium.theme.
        "chrome": chrome,
    }


def signature():
    """Cheap fingerprint of theme state — bumps whenever the active theme changes."""
    cur = _current_dir()
    parts = []
    for sub in ("theme.name", "theme/alacritty.toml", "theme/colors.toml", "theme/chromium.theme"):
        p = cur / sub
        try:
            parts.append(int(p.stat().st_mtime_ns))
        except OSError:
            parts.append(0)
    # current/theme is normally a real dir that omarchy-theme-set replaces
    # wholesale, but older installs symlinked it — capture the target if so.
    theme_dir = cur / "theme"
    try:
        parts.append(os.readlink(theme_dir) if theme_dir.is_symlink() else "dir")
    except OSError:
        parts.append("")
    return tuple(parts)


def _read_message(timeout):
    """Read one length-prefixed JSON message from stdin, or return None on EOF/timeout."""
    r, _, _ = select.select([sys.stdin.buffer], [], [], timeout)
    if not r:
        return ("timeout", None)
    raw_len = sys.stdin.buffer.read(4)
    if not raw_len or len(raw_len) < 4:
        return ("eof", None)
    n = struct.unpack("=I", raw_len)[0]
    payload = sys.stdin.buffer.read(n)
    if not payload or len(payload) < n:
        return ("eof", None)
    try:
        return ("msg", json.loads(payload.decode("utf-8")))
    except json.JSONDecodeError:
        return ("msg", {})


def _send(obj):
    data = json.dumps(obj).encode("utf-8")
    sys.stdout.buffer.write(struct.pack("=I", len(data)))
    sys.stdout.buffer.write(data)
    sys.stdout.buffer.flush()


def main():
    last_sig = None
    while True:
        kind, _msg = _read_message(POLL_INTERVAL)
        if kind == "eof":
            return
        if kind == "msg":
            state = get_state()
            last_sig = signature()
            _send(state)
            continue
        # timeout — check for theme change and push if so
        sig = signature()
        if sig != last_sig:
            last_sig = sig
            try:
                _send(get_state())
            except BrokenPipeError:
                return


if __name__ == "__main__":
    try:
        main()
    except (BrokenPipeError, KeyboardInterrupt):
        pass
    except Exception as e:
        try:
            _send({"error": str(e)})
        except Exception:
            pass
