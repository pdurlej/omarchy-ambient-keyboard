import QtQuick
import qs.Commons
import qs.Commons as Commons
import qs.Ui

// Optional bar button: left click opens the panel, right click turns the
// automation on or off. The automation itself runs in Service.qml, so it keeps
// working without this widget on the bar.
Panel {
  id: root
  moduleName: "pdurlej.ambient-keyboard"
  ipcTarget: "pdurlej.ambient-keyboard.panel"

  readonly property var service: bar && bar.shell ? bar.shell.serviceFor("pdurlej.ambient-keyboard") : null
  readonly property bool autoEnabled: !!(service && service.autoEnabled)
  readonly property string glyph: "󰌌"

  Commons.Translations { id: strings; directory: Qt.resolvedUrl("i18n") }

  function statusText() {
    if (!service) return strings.t("status.starting")
    switch (service.status) {
    case "auto": return strings.t("status.auto")
    case "paused": return strings.t("status.paused").arg(Commons.I18n.formatNumber(service.pausedSeconds))
    case "off": return strings.t("status.off")
    case "asleep": return strings.t("status.asleep")
    case "no-sensor": return strings.t("status.noSensor")
    case "no-backlight": return strings.t("status.noBacklight")
    default: return strings.t("status.starting")
    }
  }

  function luxText() {
    if (!service || service.lux < 0) return "—"
    return strings.t("lux").arg(Commons.I18n.formatNumber(Math.round(service.lux)))
  }

  function percentText(value) {
    return value < 0 ? "—" : Commons.I18n.formatNumber(value) + "%"
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
      if (b === Qt.RightButton) {
        if (root.service) root.service.setEnabled(!root.autoEnabled)
      } else {
        root.toggle()
      }
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
      onActivateRequested: if (root.service) root.service.setEnabled(!root.autoEnabled)
      onTabRequested: function(direction) { root.switchPanel(direction) }

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

        Row {
          width: parent.width
          spacing: Style.space(20)

          InfoPair {
            width: (parent.width - parent.spacing) / 2
            label: strings.t("ambientLight")
            value: root.luxText()
          }
          InfoPair {
            width: (parent.width - parent.spacing) / 2
            label: strings.t("target")
            value: root.percentText(root.service ? root.service.targetPercent : -1)
          }
        }

        Toggle {
          width: parent.width
          label: strings.t("automatic")
          description: strings.t("automaticDescription")
          checked: root.autoEnabled
          foreground: root.bar.foreground
          fontFamily: root.bar.fontFamily
          onClicked: if (root.service) root.service.setEnabled(!root.autoEnabled)
        }

        PanelSeparator { foreground: root.bar.foreground }

        SliderRow {
          label: strings.t("darkLevel")
          valueText: root.percentText(root.service ? root.service.settings.darkPercent : -1)
          minimum: 5
          maximum: 100
          step: 5
          value: root.service ? root.service.settings.darkPercent : 35
          onCommitted: function(v) { if (root.service) root.service.setDarkPercent(v) }
        }

        SliderRow {
          label: strings.t("offAbove")
          valueText: root.service
            ? strings.t("lux").arg(Commons.I18n.formatNumber(root.service.settings.offLux)) : "—"
          minimum: 20
          maximum: 500
          step: 10
          value: root.service ? root.service.settings.offLux : 150
          onCommitted: function(v) { if (root.service) root.service.setOffLux(v) }
        }

        Button {
          visible: !!root.service && root.service.status === "paused"
          width: parent.width
          text: strings.t("resume")
          fontSize: Style.font.bodySmall
          foreground: root.bar.foreground
          fontFamily: root.bar.fontFamily
          bordered: true
          onClicked: root.service.resume()
        }
      }
    }
  }

  component SliderRow: Column {
    id: sliderRow
    property string label: ""
    property string valueText: ""
    property real minimum: 0
    property real maximum: 1
    property real step: 1
    property real value: 0
    signal committed(real value)

    width: parent.width
    spacing: Style.space(6)

    InfoPair { width: parent.width; label: sliderRow.label; value: sliderRow.valueText }

    PanelSlider {
      width: parent.width
      height: Style.spacing.controlHeight * 0.6
      bar: root.bar
      minimum: sliderRow.minimum
      maximum: sliderRow.maximum
      step: sliderRow.step
      integer: true
      value: sliderRow.value
      onReleased: function(v) { sliderRow.committed(Math.round(v)) }
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
