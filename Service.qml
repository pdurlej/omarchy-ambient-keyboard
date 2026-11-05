import QtQuick
import Quickshell
import Quickshell.Io
import "Model.js" as Model

// Background automation: every two seconds read the ambient light sensor and
// step the keyboard backlight toward the level the curve asks for. A manual
// change (brightness keys, another tool) pauses the automation for a while.
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
  property var automation: ({ last: null, filtered: null, holdUntil: 0, awakeBefore: false, target: null })
  property var reading: null
  property string status: "starting"
  property int failures: 0
  property real clock: Date.now()

  readonly property bool autoEnabled: settings.enabled
  readonly property bool available: !!(reading && reading.led)
  readonly property bool sensorAvailable: !!(reading && reading.lux !== null)
  readonly property real lux: reading && reading.lux !== null ? reading.lux : -1
  readonly property int percent: reading && reading.maximum > 0
    ? Math.round(100 * reading.brightness / reading.maximum) : 0
  readonly property int targetPercent: reading && reading.maximum > 0 && automation.target !== null
    ? Math.round(100 * automation.target / reading.maximum) : -1
  readonly property int pausedSeconds: status === "paused"
    ? Math.max(0, Math.ceil((automation.holdUntil - clock) / 1000)) : 0

  function saveSettings(changes) {
    var next = Object.assign({}, settings, changes)
    settings = Model.normalizeSettings(next)
    var entry = Object.assign({ id: root.pluginId }, settings)
    if (root.shell && typeof root.shell.updateEntryInline === "function")
      root.shell.updateEntryInline(root.pluginId, entry)
  }

  function setEnabled(value) { saveSettings({ enabled: value === true }) }
  function setDarkPercent(value) { saveSettings({ darkPercent: value }) }
  function setOffLux(value) { saveSettings({ offLux: value }) }
  function setManualHoldSeconds(value) { saveSettings({ manualHoldSeconds: value }) }

  // Hand control back to the automation right away.
  function resume() {
    automation = Object.assign({}, automation, { holdUntil: 0 })
    poll()
  }

  function poll() {
    if (!probeProcess.running) probeProcess.running = true
  }

  function apply(probe) {
    clock = Date.now()
    var result = Model.tick(automation, probe, settings, clock)
    reading = probe
    status = result.status
    automation = {
      last: result.last,
      filtered: result.filtered,
      holdUntil: result.holdUntil,
      awakeBefore: result.awakeBefore,
      target: result.target
    }
    if (result.set !== null && !setProcess.running) {
      setProcess.command = ["brightnessctl", "-q", "-d", probe.led, "set", String(result.set)]
      setProcess.running = true
    }
  }

  FileView {
    id: shellConfig
    path: root.shellConfigPath
    watchChanges: true
    printErrors: false
    onLoaded: root.settings = Model.normalizeSettings(Model.entryFromShellConfig(text(), root.pluginId))
    onFileChanged: Qt.callLater(reload)
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
  }

  Process {
    id: setProcess
    onExited: function(exitCode) {
      if (exitCode !== 0) {
        // Forget the level we asked for, so the failed write is not mistaken
        // for a manual change on the next tick.
        root.automation = Object.assign({}, root.automation, { last: null })
        console.warn(root.pluginId + ": brightnessctl could not set the keyboard backlight")
      }
    }
  }

  Timer {
    interval: 2000
    running: true
    repeat: true
    triggeredOnStart: true
    onTriggered: root.poll()
  }

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
        pausedSeconds: root.pausedSeconds,
        settings: root.settings
      })
    }
    function enable(): void { root.setEnabled(true) }
    function disable(): void { root.setEnabled(false) }
    function toggle(): void { root.setEnabled(!root.autoEnabled) }
    function resume(): void { root.resume() }
    function setDarkPercent(value: int): void { root.setDarkPercent(value) }
    function setOffLux(value: int): void { root.setOffLux(value) }
  }
}
