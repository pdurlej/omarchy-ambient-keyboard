# Ambient Keyboard for Omarchy

Keyboard backlight that follows the room's light, the way a Mac does it: the keys glow softly in the dark, dim as the room gets brighter, and switch off in daylight. Change the brightness yourself and the automation steps aside for two minutes.

![Ambient Keyboard panel](preview.png)

## Highlights

- **Follows the ambient light sensor.** Readings are smoothed, and the backlight moves in small steps, so a passing shadow does not make the keys flicker.
- **Your keys win.** Any manual change (brightness keys, `brightnessctl`, another tool) pauses the automation for two minutes. **Resume automatic** in the panel hands control back right away.
- **Stays out of Omarchy's way.** While the lid is closed, the session is locked, or the displays are off, it leaves the backlight alone, so lock and screen-off handling keep working as before.
- **Optional bar button.** The automation runs as a background service. The bar button only shows the panel: left click opens it, right click turns the automation on or off.
- **Follows your Omarchy language.** English and Polish are included; other languages fall back to English.

## Requirements

- Omarchy 4.5 or newer (Quattro shell plugin system)
- A keyboard backlight exposed as `/sys/class/leds/*kbd_backlight*`
- An ambient light sensor exposed through IIO (`in_illuminance_input`, or `in_illuminance_raw` with a scale)
- `brightnessctl` and `jq`, both shipped with Omarchy

Tested on a 2015 MacBook Pro (MacBookPro11,5) with the `acpi-als` sensor and `smc::kbd_backlight`. Other Intel MacBooks, and laptops with an IIO light sensor and a backlit keyboard, should work too. If your machine works, or does not, an issue with its model is very welcome.

## Install

```sh
omarchy plugin add https://github.com/pdurlej/omarchy-ambient-keyboard.git --enable
```

The automation starts right away. The bar button lands on the right side of the bar; move or remove it like any other widget.

If you previously ran your own backlight script or service, stop it so the two do not fight over the keys.

### Update

```sh
omarchy plugin update pdurlej.ambient-keyboard --yes
```

### Remove

```sh
omarchy plugin remove pdurlej.ambient-keyboard --yes
```

## Settings

Open the panel from the bar button:

| Setting | Default | Meaning |
| --- | --- | --- |
| Automatic | on | Turns the automation on or off |
| Level in the dark | 35% | Backlight level in a dark room |
| Off above | 150 lx | Ambient light at which the backlight is fully off |

Settings are stored in the plugin's entry in `~/.config/omarchy/shell.json`. You can also set `manualHoldSeconds` there (default `120`, `0` to never pause).

Between dark and **Off above**, the level follows a curve that falls slowly at first and faster in dim light: at the default settings 35% at 0 lx, 30% at 20 lx, 15% at 60 lx, and off at 150 lx.

## Scripting

```sh
omarchy-shell pdurlej.ambient-keyboard status          # JSON: state, light, level, settings
omarchy-shell pdurlej.ambient-keyboard enable          # also: disable, toggle
omarchy-shell pdurlej.ambient-keyboard resume          # end a manual pause now
omarchy-shell pdurlej.ambient-keyboard setDarkPercent 40
omarchy-shell pdurlej.ambient-keyboard setOffLux 200
omarchy-shell pdurlej.ambient-keyboard.panel toggle    # also: open, close
```

## How it works

Every two seconds the service runs `probe`, a small read-only Bash helper that prints the backlight level, the light sensor reading, and whether the desktop is in use (lid, lock, displays) as one JSON line. The service smooths the light reading, works out the target level, and moves toward it by at most 5% of the range per tick with `brightnessctl`.

## Security and system changes

- No network access, no privilege escalation, no packages, no system services.
- `probe` only reads `/sys` and `/proc` and runs `hyprctl -j monitors`.
- Brightness changes go through `brightnessctl`, which uses systemd-logind, so no extra permissions are needed.
- Settings writes touch only the plugin's entry in `~/.config/omarchy/shell.json`.

## Development

```sh
node tests/model.test.js
omarchy plugin validate .
```

The automation logic lives in `Model.js` as plain functions, so it is tested without a running shell.

## License

MIT
