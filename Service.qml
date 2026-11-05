import QtQuick
import Quickshell
import Quickshell.Io
import Quickshell.Wayland
import "Model.js" as Model

// Background automation. Every two seconds read the light sensor and move the
// keyboard backlight toward the level the curve asks for. Brightness keys
// teach the curve instead of being undone, and the keys fade out while you
// are not typing and come back the moment you touch anything.
Item {
  id: root

  property var shell: null
  property var manifest: null

  readonly property string pluginId: (manifest && manifest.id) || "pdurlej.ambient-keyboard"
  readonly property string shellConfigPath: Quickshell.env("HOME") + "/.config/omarchy/shell.json"
  readonly property string probePath: {
    var url = String(Qt.resolvedUrl("probe"))
    return decodeURIComponent(url.indexOf("file://") === 0 ? url.substring(7) : url)
  }

  property var settings: Model.normalizeSettings(null)
  property var automation: Model.initialState()
  property var reading: null
  property string status: "starting"
  property int failures: 0
  property bool pendingPoll: false
  property bool idleRearming: false

  readonly property bool autoEnabled: settings.enabled
  readonly property bool available: !!(reading && reading.led)
  readonly property bool sensorAvailable: !!(reading && reading.lux !== null)
  readonly property real lux: reading && reading.lux !== null ? reading.lux : -1
  readonly property int percent: reading && reading.maximum > 0
    ? Math.round(100 * reading.brightness / reading.maximum) : 0
  readonly property int targetPercent: reading && reading.maximum > 0 && automation.target !== null
    ? Math.round(100 * automation.target / reading.maximum) : -1
  readonly property bool userIdle: idleMonitor.isIdle
  readonly property int idleSeconds: settings.idleOffSeconds

  // Quickshell's IdleMonitor keeps its old timeout when only `timeout`
  // changes, so switch it off and on again to apply a new one.
  onIdleSecondsChanged: {
    idleRearming = true
    Qt.callLater(function() { root.idleRearming = false })
  }

  function saveSettings(changes) {
    settings = Model.normalizeSettings(Object.assign({}, settings, changes))
    persistTimer.restart()
  }

  function persistNow() {
    var entry = Object.assign({ id: root.pluginId }, settings)
    if (root.shell && typeof root.shell.updateEntryInline === "function")
      root.shell.updateEntryInline(root.pluginId, entry)
  }

  function setEnabled(value) { saveSettings({ enabled: value === true }) }
  function setDarkPercent(value) { saveSettings({ darkPercent: value }) }
  function setOffLux(value) { saveSettings({ offLux: value }) }
  function setIdleOffSeconds(value) { saveSettings({ idleOffSeconds: value }) }

  // Forget a held manual level and follow the light again right away.
  function resume() {
    automation = Object.assign({}, automation, { holdLux: null })
    poll()
  }

  function writing() {
    return setProcess.running || fadeProcess.running
  }

  function poll() {
    // Never read while a write is in flight: a half-finished fade would look
    // like a manual change.
    if (writing() || probeProcess.running) {
      pendingPoll = true
      return
    }
    pendingPoll = false
    probeProcess.running = true
  }

  function afterWrite() {
    if (pendingPoll) Qt.callLater(poll)
  }

  function apply(probe) {
    var result = Model.tick(automation, probe, settings, root.userIdle && settings.idleOffSeconds > 0)
    reading = probe
    status = result.status
    automation = {
      last: result.last, filtered: result.filtered, awakeBefore: result.awakeBefore,
      target: result.target, holdLux: result.holdLux, dimmed: result.dimmed,
      restoreLevel: result.restoreLevel
    }
    if (result.learn) saveSettings(result.learn)
    if (result.set === null) return
    if (result.fade) {
      fadeProcess.command = ["bash", "-c", fadeScript, "fade", probe.led,
        String(probe.brightness), String(result.set)]
      fadeProcess.running = true
    } else {
      setProcess.command = ["brightnessctl", "-q", "-d", probe.led, "set", String(result.set)]
      setProcess.running = true
    }
  }

  function writeFailed() {
    // Forget the level we asked for, so the failed write is not mistaken for
    // a manual change on the next tick.
    automation = Object.assign({}, automation, { last: null })
    console.warn(root.pluginId + ": brightnessctl could not set the keyboard backlight")
  }

  // Eight short steps, about a quarter of a second in total.
  readonly property string fadeScript: "led=$1; from=$2; to=$3; " +
    "for i in 1 2 3 4 5 6 7 8; do " +
    "brightnessctl -q -d \"$led\" set $(( from + (to - from) * i / 8 )) || exit 1; " +
    "sleep 0.03; done"

  FileView {
    id: shellConfig
    path: root.shellConfigPath
    watchChanges: true
    printErrors: false
    onLoaded: {
      // Ignore our own pending write; it carries the newest values already.
      if (persistTimer.running) return
      root.settings = Model.normalizeSettings(Model.entryFromShellConfig(text(), root.pluginId))
    }
    onFileChanged: Qt.callLater(reload)
  }

  // Brightness keys repeat quickly; save the learned level once they settle.
  Timer {
    id: persistTimer
    interval: 1500
    onTriggered: root.persistNow()
  }

  IdleMonitor {
    id: idleMonitor
    enabled: root.idleSeconds > 0 && !root.idleRearming
    timeout: Math.max(1, root.idleSeconds)
    // Keys go dark while you watch a video too, like on a Mac.
    respectInhibitors: false
    onIsIdleChanged: root.poll()
  }

  Process {
    id: probeProcess
    command: [root.probePath]
    stdout: StdioCollector {
      waitForEnd: true
      onStreamFinished: {
        var probe = Model.parseProbe(text)
        if (probe) {
          root.failures = 0
          root.apply(probe)
        } else {
          root.failures += 1
          if (root.failures === 1 || root.failures % 30 === 0)
            console.warn(root.pluginId + ": could not read the backlight or light sensor")
        }
      }
    }
    onExited: root.afterWrite()
  }

  Process {
    id: setProcess
    onExited: function(exitCode) {
      if (exitCode !== 0) root.writeFailed()
      root.afterWrite()
    }
  }

  Process {
    id: fadeProcess
    onExited: function(exitCode) {
      if (exitCode !== 0) root.writeFailed()
      root.afterWrite()
    }
  }

  Timer {
    interval: 2000
    running: true
    repeat: true
    triggeredOnStart: true
    onTriggered: root.poll()
  }

  Component.onDestruction: if (persistTimer.running) root.persistNow()

  IpcHandler {
    target: "pdurlej.ambient-keyboard"

    function status(): string {
      return JSON.stringify({
        enabled: root.autoEnabled,
        status: root.status,
        led: root.reading ? root.reading.led : "",
        sensor: root.reading ? root.reading.sensor : "",
        lux: root.lux,
        percent: root.percent,
        targetPercent: root.targetPercent,
        idle: root.userIdle,
        settings: root.settings
      })
    }
    function enable(): void { root.setEnabled(true) }
    function disable(): void { root.setEnabled(false) }
    function toggle(): void { root.setEnabled(!root.autoEnabled) }
    function resume(): void { root.resume() }
    function setDarkPercent(value: int): void { root.setDarkPercent(value) }
    function setOffLux(value: int): void { root.setOffLux(value) }
    function setIdleOffSeconds(value: int): void { root.setIdleOffSeconds(value) }
  }
}
