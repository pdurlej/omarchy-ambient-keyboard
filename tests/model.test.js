// Run with: node tests/model.test.js
const fs = require("fs")
const path = require("path")
const assert = require("assert")

const source = fs.readFileSync(path.join(__dirname, "..", "Model.js"), "utf8").replace(/^\.pragma library\s*/, "")
const Model = new Function(source + "\nreturn { afterWriteFailed, errorStatus, shouldWarn, defaults, idleStops, normalizeSettings, entryFromShellConfig, targetFraction, smooth, nextLevel, lightChanged, learnFromManual, parseProbe, initialState, tick }")()

let passed = 0
function test(name, fn) {
  fn()
  passed += 1
  console.log("ok - " + name)
}
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, a + " != " + b)

const settings = Model.normalizeSettings(null)
const probe = (brightness, lux, awake = true) => ({ led: "kbd", brightness, maximum: 255, lux, sensor: "als", awake })
// A state that has already seen one awake tick at the given level and light.
const settled = (level, lux) => Object.assign(Model.initialState(), { awakeBefore: true, last: level, filtered: lux })

test("default curve matches the original hand-tuned points", () => {
  near(Model.targetFraction(0, 35, 150), 0.35)
  near(Model.targetFraction(20, 35, 150), 0.30)
  near(Model.targetFraction(60, 35, 150), 0.15)
  near(Model.targetFraction(150, 35, 150), 0)
  near(Model.targetFraction(400, 35, 150), 0)
  near(Model.targetFraction(10, 35, 150), 0.325)
})

test("curve scales with settings", () => {
  near(Model.targetFraction(0, 70, 300), 0.70)
  near(Model.targetFraction(300, 70, 300), 0)
  near(Model.targetFraction(-5, 35, 150), 0.35)
})

test("settings are normalized and clamped", () => {
  assert.deepStrictEqual(Model.normalizeSettings(null), { enabled: true, darkPercent: 35, offLux: 150, idleOffSeconds: 60 })
  assert.deepStrictEqual(Model.normalizeSettings({ enabled: false, darkPercent: 500, offLux: "x", idleOffSeconds: -3 }),
    { enabled: false, darkPercent: 100, offLux: 150, idleOffSeconds: 0 })
})

test("plugin entry is found on the bar first, then in plugins", () => {
  const text = JSON.stringify({ plugins: [{ id: "other" }, { id: "pdurlej.ambient-keyboard", darkPercent: 50 }] })
  assert.strictEqual(Model.entryFromShellConfig(text, "pdurlej.ambient-keyboard").darkPercent, 50)
  assert.strictEqual(Model.entryFromShellConfig("not json", "x"), null)
  const onBar = JSON.stringify({
    bar: { layout: { right: [{ id: "omarchy.clock" }, { id: "pdurlej.ambient-keyboard", enabled: false }] } },
    plugins: [{ id: "pdurlej.ambient-keyboard", enabled: true }]
  })
  assert.strictEqual(Model.entryFromShellConfig(onBar, "pdurlej.ambient-keyboard").enabled, false)
})

test("steps are limited to 5% of the range", () => {
  assert.strictEqual(Model.nextLevel(0, 100, 255), 13)
  assert.strictEqual(Model.nextLevel(100, 0, 255), 87)
  assert.strictEqual(Model.nextLevel(50, 52, 255), null)
})

test("probe output parses, including a missing sensor", () => {
  const p = Model.parseProbe('{"led":"smc::kbd_backlight","brightness":84,"max":255,"lux":12,"sensor":"acpi-als","awake":true}')
  assert.strictEqual(p.maximum, 255)
  assert.strictEqual(p.lux, 12)
  assert.strictEqual(Model.parseProbe('{"led":"x","brightness":1,"max":3,"lux":null,"awake":true}').lux, null)
  assert.strictEqual(Model.parseProbe("garbage"), null)
})

test("on start it fades straight to the right level", () => {
  const r = Model.tick(Model.initialState(), probe(0, 0), settings, false)
  assert.strictEqual(r.status, "auto")
  assert.strictEqual(r.target, 89)
  assert.strictEqual(r.set, 89)
  assert.strictEqual(r.fade, true)
})

test("later changes in light move in small steps", () => {
  const r = Model.tick(settled(89, 0), probe(89, 150), settings, false)
  assert.strictEqual(r.status, "auto")
  assert.strictEqual(r.set, 76)
  assert.strictEqual(r.fade, false)
})

test("our own change is not mistaken for a manual one", () => {
  const first = Model.tick(settled(89, 0), probe(89, 150), settings, false)
  const second = Model.tick(first, probe(first.set, 150), settings, false)
  assert.strictEqual(second.learn, null)
  assert.strictEqual(second.status, "auto")
})

test("brightness keys teach a new preference instead of being undone", () => {
  // Dark room, keys at 35%; the user presses F6 up to 50%.
  const before = settled(89, 0)
  const r = Model.tick(before, probe(128, 0), settings, false)
  assert.strictEqual(r.status, "auto")
  assert.strictEqual(r.set, null)
  assert.deepStrictEqual(r.learn, { darkPercent: 50 })
  // With the learned preference, the next tick keeps the user's level.
  const learned = Object.assign({}, settings, r.learn)
  const after = Model.tick(r, probe(128, 0), learned, false)
  assert.strictEqual(after.set, null)
  assert.strictEqual(after.learn, null)
})

test("a learned preference carries to other light levels", () => {
  const r = Model.tick(settled(89, 0), probe(128, 0), settings, false)
  const learned = Object.assign({}, settings, r.learn)
  near(Model.targetFraction(60, learned.darkPercent, learned.offLux), 0.5 * 3 / 7)
})

test("switching the keys off is held until the room changes", () => {
  const r = Model.tick(settled(89, 10), probe(0, 10), settings, false)
  assert.strictEqual(r.status, "hold")
  assert.strictEqual(r.learn, null)
  const same = Model.tick(r, probe(0, 12), settings, false)
  assert.strictEqual(same.status, "hold")
  assert.strictEqual(same.set, null)
  // The room gets dark: the hold ends and the keys come back on their own.
  let s = same, level = 0
  for (let i = 0; i < 6; i++) {
    s = Model.tick(s, probe(level, 0), settings, false)
    if (s.set !== null) level = s.set
  }
  assert.strictEqual(s.holdLux, null)
  assert.strictEqual(s.status, "auto")
  assert.ok(level > 0)
})

test("turning the keys on in daylight is held, not learned", () => {
  const r = Model.tick(settled(0, 400), probe(100, 400), settings, false)
  assert.strictEqual(r.status, "hold")
  assert.strictEqual(r.learn, null)
  assert.strictEqual(Model.tick(r, probe(100, 380), settings, false).set, null)
})

test("inactivity fades the keys out and typing brings them back", () => {
  const idle = Model.tick(settled(89, 0), probe(89, 0), settings, true)
  assert.strictEqual(idle.status, "idle")
  assert.strictEqual(idle.set, 0)
  assert.strictEqual(idle.fade, true)
  const still = Model.tick(idle, probe(0, 0), settings, true)
  assert.strictEqual(still.set, null)
  const back = Model.tick(still, probe(0, 0), settings, false)
  assert.strictEqual(back.set, 89)
  assert.strictEqual(back.fade, true)
  assert.strictEqual(back.learn, null)
  const next = Model.tick(back, probe(89, 0), settings, false)
  assert.strictEqual(next.learn, null)
  assert.strictEqual(next.set, null)
})

test("inactivity off can be disabled", () => {
  const r = Model.tick(settled(89, 0), probe(89, 0), Object.assign({}, settings, { idleOffSeconds: 0 }), true)
  assert.notStrictEqual(r.status, "idle")
  assert.strictEqual(r.set, null)
})

test("without a sensor the keys are manual but still dim when idle", () => {
  const manual = Model.tick(settled(120, null), probe(120, null), settings, false)
  assert.strictEqual(manual.status, "manual")
  assert.strictEqual(manual.set, null)
  const pressed = Model.tick(manual, probe(150, null), settings, false)
  assert.strictEqual(pressed.status, "manual")
  assert.strictEqual(pressed.learn, null)
  const idle = Model.tick(pressed, probe(150, null), settings, true)
  assert.strictEqual(idle.set, 0)
  const back = Model.tick(idle, probe(0, null), settings, false)
  assert.strictEqual(back.set, 150)
})

test("asleep and disabled leave the backlight alone", () => {
  const asleep = Model.tick(settled(80, 0), probe(80, 0, false), settings, false)
  assert.strictEqual(asleep.status, "asleep")
  assert.strictEqual(asleep.set, null)
  const off = Model.tick(settled(80, 0), probe(120, 0), Object.assign({}, settings, { enabled: false }), false)
  assert.strictEqual(off.status, "off")
  assert.strictEqual(off.set, null)
  assert.strictEqual(off.learn, null)
})

test("unlocking does not count as a manual change and restores the level", () => {
  const asleep = Model.tick(settled(89, 0), probe(0, 0, false), settings, false)
  const awake = Model.tick(asleep, probe(0, 0), settings, false)
  assert.strictEqual(awake.learn, null)
  assert.strictEqual(awake.status, "auto")
  assert.strictEqual(awake.set, 89)
})

test("no backlight is reported, not acted on", () => {
  assert.strictEqual(Model.tick(Model.initialState(), { led: "", brightness: -1, maximum: 0, lux: 5, awake: true }, settings, false).status, "no-backlight")
})

// Regression tests for the red-team review of 0.10.0-beta.1.

const tiny = (brightness, lux, awake = true) => ({ led: "kbd", brightness, maximum: 3, lux, sensor: "als", awake })

test("keyboards with three levels reach their target on start", () => {
  const r = Model.tick(Model.initialState(), tiny(0, 0), settings, false)
  assert.strictEqual(r.target, 1)
  assert.strictEqual(r.set, 1)
})

test("keyboards with three levels switch off in daylight", () => {
  const r = Model.tick(settled(2, 400), tiny(2, 400), settings, false)
  assert.strictEqual(r.target, 0)
  assert.strictEqual(r.set, 1)
  const again = Model.tick(r, tiny(1, 400), settings, false)
  assert.strictEqual(again.set, 0)
})

test("a brightness key that wakes dark keys lights them, without learning", () => {
  const idle = Model.tick(settled(120, 0), probe(120, 0), settings, true)
  assert.strictEqual(idle.set, 0)
  // F6 wakes the keys: Omarchy steps 0 -> 25. That means "light up", so the
  // keys return to the room's level and nothing is learned.
  const pressed = Model.tick(idle, probe(25, 0), settings, false)
  assert.strictEqual(pressed.set, 89)
  assert.strictEqual(pressed.learn, null)
  assert.strictEqual(pressed.dimmed, false)
  // Without a sensor, a key press brighter than the old level is kept.
  const dark = Model.tick(settled(20, null), probe(20, null), settings, true)
  const up = Model.tick(dark, probe(25, null), settings, false)
  assert.strictEqual(up.set, null)
  assert.strictEqual(up.last, 25)
})

test("a level the curve cannot reach is held, not half-learned", () => {
  const atSixty = Math.round(255 * Model.targetFraction(60, 35, 150))
  const r = Model.tick(settled(atSixty, 60), probe(200, 60), settings, false)
  assert.strictEqual(r.learn, null)
  assert.strictEqual(r.status, "hold")
  assert.strictEqual(Model.tick(r, probe(200, 60), settings, false).set, null)
})

test("without a sensor, keys dimmed before a lock come back after unlocking", () => {
  let s = Model.tick(settled(120, null), probe(120, null), settings, true)
  assert.strictEqual(s.set, 0)
  // Omarchy's lock saves the 0 we left and restores it on unlock.
  s = Model.tick(s, probe(0, null, false), settings, false)
  s = Model.tick(s, probe(0, null, false), settings, false)
  s = Model.tick(s, probe(0, null), settings, false)
  assert.strictEqual(s.set, 120)
  assert.strictEqual(s.fade, true)
})

test("with a sensor, unlocking after idle fades to the right level", () => {
  let s = Model.tick(settled(89, 0), probe(89, 0), settings, true)
  s = Model.tick(s, probe(0, 0, false), settings, false)
  s = Model.tick(s, probe(0, 0), settings, false)
  assert.strictEqual(s.set, 89)
  assert.strictEqual(s.restoreLevel, null)
})

test("implausible sensor readings are ignored", () => {
  assert.strictEqual(Model.parseProbe('{"led":"k","brightness":10,"max":255,"lux":1e12,"awake":true}').lux, null)
  assert.strictEqual(Model.parseProbe('{"led":"k","brightness":10,"max":255,"lux":-4,"awake":true}').lux, null)
  assert.strictEqual(Model.parseProbe('{"led":"k","brightness":300,"max":255,"lux":4,"awake":true}').brightness, -1)
  assert.strictEqual(Model.parseProbe('{"led":"k","brightness":1.5,"max":255,"lux":4,"awake":true}').brightness, -1)
  // A glitch does not disturb the smoothed reading.
  const s = Model.tick(settled(89, 0), Model.parseProbe('{"led":"k","brightness":89,"max":255,"lux":1e12,"awake":true}'), settings, false)
  assert.strictEqual(s.filtered, 0)
})

test("a failed idle fade is retried on the next tick", () => {
  const idle = Model.tick(settled(89, 0), probe(89, 0), settings, true)
  assert.strictEqual(idle.set, 0)
  // brightnessctl failed: the keys are still at 89.
  const failed = Model.afterWriteFailed(idle)
  const retry = Model.tick(failed, probe(89, 0), settings, true)
  assert.strictEqual(retry.set, 0)
  assert.strictEqual(retry.restoreLevel, 89)
  // And coming back still restores the right level.
  const back = Model.tick(retry, probe(0, 0), settings, false)
  assert.strictEqual(back.set, 89)
})

test("a failed write is not mistaken for a manual change", () => {
  const step = Model.tick(settled(89, 0), probe(89, 150), settings, false)
  assert.strictEqual(step.set, 76)
  const failed = Model.afterWriteFailed(step)
  const next = Model.tick(failed, probe(89, 150), settings, false)
  assert.strictEqual(next.learn, null)
  assert.strictEqual(next.status, "auto")
  assert.strictEqual(next.set, 76)
})

test("problems show only after three failures in a row", () => {
  assert.strictEqual(Model.errorStatus(2, 2), null)
  assert.strictEqual(Model.errorStatus(3, 0), "error-read")
  assert.strictEqual(Model.errorStatus(0, 3), "error-write")
})

test("warnings are limited to one a minute", () => {
  assert.strictEqual(Model.shouldWarn(undefined, 1000), true)
  assert.strictEqual(Model.shouldWarn(1000, 30000), false)
  assert.strictEqual(Model.shouldWarn(1000, 61000), true)
})

console.log(passed + " tests passed")
