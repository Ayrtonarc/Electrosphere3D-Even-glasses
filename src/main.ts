import {
  CreateStartUpPageContainer,
  ImageContainerProperty,
  ImageRawDataUpdate,
  ImuReportPace,
  OsEventTypeList,
  TextContainerProperty,
  waitForEvenAppBridge,
} from '@evenrealities/even_hub_sdk'
import { NetClient } from './net'
import { startLocation, type Fix } from './location'
import { mountUi } from './ui'
import { renderHud, type HudTexts } from './hud'
import { bearingDeg, distanceKm } from './geo'
import { cycleRange } from './instruments'
import { renderScreenTiles, TILE_COUNT, TILE_H, TILE_W, tileOrigin } from './screen'
import { attitudeChanged, attitudeFromImu, smoothAttitude, type Attitude } from './imu'
import { TrackMemory } from './track'
import type { ConnState, RadarState } from './types'

const bridge = await waitForEvenAppBridge()

// Pantalla completa (576x288) como HUD de realidad aumentada.
//
// Un contenedor de imagen admite 288x144 como maximo, asi que la pantalla se
// pinta en un canvas logico de 576x288 y se trocea en 4 imagenes:
//
//   tile 0 (0,0)        tile 1 (288,0)
//   tile 2 (0,144)      tile 3 (288,144)
//
// No hay contenedores de texto visibles: el HUD entero se dibuja en el canvas.
// `tapPanel` existe solo porque el firmware necesita un contenedor con
// isEventCapture para entregar los gestos (tap y doble tap); va vacio y sin
// borde, en una esquina donde el radar ya es negro.
const scopeTiles = Array.from({ length: TILE_COUNT }, (_, i) => {
  const origin = tileOrigin(i)
  return new ImageContainerProperty({
    xPosition: origin.x,
    yPosition: origin.y,
    width: TILE_W,
    height: TILE_H,
    containerID: i + 1,
    containerName: `scope-${i}`,
  })
})

const tapPanel = new TextContainerProperty({
  xPosition: 0,
  yPosition: 0,
  width: 20,
  height: 20,
  borderWidth: 0,
  borderColor: 0,
  paddingLength: 0,
  containerID: TILE_COUNT + 1,
  containerName: 'tap',
  content: ' ',
  isEventCapture: 1,
})

const created = await bridge.createStartUpPageContainer(
  new CreateStartUpPageContainer({
    containerTotalNum: TILE_COUNT + 1,
    textObject: [tapPanel],
    imageObject: scopeTiles,
  }),
)
if (created !== 0) console.error('createStartUpPageContainer failed:', created)

// IMU a 1 Hz: el horizonte gira en los 4 tiles, asi que subir la frecuencia
// multiplica el trafico por BLE. A P1000 coincide con el tick del radar y no
// cuesta ancho de banda extra. Para mas fluidez, subir a P300 y medir.
bridge
  .imuControl(true, ImuReportPace.P1000)
  .then(ok => {
    if (!ok) console.warn('imuControl: el host no acepta el IMU; sin horizonte')
  })
  .catch(err => console.warn('imuControl fallo:', err))

const state = {
  view: 'radar' as 'radar' | 'info',
  conn: 'idle' as ConnState,
  connDetail: undefined as string | undefined,
  radar: null as RadarState | null,
  fix: null as Fix | null,
  /** Fraccion del alcance maximo dibujada en el radar (selector de alcance). */
  rangeScale: 1,
  /** Radar encendido. Apagarlo reduce lo que ves y lo que te ven. */
  emitting: true,
}

// Velocidad propia: el GPS no la da, se saca de dos lecturas consecutivas.
// Se suaviza porque a pie el error del GPS (±10 m) la hace saltar.
let lastFix: { lat: number; lon: number; at: number } | null = null
let speedKph: number | null = null
let headingDeg: number | null = null
let altM: number | null = null
let attitude: Attitude | null = null
let lastImuAt = 0

/** No repintar el HUD por cada muestra: el horizonte toca los 4 tiles. */
const IMU_MIN_INTERVAL_MS = 250
const IMU_DEADBAND_DEG = 2
const IMU_SMOOTHING = 0.35

/** Media circular: dos rumbos a 350 y 10 grados estan a 20, no a 340. */
function blendHeading(from: number, to: number, weight: number): number {
  const a = (from * Math.PI) / 180
  const b = (to * Math.PI) / 180
  const x = Math.cos(a) * (1 - weight) + Math.cos(b) * weight
  const y = Math.sin(a) * (1 - weight) + Math.sin(b) * weight
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360
}

function trackSpeed(fix: Fix) {
  altM = typeof fix.altitudeM === 'number' ? fix.altitudeM : altM
  if (typeof fix.headingDeg === 'number') headingDeg = fix.headingDeg
  if (!lastFix) {
    lastFix = { lat: fix.lat, lon: fix.lon, at: fix.updatedAt }
    return
  }
  const dtSec = (fix.updatedAt - lastFix.at) / 1000
  if (dtSec <= 0.5) return
  const km = distanceKm(lastFix, fix)
  const from = lastFix
  lastFix = { lat: fix.lat, lon: fix.lon, at: fix.updatedAt }

  const kph = (km / dtSec) * 3600
  // Mas de 40 km/h a pie es un salto del GPS, no una carrera.
  if (kph > 40) return
  speedKph = speedKph === null ? kph : speedKph * 0.6 + kph * 0.4

  // Por debajo de ~3 m entre lecturas el rumbo es puro ruido del GPS.
  if (km < 0.003) return
  // El GPS ya manda rumbo; solo se deriva si no lo da.
  if (typeof fix.headingDeg === 'number') return
  const brg = bearingDeg(from, fix)
  headingDeg = headingDeg === null ? brg : blendHeading(headingDeg, brg, 0.35)
}

/**
 * Rueda en vista radar: pasa al siguiente contacto de la lista (que ya viene
 * ordenada por distancia). Sin eleccion previa empieza por el primero.
 */
function cycleTarget(step: 1 | -1) {
  const radar = state.radar
  if (!radar || !net.connected || radar.contacts.length === 0) return
  const current = radar.you.targetId ?? null
  const at = current ? radar.contacts.findIndex(c => c.id === current) : -1
  const next =
    at === -1
      ? step > 0
        ? 0
        : radar.contacts.length - 1
      : (at + step + radar.contacts.length) % radar.contacts.length
  net.sendTarget(radar.contacts[next].id)
}

// ── Pantalla AR ───────────────────────────────────────────────────────────
// Las imagenes viajan de una en una por el enlace con el movil, asi que solo
// se reenvian los tiles que de verdad han cambiado.
let tileHashes: number[] = []
let screenChain: Promise<unknown> = Promise.resolve()
let screenDisabled = false

function pushScreen(texts: HudTexts) {
  if (screenDisabled) return
  const radar = state.radar
  const blips = memory.list().map(t => ({
    distKm: t.distKm,
    bearingDeg: t.bearingDeg,
    stale: t.stale,
    locked: !!radar?.lock && t.callsign === radar.lock.callsign,
    aircraft: t.aircraft,
    callsign: t.callsign,
    closureMps: t.closureMps,
    altM: t.altM,
    emitting: t.emitting,
  }))

  renderScreenTiles(
    {
      hud: texts,
      radar,
      view: state.view,
      conn: state.conn,
      blips,
      speedKph,
      headingDeg,
      altM,
      attitude,
      gpsAccuracyM: state.fix?.accuracy ?? null,
      gpsSimulated: state.fix?.simulated ?? false,
      rangeScale: state.rangeScale,
      silent: !state.emitting,
    },
    tileHashes,
  )
    .then(({ tiles, hashes }) => {
      tileHashes = hashes
      for (const tile of tiles) {
        screenChain = screenChain.then(async () => {
          const result = await bridge.updateImageRawData(
            new ImageRawDataUpdate({
              containerID: tile.index + 1,
              containerName: `scope-${tile.index}`,
              imageData: tile.png,
            }),
          )
          if (result !== 'success') {
            console.error('updateImageRawData:', tile.index, result, tile.png.length, 'bytes')
            screenDisabled = true
          }
        })
      }
      return screenChain
    })
    .catch(err => {
      console.error('renderScreenTiles failed:', err)
      screenDisabled = true
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
  pushScreen(texts)
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
    // El servidor arranca a cada jugador con el radar encendido.
    state.emitting = true
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
  trackSpeed(fix)
  ui.setFix(fix)
  render()
}, { allowFallback: import.meta.env.DEV })

// El telefono manda su posicion al servidor cada 2 s.
setInterval(() => {
  const fix = state.fix
  if (fix && net.connected) net.sendPos(fix.lat, fix.lon, fix.altitudeM, headingDeg ?? undefined)
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

  if (sysType === OsEventTypeList.IMU_DATA_REPORT) {
    const sample = event.sysEvent?.imuData
    if (!sample) return
    const at = performance.now()
    if (at - lastImuAt < IMU_MIN_INTERVAL_MS) return
    const next = attitudeFromImu(sample)
    if (!next) return
    const smoothed = smoothAttitude(attitude, next, IMU_SMOOTHING)
    if (!attitudeChanged(attitude, smoothed, IMU_DEADBAND_DEG)) return
    lastImuAt = at
    attitude = smoothed
    render()
    return
  }

  if (sysType === OsEventTypeList.DOUBLE_CLICK_EVENT || textType === OsEventTypeList.DOUBLE_CLICK_EVENT) {
    bridge.shutDownPageContainer(1)
    return
  }

  // Rueda: arriba acerca el radar, abajo lo aleja. Se miran los dos envelopes
  // porque `eventTypeOf` cae a CLICK cuando un envelope existe sin tipo: con
  // `sysType ?? textType` la rueda que llegase por el evento de texto se perdia.
  const isScrollTop =
    sysType === OsEventTypeList.SCROLL_TOP_EVENT || textType === OsEventTypeList.SCROLL_TOP_EVENT
  const isScrollBottom =
    sysType === OsEventTypeList.SCROLL_BOTTOM_EVENT ||
    textType === OsEventTypeList.SCROLL_BOTTOM_EVENT
  if (isScrollTop || isScrollBottom) {
    if (state.view === 'radar') {
      // En el radar la rueda elige blanco; el alcance se ajusta en la ficha.
      cycleTarget(isScrollTop ? 1 : -1)
    } else {
      state.rangeScale = cycleRange(state.rangeScale, isScrollTop ? 1 : -1)
    }
    render()
    return
  }

  // Pulsacion larga: enciende o apaga el radar (modo silencio).
  if (
    sysType === OsEventTypeList.LONG_PRESS_EVENT ||
    textType === OsEventTypeList.LONG_PRESS_EVENT
  ) {
    state.emitting = !state.emitting
    net.sendEmission(state.emitting)
    render()
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
