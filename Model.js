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

// One step toward the target, at most 5% of the range per tick. Returns null
// when the difference is too small to bother changing.
function nextLevel(current, target, maximum) {
  if (Math.abs(target - current) < 3) return null
  var step = Math.max(1, Math.round(maximum * 0.05))
  return current + clamp(target - current, -step, step)
}

// A held manual level lasts until the room's light changes clearly: half or
// double the reading it was set at (with some slack near darkness).
function lightChanged(holdLux, lux) {
  return lux < holdLux / 2 - 2 || lux > holdLux * 2 + 10
}

// What a manual change teaches. Returns { darkPercent } when it can be learned
// as a new preference for the whole curve, or { hold: true } when the room is
// too bright for the curve to express it, or the keys were switched off.
function learnFromManual(level, maximum, lux, settings) {
  var fraction = maximum > 0 ? level / maximum : 0
  var base = targetFraction(lux, settings.darkPercent, settings.offLux)
  if (fraction <= 0 || base < learnFloor) return { hold: true }
  var learned = Math.round(clamp(settings.darkPercent * fraction / base, limits.darkPercent[0], limits.darkPercent[1]))
  return { darkPercent: learned }
}

// Parses one JSON line from the probe helper.
function parseProbe(text) {
  try {
    var data = JSON.parse(String(text || ""))
    if (!data || typeof data !== "object") return null
    return {
      led: String(data.led || ""),
      brightness: numberOr(data.brightness, -1),
      maximum: numberOr(data.max, 0),
      lux: data.lux === null || data.lux === undefined ? null : numberOr(data.lux, null),
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
    next.last = current
    next.filtered = null
    next.awakeBefore = false
    next.holdLux = null
    next.dimmed = false
    next.restoreLevel = null
    next.status = "asleep"
    return next
  }

  var wokeUp = !next.awakeBefore
  if (wokeUp) {
    next.awakeBefore = true
    next.last = current
    next.holdLux = null
  }

  if (probe.lux !== null) next.filtered = smooth(next.filtered, probe.lux)
  var hasLight = probe.lux !== null && next.filtered !== null
  var automatic = settings.enabled && hasLight

  // Inactivity: fade the keys out and remember what to bring back.
  if (idle && settings.idleOffSeconds > 0) {
    if (!next.dimmed) {
      next.dimmed = true
      next.restoreLevel = current
      if (current > 0) {
        next.set = 0
        next.fade = true
      }
    }
    next.last = 0
    next.status = "idle"
    return next
  }

  // Back from inactivity: light the keys again at once.
  if (next.dimmed) {
    next.dimmed = false
    var level = next.restoreLevel === null ? current : next.restoreLevel
    if (automatic && next.holdLux === null) {
      level = Math.round(maximum * targetFraction(next.filtered, settings.darkPercent, settings.offLux))
      next.target = level
    }
    next.restoreLevel = null
    next.set = level !== current ? level : null
    next.fade = next.set !== null
    next.last = level
    next.status = automatic ? (next.holdLux === null ? "auto" : "hold") : (settings.enabled ? "manual" : "off")
    return next
  }

  var manual = !wokeUp && next.last !== null && current !== next.last
  next.last = current

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
    if (Math.abs(next.target - current) >= 3) {
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
