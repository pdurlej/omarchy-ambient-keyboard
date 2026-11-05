# Ambient Keyboard: notes for AI agents

This file is for coding agents helping someone use, debug, or change this plugin.

## What it is

An Omarchy shell plugin (`pdurlej.ambient-keyboard`, beta) that gives Intel MacBooks the macOS keyboard-backlight experience: the level follows the ambient light sensor, the brightness keys teach the curve (they scale `darkPercent`) instead of being undone, and the keys fade out after `idleOffSeconds` without input (default 60, 0 = never). Switching the keys off, or on in a bright room, is held until the light clearly changes. It does nothing while the lid is closed, the session is locked, or all displays are off. Without a light sensor the brightness keys set the level and idle-off still applies.

## Helping a user

Check compatibility before installing; this is read-only:

```sh
git clone --depth 1 https://github.com/pdurlej/omarchy-ambient-keyboard.git /tmp/ambient-keyboard-check
/tmp/ambient-keyboard-check/probe
```

The plugin can work when `led` is non-empty and `max` is above 0. `lux` as a number means it can follow the light; `lux: null` means no usable IIO light sensor (manual mode); `led: ""` means no `*kbd_backlight*` LED.

Install, inspect, remove:

```sh
omarchy plugin add https://github.com/pdurlej/omarchy-ambient-keyboard.git --enable
omarchy-shell pdurlej.ambient-keyboard status
omarchy plugin remove pdurlej.ambient-keyboard --yes
```

`status` reports `status` as one of: `auto` (following the light), `hold` (a manual level kept until the light changes), `manual` (no sensor), `idle` (keys faded out for inactivity), `off` (automation disabled), `asleep` (lid, lock, or displays off), `no-backlight`, `starting`.

If the user already runs another backlight script, service, or plugin, it will fight this one over the LED. Point that out and let the user choose which one to keep; do not disable theirs without asking.

## Reporting results upstream

This is a beta tested only on a 2015 MacBook Pro. A hardware report from a new machine is valuable whether it works or not. With the user's approval, open one using the form fields in `.github/ISSUE_TEMPLATE/hardware-report.yml` (laptop model from `/sys/class/dmi/id/product_name`, the probe line, Omarchy version, and whether it worked). Show the user the report before submitting it.

## Changing the code

- `Model.js`: pure logic (curve, smoothing, stepping, learning from manual changes, hold, idle fade). Keep it free of QML so tests run in Node.
- `Service.qml`: polls `probe` every 2 s, applies `Model.tick`, writes with `brightnessctl` (fades via a short Bash loop), watches inactivity with Quickshell's `IdleMonitor`, exposes IPC. It never polls while a write is in flight, so its own fades are not mistaken for manual changes.
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
