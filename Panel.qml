import QtQuick
import qs.Commons
import qs.Commons as Commons
import qs.Ui
import "Model.js" as Model

// Optional bar button: left click opens the panel, right click turns the
// automation on or off. The automation itself runs in Service.qml, so it keeps
// working without this widget on the bar.
//
// Keyboard: Up/Down (or j/k) pick a row, Left/Right (or h/l) change it,
// Enter toggles automatic or resumes, Escape closes.
Panel {
  id: root
  moduleName: "pdurlej.ambient-keyboard"
  ipcTarget: "pdurlej.ambient-keyboard.panel"

  readonly property var service: bar && bar.shell ? bar.shell.serviceFor("pdurlej.ambient-keyboard") : null
  readonly property bool autoEnabled: !!(service && service.autoEnabled)
  readonly property var current: service ? service.settings : Model.normalizeSettings(null)
  readonly property bool holding: !!service && service.status === "hold"
  readonly property string glyph: "󰌌"

  // Keyboard cursor: 0 automatic, 1 dark level, 2 off above, 3 idle, 4 resume.
  property int cursorRow: -1
  readonly property int rowCount: holding ? 5 : 4

  Commons.Translations { id: strings; directory: Qt.resolvedUrl("i18n") }

  onOpenedChanged: if (!opened) cursorRow = -1

  function statusText() {
    if (!service) return strings.t("status.starting")
    switch (service.status) {
    case "auto": return strings.t("status.auto")
    case "hold": return strings.t("status.hold")
    case "manual": return strings.t("status.manual")
    case "idle": return strings.t("status.idle")
    case "off": return strings.t("status.off")
    case "asleep": return strings.t("status.asleep")
    case "no-backlight": return strings.t("status.noBacklight")
    default: return strings.t("status.starting")
    }
  }

  function luxText(value) {
    return value < 0 ? "—" : strings.t("lux").arg(Commons.I18n.formatNumber(Math.round(value)))
  }

  function percentText(value) {
    return value < 0 ? "—" : Commons.I18n.formatNumber(value) + "%"
  }

  function idleText(seconds) {
    if (seconds <= 0) return strings.t("idle.never")
    if (seconds < 60) return strings.t("idle.seconds").arg(Commons.I18n.formatNumber(seconds))
    return strings.t("idle.minutes").arg(Commons.I18n.formatNumber(Math.round(seconds / 60)))
  }

  function idleIndex(seconds) {
    var best = 0
    for (var i = 0; i < Model.idleStops.length; i++)
      if (Math.abs(Model.idleStops[i] - seconds) < Math.abs(Model.idleStops[best] - seconds)) best = i
    return best
  }

  function toggleAuto() {
    if (service) service.setEnabled(!autoEnabled)
  }

  function adjust(row, direction) {
    if (!service) return
    if (row === 0) toggleAuto()
    else if (row === 1) service.setDarkPercent(current.darkPercent + 5 * direction)
    else if (row === 2) service.setOffLux(current.offLux + 10 * direction)
    else if (row === 3) {
      var index = Math.max(0, Math.min(Model.idleStops.length - 1, idleIndex(current.idleOffSeconds) + direction))
      service.setIdleOffSeconds(Model.idleStops[index])
    }
  }

  function activate(row) {
    if (row === 0) toggleAuto()
    else if (row === 4 && service) service.resume()
  }

  implicitWidth: button.implicitWidth
  implicitHeight: button.implicitHeight

  BarIconButton {
    id: button
    anchors.fill: parent
    bar: root.bar
    text: root.glyph
    opacity: root.autoEnabled ? 1 : 0.5
    tooltipText: ""
    onPressed: function(b) {
      if (b === Qt.RightButton) root.toggleAuto()
      else root.toggle()
    }
  }

  KeyboardPanel {
    id: panel
    anchorItem: button
    owner: root
    bar: root.bar
    open: root.opened
    focusTarget: panel.loadedContent
    contentWidth: panel.fittedContentWidth(Style.space(360))
    contentHeight: panel.fittedContentHeight(panel.loadedContentHeight)

    content: PanelKeyCatcher {
      anchors.fill: parent
      implicitHeight: column.implicitHeight
      onCloseRequested: root.close()
      onTabRequested: function(direction) { root.switchPanel(direction) }
      onActivateRequested: if (root.cursorRow >= 0) root.activate(root.cursorRow)
      onMoveRequested: function(dx, dy) {
        if (root.cursorRow < 0) { root.cursorRow = 0; return }
        if (dy !== 0) root.cursorRow = Math.max(0, Math.min(root.rowCount - 1, root.cursorRow + dy))
        else if (dx !== 0) root.adjust(root.cursorRow, dx)
      }

      Column {
        id: column
        anchors.left: parent.left
        anchors.right: parent.right
        anchors.top: parent.top
        spacing: Style.space(14)

        // Hero: icon, title and status, current level.
        Item {
          width: parent.width
          implicitHeight: Math.max(heroIcon.implicitHeight, heroLabels.implicitHeight, heroLevel.implicitHeight)

          Text {
            id: heroIcon
            textFormat: Text.PlainText
            text: root.glyph
            color: root.bar.foreground
            opacity: root.autoEnabled ? 1 : 0.5
            font.family: root.bar.fontFamily
            font.pixelSize: Style.font.display
            anchors.left: parent.left
            anchors.verticalCenter: parent.verticalCenter
          }

          Column {
            id: heroLabels
            anchors.left: heroIcon.right
            anchors.leftMargin: Style.space(14)
            anchors.right: heroLevel.left
            anchors.rightMargin: Style.space(10)
            anchors.verticalCenter: parent.verticalCenter
            spacing: Style.space(2)

            Text {
              textFormat: Text.PlainText
              text: strings.t("title")
              color: root.bar.foreground
              font.family: root.bar.fontFamily
              font.pixelSize: Style.font.title
              font.bold: true
              elide: Text.ElideRight
              width: parent.width
            }

            Text {
              textFormat: Text.PlainText
              text: root.statusText().toUpperCase()
              color: Qt.darker(root.bar.foreground, 1.4)
              font.family: root.bar.fontFamily
              font.pixelSize: Style.font.caption
              font.bold: true
              font.letterSpacing: 1.2
              elide: Text.ElideRight
              width: parent.width
            }
          }

          Text {
            id: heroLevel
            textFormat: Text.PlainText
            text: root.percentText(root.service ? root.service.percent : -1)
            color: root.bar.foreground
            font.family: root.bar.fontFamily
            font.pixelSize: Style.font.displayLarge
            font.bold: true
            anchors.right: parent.right
            anchors.verticalCenter: parent.verticalCenter
          }
        }

        InfoPair {
          width: parent.width
          label: strings.t("ambientLight")
          value: root.service && root.service.sensorAvailable ? root.luxText(root.service.lux) : strings.t("noSensor")
        }

        Toggle {
          width: parent.width
          label: strings.t("automatic")
          description: root.service && !root.service.sensorAvailable && root.service.available
            ? strings.t("automaticNoSensor") : strings.t("automaticDescription")
          checked: root.autoEnabled
          hasCursor: root.cursorRow === 0
          foreground: root.bar.foreground
          fontFamily: root.bar.fontFamily
          onClicked: root.toggleAuto()
          onHovered: function(h) { if (h) root.cursorRow = 0 }
        }

        PanelSeparator { foreground: root.bar.foreground }

        SliderRow {
          row: 1
          enabledRow: !root.service || root.service.sensorAvailable
          label: strings.t("darkLevel")
          valueText: root.percentText(root.current.darkPercent)
          minimum: 5
          maximum: 100
          step: 5
          value: root.current.darkPercent
          onCommitted: function(v) { if (root.service) root.service.setDarkPercent(v) }
        }

        SliderRow {
          row: 2
          enabledRow: !root.service || root.service.sensorAvailable
          label: strings.t("offAbove")
          valueText: root.luxText(root.current.offLux)
          minimum: 20
          maximum: 500
          step: 10
          value: root.current.offLux
          onCommitted: function(v) { if (root.service) root.service.setOffLux(v) }
        }

        SliderRow {
          row: 3
          label: strings.t("idleOff")
          valueText: root.idleText(root.current.idleOffSeconds)
          minimum: 0
          maximum: Model.idleStops.length - 1
          step: 1
          ticks: Model.idleStops.length
          value: root.idleIndex(root.current.idleOffSeconds)
          onCommitted: function(v) {
            if (root.service) root.service.setIdleOffSeconds(Model.idleStops[Math.round(v)])
          }
        }

        Text {
          width: parent.width
          textFormat: Text.PlainText
          wrapMode: Text.WordWrap
          text: strings.t("keysHint")
          color: root.bar.foreground
          opacity: 0.6
          font.family: root.bar.fontFamily
          font.pixelSize: Style.font.caption
        }

        Button {
          visible: root.holding
          width: parent.width
          text: strings.t("resume")
          fontSize: Style.font.bodySmall
          foreground: root.bar.foreground
          fontFamily: root.bar.fontFamily
          bordered: true
          hasCursor: root.cursorRow === 4
          onClicked: if (root.service) root.service.resume()
        }
      }
    }
  }

  component SliderRow: Item {
    id: sliderRow
    property int row: -1
    property bool enabledRow: true
    property string label: ""
    property string valueText: ""
    property real minimum: 0
    property real maximum: 1
    property real step: 1
    property int ticks: 0
    property real value: 0
    readonly property bool focused: root.cursorRow === row
    signal committed(real value)

    width: parent.width
    implicitHeight: sliderColumn.implicitHeight + Style.space(8)
    opacity: enabledRow ? 1 : 0.45

    Rectangle {
      anchors.fill: parent
      anchors.leftMargin: -Style.space(6)
      anchors.rightMargin: -Style.space(6)
      radius: Style.cornerRadius > 0 ? Style.space(6) : 0
      color: Qt.rgba(root.bar.foreground.r, root.bar.foreground.g, root.bar.foreground.b, 0.08)
      visible: sliderRow.focused
    }

    HoverHandler { onHoveredChanged: if (hovered) root.cursorRow = sliderRow.row }

    Column {
      id: sliderColumn
      anchors.left: parent.left
      anchors.right: parent.right
      anchors.verticalCenter: parent.verticalCenter
      spacing: Style.space(6)

      InfoPair { width: parent.width; label: sliderRow.label; value: sliderRow.valueText }

      PanelSlider {
        width: parent.width
        height: Style.spacing.controlHeight * 0.6
        bar: root.bar
        enabled: sliderRow.enabledRow
        minimum: sliderRow.minimum
        maximum: sliderRow.maximum
        step: sliderRow.step
        tickCount: sliderRow.ticks
        integer: true
        value: sliderRow.value
        onReleased: function(v) { sliderRow.committed(Math.round(v)) }
      }
    }
  }

  component InfoPair: Item {
    property string label: ""
    property string value: ""
    implicitHeight: Math.max(labelText.implicitHeight, valueText.implicitHeight)

    Text {
      id: labelText
      anchors.left: parent.left
      textFormat: Text.PlainText
      text: parent.label
      color: root.bar.foreground
      opacity: 0.6
      font.family: root.bar.fontFamily
      font.pixelSize: Style.font.bodySmall
    }
    Text {
      id: valueText
      anchors.right: parent.right
      textFormat: Text.PlainText
      text: parent.value
      color: root.bar.foreground
      font.family: root.bar.fontFamily
      font.pixelSize: Style.font.bodySmall
    }
  }
}
