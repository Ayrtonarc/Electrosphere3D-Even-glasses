import {
  CreateStartUpPageContainer,
  ImageContainerProperty,
  ImageRawDataUpdate,
  OsEventTypeList,
  TextContainerProperty,
  TextContainerUpgrade,
  waitForEvenAppBridge,
} from '@evenrealities/even_hub_sdk'
import { NetClient } from './net'
import { startLocation, type Fix } from './location'
import { mountUi } from './ui'
import { renderHud } from './hud'
import { renderScopePng } from './scope'
import { TrackMemory } from './track'
import type { ConnState, RadarState } from './types'

const bridge = await waitForEvenAppBridge()

// Reparto del display (576x288):
//   aviso   (0,0)     576x40    situacion
//   radar   (0,44)    200x144   imagen
//   info    (0,192)   200x48    tu avion y alcance
//   detalle (204,44)  372x196   bloqueo + contactos
//   pie     (0,244)   576x40    reloj y acciones
const alertPanel = new TextContainerProperty({
  xPosition: 0,
  yPosition: 0,
  width: 576,
  height: 40,
  borderWidth: 1,
  borderColor: 5,
  paddingLength: 4,
  containerID: 1,
  containerName: 'alert',
  content: 'CONECTANDO...',
  isEventCapture: 1,
})

const scopeImage = new ImageContainerProperty({
  xPosition: 0,
  yPosition: 44,
  width: 200,
  height: 144,
  containerID: 2,
  containerName: 'scope',
})

const infoPanel = new TextContainerProperty({
  xPosition: 0,
  yPosition: 192,
  width: 200,
  height: 48,
  borderWidth: 0,
  borderColor: 5,
  paddingLength: 4,
  containerID: 3,
  containerName: 'info',
  content: ' ',
  isEventCapture: 0,
})

const detailPanel = new TextContainerProperty({
  xPosition: 204,
  yPosition: 44,
  width: 372,
  height: 196,
  borderWidth: 0,
  borderColor: 5,
  paddingLength: 4,
  containerID: 4,
  containerName: 'detail',
  content: ' ',
  isEventCapture: 0,
})

const footerPanel = new TextContainerProperty({
  xPosition: 0,
  yPosition: 244,
  width: 576,
  height: 40,
  borderWidth: 0,
  borderColor: 5,
  paddingLength: 4,
  containerID: 5,
  containerName: 'footer',
  content: ' ',
  isEventCapture: 0,
})

const created = await bridge.createStartUpPageContainer(
  new CreateStartUpPageContainer({
    containerTotalNum: 5,
    textObject: [alertPanel, infoPanel, detailPanel, footerPanel],
    imageObject: [scopeImage],
  }),
)
if (created !== 0) console.error('createStartUpPageContainer failed:', created)

const state = {
  view: 'radar' as 'radar' | 'info',
  conn: 'idle' as ConnState,
  connDetail: undefined as string | undefined,
  radar: null as RadarState | null,
  fix: null as Fix | null,
}

const pushed: Record<number, string> = {}

function push(containerID: number, containerName: string, content: string) {
  if (pushed[containerID] === content) return
  pushed[containerID] = content
  bridge
    .textContainerUpgrade(new TextContainerUpgrade({ containerID, containerName, content }))
    .catch(err => console.error('textContainerUpgrade failed:', err))
}

// ── Radar grafico ─────────────────────────────────────────────────────────
// updateImageRawData debe ir en serie: una imagen en vuelo a la vez.
let scopeKey = ''
let scopeChain: Promise<unknown> = Promise.resolve()
let scopeError: string | null = null
let scopeDisabled = false

function pushScope() {
  if (scopeDisabled) return
  const radar = state.radar
  const tracks = memory.list()

  if (!radar) {
    if (scopeKey === 'empty') return
    scopeKey = 'empty'
    sendScope([], 0.48)
    return
  }

  const key = [
    radar.phase,
    radar.rangeKm.toFixed(2),
    tracks
      .map(t => `${t.id}:${t.distKm}:${t.bearingDeg}:${t.stale ? 1 : 0}:${t.callsign === radar.lock?.callsign ? 1 : 0}`)
      .join('|'),
  ].join('#')
  if (key === scopeKey) return
  scopeKey = key

  const blips = tracks.map(t => ({
    distKm: t.distKm,
    bearingDeg: t.bearingDeg,
    stale: t.stale,
    locked: !!radar.lock && t.callsign === radar.lock.callsign,
  }))
  sendScope(blips, radar.rangeKm)
}

function sendScope(blips: Parameters<typeof renderScopePng>[0], rangeKm: number) {
  renderScopePng(blips, rangeKm)
    .then(bytes => {
      scopeChain = scopeChain.then(async () => {
        const result = await bridge.updateImageRawData(
          new ImageRawDataUpdate({ containerID: 2, containerName: 'scope', imageData: bytes }),
        )
        if (result !== 'success') {
          // El host rechazo la imagen: seguimos con el HUD de texto.
          console.error('updateImageRawData:', result, bytes.length, 'bytes')
          scopeError = String(result)
          scopeDisabled = true
          render()
        }
      })
      return scopeChain
    })
    .catch(err => {
      console.error('renderScopePng failed:', err)
      scopeError = err instanceof Error ? err.message : String(err)
      scopeDisabled = true
      render()
    })
}

// ── Render ────────────────────────────────────────────────────────────────
const memory = new TrackMemory()

function render() {
  const texts = renderHud({
    view: state.view,
    callsign: ui.getCallsign(),
    aircraft: ui.getAircraft(),
    conn: state.conn,
    connDetail: state.connDetail,
    radar: state.radar,
    tracks: memory.list(),
    gpsSimulated: state.fix?.simulated ?? false,
  })
  push(1, 'alert', texts.alert)
  push(3, 'info', scopeError ? `IMG\n${scopeError}` : texts.info)
  push(4, 'detail', texts.detail)
  push(5, 'footer', texts.footer)
  pushScope()
}

const net = new NetClient()

net.onState = (conn, detail) => {
  state.conn = conn
  state.connDetail = detail
  ui.setConn(conn, detail)
  ui.setConnected(conn === 'open')
  render()
}

net.onRadar = radar => {
  state.radar = radar
  memory.update(radar.contacts)
  ui.setRadar(radar, memory.list())
  render()
}

const ui = mountUi({
  onConnect: (url, callsign, aircraft) => {
    net.connect(url, { callsign, aircraft })
  },
  onDisconnect: () => {
    net.disconnect()
    state.radar = null
    state.conn = 'idle'
    memory.clear()
    ui.setRadar(null, [])
    render()
  },
  onAircraft: () => render(),
})

startLocation(bridge, fix => {
  state.fix = fix
  ui.setFix(fix)
  render()
})

// El telefono manda su posicion al servidor cada 2 s.
setInterval(() => {
  const fix = state.fix
  if (fix && net.connected) net.sendPos(fix.lat, fix.lon)
}, 2000)

// CLICK_EVENT es 0 y protobuf omite los campos con valor 0, asi que un tap
// llega SIN eventType. El default se resuelve DENTRO del envelope: si no hay
// envelope, no es un tap.
function eventTypeOf(envelope?: { eventType?: OsEventTypeList }): OsEventTypeList | null {
  if (!envelope) return null
  return envelope.eventType ?? OsEventTypeList.CLICK_EVENT
}

render()

const unsubscribe = bridge.onEvenHubEvent(event => {
  const sysType = eventTypeOf(event.sysEvent)
  const textType = eventTypeOf(event.textEvent)

  if (sysType === OsEventTypeList.DOUBLE_CLICK_EVENT || textType === OsEventTypeList.DOUBLE_CLICK_EVENT) {
    bridge.shutDownPageContainer(1)
    return
  }

  if (sysType === OsEventTypeList.CLICK_EVENT || textType === OsEventTypeList.CLICK_EVENT) {
    state.view = state.view === 'radar' ? 'info' : 'radar'
    render()
    return
  }

  if (sysType === OsEventTypeList.SYSTEM_EXIT_EVENT || sysType === OsEventTypeList.ABNORMAL_EXIT_EVENT) {
    unsubscribe()
  }
})
