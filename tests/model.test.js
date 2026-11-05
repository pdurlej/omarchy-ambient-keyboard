// Run with: node tests/model.test.js
const fs = require("fs")
const path = require("path")
const assert = require("assert")

const source = fs.readFileSync(path.join(__dirname, "..", "Model.js"), "utf8").replace(/^\.pragma library\s*/, "")
const Model = new Function(source + "\nreturn { defaults, normalizeSettings, entryFromShellConfig, targetFraction, smooth, nextLevel, parseProbe, tick }")()

let passed = 0
function test(name, fn) {
  fn()
  passed += 1
  console.log("ok - " + name)
}
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, a + " != " + b)

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
  assert.deepStrictEqual(Model.normalizeSettings(null), { enabled: true, darkPercent: 35, offLux: 150, manualHoldSeconds: 120 })
  assert.deepStrictEqual(Model.normalizeSettings({ enabled: false, darkPercent: 500, offLux: "x", manualHoldSeconds: -3 }),
    { enabled: false, darkPercent: 100, offLux: 150, manualHoldSeconds: 0 })
})

test("plugin entry is found in shell.json", () => {
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

const settings = Model.normalizeSettings(null)
const probe = (brightness, lux, awake = true) => ({ led: "kbd", brightness, maximum: 255, lux, sensor: "als", awake })
const fresh = { last: null, filtered: null, holdUntil: 0, awakeBefore: false }

test("dark room raises the backlight one step at a time", () => {
  const r = Model.tick(fresh, probe(0, 0), settings, 1000)
  assert.strictEqual(r.status, "auto")
  assert.strictEqual(r.target, 89)
  assert.strictEqual(r.set, 13)
  assert.strictEqual(r.last, 13)
})

test("our own change is not mistaken for a manual one", () => {
  const first = Model.tick(fresh, probe(0, 0), settings, 1000)
  const second = Model.tick(first, probe(13, 0), settings, 3000)
  assert.strictEqual(second.status, "auto")
  assert.strictEqual(second.set, 26)
})

test("a manual change pauses the automation", () => {
  const first = Model.tick(fresh, probe(50, 0), settings, 1000)
  const manual = Model.tick(first, probe(200, 0), settings, 3000)
  assert.strictEqual(manual.status, "paused")
  assert.strictEqual(manual.set, null)
  assert.strictEqual(manual.holdUntil, 3000 + 120000)
  const later = Model.tick(manual, probe(200, 0), settings, 3000 + 120001)
  assert.strictEqual(later.status, "auto")
  assert.ok(later.set < 200)
})

test("asleep and disabled leave the backlight alone", () => {
  const asleep = Model.tick(fresh, probe(80, 0, false), settings, 1000)
  assert.strictEqual(asleep.status, "asleep")
  assert.strictEqual(asleep.set, null)
  const off = Model.tick(fresh, probe(80, 0), Object.assign({}, settings, { enabled: false }), 1000)
  assert.strictEqual(off.status, "off")
  assert.strictEqual(off.set, null)
})

test("waking up does not count as a manual change", () => {
  const before = Model.tick(fresh, probe(80, 0), settings, 1000)
  const asleep = Model.tick(before, probe(0, 0, false), settings, 3000)
  const awake = Model.tick(asleep, probe(120, 0), settings, 5000)
  assert.notStrictEqual(awake.status, "paused")
})

test("no sensor and no backlight are reported, not acted on", () => {
  assert.strictEqual(Model.tick(fresh, probe(80, null), settings, 1000).status, "no-sensor")
  assert.strictEqual(Model.tick(fresh, { led: "", brightness: -1, maximum: 0, lux: 5, awake: true }, settings, 1000).status, "no-backlight")
})

console.log(passed + " tests passed")
