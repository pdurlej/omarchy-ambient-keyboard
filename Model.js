.pragma library

// Pure logic for Ambient Keyboard, kept free of QML so it can be tested with
// plain Node (see tests/model.test.js).
//
// The goal is the Mac experience: you never think about the keyboard light.
// It follows the room, it learns from the brightness keys instead of fighting
// them, and it goes dark while you are not typing.

var defaults = {
  enabled: true,
  darkPercent: 35,     // backlight level in a dark room, percent of maximum
  offLux: 150,         // ambient light at which the backlight is fully off
  idleOffSeconds: 60   // turn the keys off after this much inactivity; 0 = never
}

var limits = {
  darkPercent: [5, 100],
  offLux: [20, 1000],
  idleOffSeconds: [0, 1800]
}

// Choices offered in the panel for idleOffSeconds.
var idleStops = [0, 10, 30, 60, 120, 300]

// Below this base fraction the curve is effectively "off", so a manual change
// cannot be learned as a scale and is held instead.
var learnFloor = 0.02

function clamp(value, low, high) {
  return Math.max(low, Math.min(high, value))
}

function numberOr(value, fallback) {
  var n = Number(value)
  return isFinite(n) ? n : fallback
}

// Normalizes a plugin entry from shell.json into a complete settings object.
function normalizeSettings(entry) {
  var source = entry && typeof entry === "object" ? entry : {}
  var result = { enabled: source.enabled !== false }
  for (var key in limits) {
    var range = limits[key]
    result[key] = Math.round(clamp(numberOr(source[key], defaults[key]), range[0], range[1]))
  }
  return result
}

// Finds this plugin's settings in shell.json text. Omarchy writes them to the
// bar entry when the widget is on the bar, otherwise to the top-level plugins
// list, so look in that order.
function entryFromShellConfig(text, pluginId) {
  try {
    var config = JSON.parse(String(text || "{}"))
    var layout = config.bar && config.bar.layout && typeof config.bar.layout === "object" ? config.bar.layout : {}
    for (var section in layout) {
      var widgets = Array.isArray(layout[section]) ? layout[section] : []
      for (var w = 0; w < widgets.length; w++) {
        if (widgets[w] && widgets[w].id === pluginId) return widgets[w]
      }
    }
    var plugins = Array.isArray(config.plugins) ? config.plugins : []
    for (var i = 0; i < plugins.length; i++) {
      if (plugins[i] && plugins[i].id === pluginId) return plugins[i]
    }
  } catch (error) {
  }
  return null
}

// Backlight fraction (0..1) for an ambient light reading: gentle in the dark,
// falling faster in dim light, off once the room is bright.
function targetFraction(lux, darkPercent, offLux) {
  var top = clamp(numberOr(darkPercent, defaults.darkPercent), 0, 100) / 100
  var off = Math.max(1, numberOr(offLux, defaults.offLux))
  var points = [
    [0, top],
    [off * 2 / 15, top * 6 / 7],
    [off * 0.4, top * 3 / 7],
    [off, 0]
  ]
  var x = Math.max(0, numberOr(lux, 0))
  for (var i = 0; i < points.length - 1; i++) {
    var a = points[i], b = points[i + 1]
    if (x <= b[0]) return a[1] + (b[1] - a[1]) * (x - a[0]) / (b[0] - a[0])
  }
  return 0
}

// Exponential smoothing so a passing shadow does not flicker the keys.
function smooth(previous, lux) {
  if (previous === null || previous === undefined || !isFinite(previous)) return lux
  return 0.7 * previous + 0.3 * lux
}

// Smallest difference worth a write: about 1% of the range, but at least one
// level, so keyboards with only two or three levels still move.
function deadband(maximum) {
  return Math.max(1, Math.round(maximum * 0.012))
}

// True when the keys should move toward target at all. Reaching zero always
// counts, so the keys really switch off in daylight.
function worthMoving(current, target, maximum) {
  if (target === 0) return current > 0
  return Math.abs(target - current) >= deadband(maximum)
}

// One step toward the target, at most 5% of the range per tick. Returns null
// when the difference is too small to bother changing.
function nextLevel(current, target, maximum) {
  if (!worthMoving(current, target, maximum)) return null
  var step = Math.max(1, Math.round(maximum * 0.05))
  return current + clamp(target - current, -step, step)
}

// A held manual level lasts until the room's light changes clearly: half or
// double the reading it was set at (with some slack near darkness).
function lightChanged(holdLux, lux) {
  return lux < holdLux / 2 - 2 || lux > holdLux * 2 + 10
}

// What a manual change teaches. Returns { darkPercent } when it can be learned
// as a new preference for the whole curve, or { hold: true } when the curve
// cannot express it: the keys were switched off, the room is too bright, or
// the level would need a "Level in the dark" outside its range.
function learnFromManual(level, maximum, lux, settings) {
  var fraction = maximum > 0 ? level / maximum : 0
  var base = targetFraction(lux, settings.darkPercent, settings.offLux)
  if (fraction <= 0 || base < learnFloor) return { hold: true }
  var required = settings.darkPercent * fraction / base
  if (required < limits.darkPercent[0] - 0.5 || required > limits.darkPercent[1] + 0.5) return { hold: true }
  var learned = Math.round(clamp(required, limits.darkPercent[0], limits.darkPercent[1]))
  return { darkPercent: learned }
}

// Ambient light outside this range is a sensor glitch, not a room.
var maxPlausibleLux = 200000

// Parses one JSON line from the probe helper.
function parseProbe(text) {
  try {
    var data = JSON.parse(String(text || ""))
    if (!data || typeof data !== "object") return null
    var maximum = numberOr(data.max, 0)
    var brightness = numberOr(data.brightness, -1)
    // A level that is not a whole number within range means no usable LED.
    if (Math.floor(maximum) !== maximum || maximum <= 0) maximum = 0
    if (Math.floor(brightness) !== brightness || brightness < 0 || brightness > maximum) brightness = -1
    var lux = data.lux === null || data.lux === undefined ? null : numberOr(data.lux, null)
    if (lux !== null && (lux < 0 || lux > maxPlausibleLux)) lux = null
    return {
      led: String(data.led || ""),
      brightness: brightness,
      maximum: maximum,
      lux: lux,
      sensor: String(data.sensor || ""),
      awake: data.awake === true
    }
  } catch (error) {
    return null
  }
}

function initialState() {
  return { last: null, filtered: null, awakeBefore: false, target: null,
           holdLux: null, dimmed: false, restoreLevel: null }
}

// Advances the automation by one tick.
//   state    what the previous tick knew (see initialState)
//   probe    parsed probe output
//   settings normalized settings
//   idle     true while the user has been inactive for idleOffSeconds
// Returns the next state plus:
//   set      level to write, or null
//   fade     true when the change should fade rather than step
//   learn    { darkPercent } to save as the new preference, or null
//   status   auto | hold | manual | idle | off | asleep | no-backlight
//            (the service may report error-read or error-write instead)
function tick(state, probe, settings, idle) {
  var s = state || initialState()
  var next = {
    last: s.last, filtered: s.filtered, awakeBefore: s.awakeBefore === true,
    target: s.target === undefined ? null : s.target,
    holdLux: s.holdLux === undefined ? null : s.holdLux,
    dimmed: s.dimmed === true,
    restoreLevel: s.restoreLevel === undefined ? null : s.restoreLevel,
    set: null, fade: false, learn: null, status: "auto"
  }

  if (!probe || !probe.led || probe.maximum <= 0 || probe.brightness < 0) {
    next.status = "no-backlight"
    return next
  }

  var current = probe.brightness
  var maximum = probe.maximum

  if (!probe.awake) {
    // Lid closed, session locked or displays off: Omarchy owns the keys now.
    // If we had dimmed them for inactivity, Omarchy's lock saved that 0, so
    // keep restoreLevel to light them again after unlocking.
    next.last = current
    next.filtered = null
    next.awakeBefore = false
    next.holdLux = null
    next.dimmed = false
    next.status = "asleep"
    return next
  }

  if (probe.lux !== null) next.filtered = smooth(next.filtered, probe.lux)
  var hasLight = probe.lux !== null && next.filtered !== null
  var automatic = settings.enabled && hasLight

  var wokeUp = !next.awakeBefore
  if (wokeUp) {
    next.awakeBefore = true
    next.last = current
    next.holdLux = null
    var pending = next.restoreLevel
    next.restoreLevel = null
    // Without automatic lighting, bring back the level we dimmed from before
    // the lock; with it, the wake-up fade below picks the right level anyway.
    if (pending !== null && !automatic && current === 0 && pending > 0 && !(idle && settings.idleOffSeconds > 0)) {
      next.set = pending
      next.fade = true
      next.last = pending
      next.status = settings.enabled ? "manual" : "off"
      return next
    }
    if (pending !== null && current === 0) next.restoreLevel = pending
  }

  // Inactivity: fade the keys out and remember what to bring back.
  if (idle && settings.idleOffSeconds > 0) {
    if (!next.dimmed) {
      next.dimmed = true
      if (!(next.restoreLevel !== null && current === 0)) next.restoreLevel = current
      if (current > 0) {
        next.set = 0
        next.fade = true
      }
    }
    next.last = 0
    next.status = "idle"
    return next
  }

  // Back from inactivity: light the keys again at once. A brightness key that
  // woke them (Omarchy steps 0 -> 10%) means "light up", not "I want 10%", so
  // it is not learned; the keys come back no dimmer than the key asked for.
  if (next.dimmed) {
    next.dimmed = false
    var level = next.restoreLevel === null ? current : next.restoreLevel
    if (automatic && next.holdLux === null) {
      level = Math.round(maximum * targetFraction(next.filtered, settings.darkPercent, settings.offLux))
      next.target = level
    }
    if (next.last !== null && current > next.last) level = Math.max(level, current)
    next.restoreLevel = null
    next.set = level !== current ? level : null
    next.fade = next.set !== null
    next.last = level
    next.status = automatic ? (next.holdLux === null ? "auto" : "hold") : (settings.enabled ? "manual" : "off")
    return next
  }

  var manual = !wokeUp && next.last !== null && current !== next.last
  next.last = current
  if (!next.dimmed) next.restoreLevel = null

  if (!settings.enabled) {
    next.holdLux = null
    next.status = "off"
    return next
  }

  if (!hasLight) {
    // No sensor: the brightness keys set the level, inactivity still dims it.
    next.status = "manual"
    return next
  }

  if (manual) {
    var lesson = learnFromManual(current, maximum, next.filtered, settings)
    if (lesson.hold) {
      next.holdLux = next.filtered
      next.status = "hold"
      return next
    }
    next.learn = { darkPercent: lesson.darkPercent }
    next.holdLux = null
    next.target = current
    next.status = "auto"
    return next
  }

  if (next.holdLux !== null) {
    if (!lightChanged(next.holdLux, next.filtered)) {
      next.status = "hold"
      return next
    }
    next.holdLux = null
  }

  next.target = Math.round(maximum * targetFraction(next.filtered, settings.darkPercent, settings.offLux))
  if (wokeUp) {
    // After unlocking or opening the lid, fade straight to the right level
    // instead of creeping up from whatever the lock left behind.
    if (worthMoving(current, next.target, maximum)) {
      next.set = next.target
      next.fade = true
      next.last = next.target
    }
    next.status = "auto"
    return next
  }
  var stepTo = nextLevel(current, next.target, maximum)
  if (stepTo !== null) {
    next.set = stepTo
    next.last = stepTo
  }
  next.status = "auto"
  return next
}

// After a write fails: forget the level we asked for, so the failed write is
// not mistaken for a manual change, and forget that the keys were dimmed, so
// an idle fade that did not happen is tried again on the next tick.
function afterWriteFailed(state) {
  var next = {}
  for (var key in state) next[key] = state[key]
  next.last = null
  next.dimmed = false
  return next
}

// Consecutive failures after which the panel shows a problem instead of a
// normal status; one-off hiccups stay invisible.
var failuresBeforeError = 3

function errorStatus(readFailures, writeFailures) {
  if (readFailures >= failuresBeforeError) return "error-read"
  if (writeFailures >= failuresBeforeError) return "error-write"
  return null
}

// At most one warning per kind per minute in the shell log.
var warnIntervalMs = 60000

function shouldWarn(lastWarnAt, now) {
  return lastWarnAt === undefined || lastWarnAt === null || now - lastWarnAt >= warnIntervalMs
}
