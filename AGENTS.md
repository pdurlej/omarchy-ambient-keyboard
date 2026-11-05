# Ambient Keyboard: notes for AI agents

This file is for coding agents helping someone use, debug, or change this plugin.

## What it is

An Omarchy shell plugin (`pdurlej.ambient-keyboard`, beta) that sets the laptop keyboard backlight from the ambient light sensor. A manual change pauses it for `manualHoldSeconds` (default 120). It does nothing while the lid is closed, the session is locked, or all displays are off.

## Helping a user

Check compatibility before installing; this is read-only:

```sh
git clone --depth 1 https://github.com/pdurlej/omarchy-ambient-keyboard.git /tmp/ambient-keyboard-check
/tmp/ambient-keyboard-check/probe
```

The plugin can work when `led` is non-empty, `max` is above 0, and `lux` is a number. `lux: null` means no usable IIO light sensor; `led: ""` means no `*kbd_backlight*` LED.

Install, inspect, remove:

```sh
omarchy plugin add https://github.com/pdurlej/omarchy-ambient-keyboard.git --enable
omarchy-shell pdurlej.ambient-keyboard status
omarchy plugin remove pdurlej.ambient-keyboard --yes
```

`status` reports `status` as one of: `auto`, `paused` (manual change), `off` (automation disabled), `asleep` (lid, lock, or displays off), `no-sensor`, `no-backlight`, `starting`.

If the user already runs another backlight script, service, or plugin, it will fight this one over the LED. Point that out and let the user choose which one to keep; do not disable theirs without asking.

## Reporting results upstream

This is a beta tested only on a 2015 MacBook Pro. A hardware report from a new machine is valuable whether it works or not. With the user's approval, open one using the form fields in `.github/ISSUE_TEMPLATE/hardware-report.yml` (laptop model from `/sys/class/dmi/id/product_name`, the probe line, Omarchy version, and whether it worked). Show the user the report before submitting it.

## Changing the code

- `Model.js`: pure logic (curve, smoothing, stepping, manual-pause state machine). Keep it free of QML so tests run in Node.
- `Service.qml`: polls `probe` every 2 s, applies `Model.tick`, writes with `brightnessctl`, exposes IPC.
- `Panel.qml`: optional bar button and panel. Plain-text `Text` only.
- `probe`: read-only Bash; prints one JSON line. Never make it write anything.
- `i18n/*.json`: strings per Omarchy language code; English is the fallback.

Before committing:

```sh
node tests/model.test.js
omarchy plugin validate .
```

Settings live in the plugin's entry in `~/.config/omarchy/shell.json`; Omarchy writes them to the bar entry when the widget is on the bar, and to the top-level `plugins` list otherwise. `Model.entryFromShellConfig` reads both.

No network access, no privilege escalation, no files outside the plugin directory and its `shell.json` entry.
