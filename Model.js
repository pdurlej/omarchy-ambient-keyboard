.pragma library

// Pure logic for Ambient Keyboard, kept free of QML so it can be tested with
// plain Node (see tests/model.test.js).

var defaults = {
  enabled: true,
  darkPercent: 35,      // backlight level in a dark room, percent of maximum
  offLux: 150,          // ambient light at which the backlight is fully off
  manualHoldSeconds: 120 // how long a manual change pauses the automation
}

var limits = {
  darkPercent: [5, 100],
  offLux: [20, 1000],
  manualHoldSeconds: [0, 1800]
}

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
  var result = {
    enabled: source.enabled !== false,
    darkPercent: defaults.darkPercent,
    offLux: defaults.offLux,
    manualHoldSeconds: defaults.manualHoldSeconds
  }
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

// Backlight fraction (0..1) for an ambient light reading. The curve keeps the
// shape of the original hand-tuned one: gentle in the dark, falling faster in
// dim light, off once the room is bright.
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

// Advances the automation by one tick. `state` carries what the previous tick
// knew; returns the next state and, when the backlight should change, `set`.
function tick(state, probe, settings, now) {
  var next = {
    last: state.last,
    filtered: state.filtered,
    holdUntil: state.holdUntil || 0,
    awakeBefore: state.awakeBefore === true,
    set: null,
    target: state.target === undefined ? null : state.target,
    status: "idle"
  }

  if (!probe || !probe.led || probe.maximum <= 0 || probe.brightness < 0) {
    next.status = "no-backlight"
    return next
  }

  var current = probe.brightness

  if (!settings.enabled) {
    next.last = current
    next.filtered = null
    next.holdUntil = 0
    next.status = "off"
    return next
  }

  if (!probe.awake) {
    // Lid closed, session locked or displays off: leave the keys to Omarchy.
    next.last = current
    next.filtered = null
    next.awakeBefore = false
    next.status = "asleep"
    return next
  }

  if (!next.awakeBefore) {
    next.last = current
    next.holdUntil = 0
    next.awakeBefore = true
  } else if (next.last !== null && next.last !== undefined && current !== next.last) {
    next.holdUntil = now + settings.manualHoldSeconds * 1000
  }

  if (probe.lux === null) {
    next.last = current
    next.status = "no-sensor"
    return next
  }

  next.filtered = smooth(next.filtered, probe.lux)
  next.target = Math.round(probe.maximum * targetFraction(next.filtered, settings.darkPercent, settings.offLux))

  if (now < next.holdUntil) {
    next.last = current
    next.status = "paused"
    return next
  }

  var level = nextLevel(current, next.target, probe.maximum)
  next.set = level
  next.last = level === null ? current : level
  next.status = "auto"
  return next
}
