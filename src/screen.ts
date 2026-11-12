// Pantalla completa de las gafas como HUD de realidad aumentada.
//
// El display mide 576x288 pero un contenedor de imagen solo admite 288x144, asi
// que la pantalla se pinta en un canvas logico de 576x288 y se trocea en 4
// imagenes (2x2). Todo el texto (avisos, barra de bloqueo, reloj, indicativos)
// va DENTRO del canvas: asi el tamano de fuente no depende del firmware.
//
// Las imagenes viajan de una en una por el enlace con el movil, por eso solo se
// reenvian los tiles que han cambiado.

import { deviationDeg } from './geo'
import { altitudeDelta, closureLabel, gpsQuality, rangeScaleLabel } from './instruments'
import type { HudTexts } from './hud'
import type { Attitude } from './imu'
import {
  drawPlanform,
  placeLabel,
  planformFor,
  plotXY,
  referenceBearing,
  shortLabel,
  type LabelArea,
  type ScopeBlip,
} from './scope'
import type { ConnState, RadarState } from './types'

export const SCREEN_W = 576
export const SCREEN_H = 288
export const TILE_W = 288
export const TILE_H = 144
export const TILE_COLS = 2
export const TILE_COUNT = 4

export interface TileOrigin {
  index: number
  x: number
  y: number
}

/** Esquina superior izquierda de cada tile dentro de la pantalla. */
export function tileOrigin(index: number): TileOrigin {
  return { index, x: (index % TILE_COLS) * TILE_W, y: Math.floor(index / TILE_COLS) * TILE_H }
}

const CENTER = { x: SCREEN_W / 2, y: 148 }
const RADIUS = 86
const PAD = 14
const FONT = 'ui-monospace, "SF Mono", Menlo, Consolas, monospace'

const BLIP_SCALE = 9
const STALE_SCALE = 7

const TAPE_Y = 32
const TAPE_PX_PER_DEG = 2.6
const TAPE_HALF_DEG = 50

const LABEL_AREA: LabelArea = {
  width: SCREEN_W,
  height: SCREEN_H,
  gap: 15,
  padX: 8,
  padY: 8,
}

export interface ScreenInput {
  hud: HudTexts
  radar: RadarState | null
  view: 'radar' | 'info'
  conn: ConnState
  blips: ScopeBlip[]
  /** Velocidad propia en km/h; `null` si aun no hay dos lecturas de GPS. */
  speedKph: number | null
  /** Rumbo propio (GPS); `null` si esta parado o aun no hay deriva. */
  headingDeg: number | null
  /** Altitud propia en metros (GPS); `null` si no hay dato. */
  altM: number | null
  /** Precision horizontal del GPS en metros; `null` si no la da. */
  gpsAccuracyM: number | null
  /** Fraccion del alcance maximo que se dibuja: 1 = todo, 0.35 = muy cerca. */
  rangeScale: number
  /** Actitud de la cabeza (IMU); `null` si no hay IMU o aun no hay lectura. */
  attitude: Attitude | null
  /** true si la posicion viene del respaldo y no del GPS. */
  gpsSimulated: boolean
}

interface TextStyle {
  size?: number
  align?: CanvasTextAlign
  baseline?: CanvasTextBaseline
  alpha?: number
  weight?: number
}

function text(ctx: CanvasRenderingContext2D, value: string, x: number, y: number, style: TextStyle = {}) {
  const { size = 15, align = 'left', baseline = 'top', alpha = 0.92, weight = 600 } = style
  ctx.font = `${weight} ${size}px ${FONT}`
  ctx.textAlign = align
  ctx.textBaseline = baseline
  ctx.fillStyle = `rgba(255,255,255,${alpha})`
  ctx.fillText(value, x, y)
}

function blink(periodMs = 1000): boolean {
  return Math.floor(Date.now() / periodMs) % 2 === 0
}

const deg3 = (v: number) => String(((Math.round(v) % 360) + 360) % 360).padStart(3, '0')

/**
 * Cinta de rumbo tipo HUD de caza. Se centra en el rumbo real (GPS) y marca con
 * un triangulo la marcacion del blanco, que es el dato que mueve el juego.
 */
function drawHeadingTape(
  ctx: CanvasRenderingContext2D,
  headingDeg: number,
  targetBearingDeg: number | null,
): void {
  const cx = SCREEN_W / 2
  const left = cx - TAPE_HALF_DEG * TAPE_PX_PER_DEG
  const right = cx + TAPE_HALF_DEG * TAPE_PX_PER_DEG

  ctx.lineWidth = 1
  ctx.strokeStyle = 'rgba(255,255,255,0.5)'
  ctx.beginPath()
  ctx.moveTo(left, TAPE_Y)
  ctx.lineTo(right, TAPE_Y)
  ctx.stroke()

  for (let d = -TAPE_HALF_DEG; d <= TAPE_HALF_DEG; d += 5) {
    const x = cx + d * TAPE_PX_PER_DEG
    const deg = Math.round(headingDeg) + d
    const major = deg % 15 === 0
    ctx.beginPath()
    ctx.moveTo(x, TAPE_Y)
    ctx.lineTo(x, TAPE_Y + (major ? 7 : 4))
    ctx.stroke()
    if (major) {
      text(ctx, deg3(deg), x, TAPE_Y + 10, { size: 10, align: 'center', alpha: 0.65, weight: 400 })
    }
  }

  // marca del blanco sobre la cinta, como el locator de un caza
  if (targetBearingDeg !== null) {
    let delta = ((targetBearingDeg - headingDeg + 540) % 360) - 180
    if (Math.abs(delta) <= TAPE_HALF_DEG) {
      const tx = cx + delta * TAPE_PX_PER_DEG
      ctx.fillStyle = 'rgba(255,255,255,0.75)'
      ctx.beginPath()
      ctx.moveTo(tx, TAPE_Y + 2)
      ctx.lineTo(tx - 4, TAPE_Y + 9)
      ctx.lineTo(tx + 4, TAPE_Y + 9)
      ctx.closePath()
      ctx.fill()
      const rel = Math.round(delta)
      text(ctx, `${rel > 0 ? '+' : ''}${rel}`, tx, TAPE_Y + 12, {
        size: 9,
        align: 'center',
        alpha: 0.6,
        weight: 400,
      })
    }
  }

  // caret de rumbo propio
  ctx.fillStyle = 'rgba(255,255,255,0.95)'
  ctx.beginPath()
  ctx.moveTo(cx, TAPE_Y - 1)
  ctx.lineTo(cx - 5, TAPE_Y - 9)
  ctx.lineTo(cx + 5, TAPE_Y - 9)
  ctx.closePath()
  ctx.fill()

  text(ctx, deg3(headingDeg), cx, TAPE_Y - 23, { size: 13, align: 'center', alpha: 0.95 })
}

/**
 * Cinta vertical de datos tipo SPD/ALT: los ticks miran hacia fuera del centro
 * y el numero vive DENTRO, para que no se recorte contra el borde del display.
 */
function drawValueTape(
  ctx: CanvasRenderingContext2D,
  x: number,
  value: string,
  label: string,
  unit: string,
  side: 'left' | 'right',
): void {
  const cy = CENTER.y
  const out = side === 'left' ? -1 : 1
  const align: CanvasTextAlign = side === 'left' ? 'left' : 'right'
  const tx = x - out * 16

  ctx.lineWidth = 1
  ctx.strokeStyle = 'rgba(255,255,255,0.45)'
  ctx.beginPath()
  ctx.moveTo(x, cy - 72)
  ctx.lineTo(x, cy + 72)
  ctx.stroke()

  for (let i = -6; i <= 6; i++) {
    const y = cy + i * 11
    const major = i % 3 === 0
    ctx.beginPath()
    ctx.moveTo(x, y)
    ctx.lineTo(x + out * (major ? 9 : 5), y)
    ctx.stroke()
  }

  text(ctx, label, tx, cy - 30, { size: 11, align, alpha: 0.7, weight: 400 })
  text(ctx, value, tx, cy, { size: 24, align, alpha: 1, baseline: 'middle' })
  text(ctx, unit, tx, cy + 18, { size: 10, align, alpha: 0.6, weight: 400 })
}

const PITCH_PX_PER_DEG = 2.2

/**
 * Horizonte artificial con escala de cabeceo.
 *
 * Se recorta a una ventana central para no invadir las cintas de rumbo, SPD y
 * ALT. Sin simbolo de avion propio: el centro lo ocupa el radar.
 */
function drawHorizon(ctx: CanvasRenderingContext2D, attitude: Attitude): void {
  const { rollDeg, pitchDeg } = attitude
  const { x: cx, y: cy } = CENTER

  ctx.save()
  ctx.beginPath()
  ctx.rect(146, 58, 288, 176)
  ctx.clip()

  // El cabeceo mueve el horizonte, el alabeo lo inclina.
  ctx.translate(cx, cy + pitchDeg * PITCH_PX_PER_DEG)
  ctx.rotate((rollDeg * Math.PI) / 180)

  ctx.strokeStyle = 'rgba(255,255,255,0.30)'
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(-300, 0)
  ctx.lineTo(300, 0)
  ctx.stroke()

  // Marcas cada 10 grados de cabeceo, con hueco en el centro.
  for (let deg = -30; deg <= 30; deg += 10) {
    if (deg === 0) continue
    const y = -deg * PITCH_PX_PER_DEG
    const half = deg > 0 ? 26 : 18
    ctx.beginPath()
    ctx.moveTo(-half, y)
    ctx.lineTo(-10, y)
    ctx.moveTo(10, y)
    ctx.lineTo(half, y)
    ctx.stroke()
  }

  ctx.restore()
}

/** Cruz de punteria seca, como el boresight de un HUD de caza. */
function drawBoresight(ctx: CanvasRenderingContext2D): void {
  const { x: cx, y: cy } = CENTER
  const gap = 13
  const arm = 9

  ctx.strokeStyle = 'rgba(255,255,255,0.55)'
  ctx.lineWidth = 1
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    ctx.beginPath()
    ctx.moveTo(cx + dx * gap, cy + dy * gap)
    ctx.lineTo(cx + dx * (gap + arm), cy + dy * (gap + arm))
    ctx.stroke()
  }
  ctx.fillStyle = 'rgba(255,255,255,0.7)'
  ctx.fillRect(cx - 1, cy - 1, 2, 2)
}


/* ── Instrumentos de cabina ─────────────────────────────────────────────── */

const CDI_HALF_PX = 70
const CDI_MAX_DEG = 60

/**
 * Aguja de desviacion (CDI): cuanto hay que girar para apuntar al blanco.
 * Se satura a 60 grados porque mas alla la direccion ya la da la cinta.
 */
function drawCdi(ctx: CanvasRenderingContext2D, deviation: number): void {
  const { x: cx } = CENTER
  const y = 74

  ctx.strokeStyle = 'rgba(255,255,255,0.4)'
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(cx - CDI_HALF_PX, y)
  ctx.lineTo(cx + CDI_HALF_PX, y)
  ctx.stroke()

  for (const frac of [-1, -0.5, 0, 0.5, 1]) {
    const x = cx + frac * CDI_HALF_PX
    const tall = frac === 0 ? 5 : 3
    ctx.beginPath()
    ctx.moveTo(x, y - tall)
    ctx.lineTo(x, y + tall)
    ctx.stroke()
  }

  const ratio = Math.max(-1, Math.min(1, deviation / CDI_MAX_DEG))
  const nx = cx + ratio * CDI_HALF_PX
  ctx.fillStyle = 'rgba(255,255,255,0.95)'
  ctx.beginPath()
  ctx.moveTo(nx, y - 4)
  ctx.lineTo(nx - 4, y - 11)
  ctx.lineTo(nx + 4, y - 11)
  ctx.closePath()
  ctx.fill()

  text(ctx, `${deviation > 0 ? '+' : ''}${Math.round(deviation)}`, nx, y + 6, {
    size: 9,
    align: 'center',
    alpha: 0.62,
    weight: 400,
  })
  text(ctx, 'TGT', cx - CDI_HALF_PX - 8, y, {
    size: 9,
    align: 'right',
    baseline: 'middle',
    alpha: 0.55,
    weight: 400,
  })
}

/** Barras de calidad del GPS y aviso de GPS JAM. */
function drawGpsStatus(
  ctx: CanvasRenderingContext2D,
  accuracyM: number | null,
  simulated: boolean,
): void {
  const quality = gpsQuality(accuracyM, simulated)
  const x = PAD
  const y = 9

  for (let i = 0; i < 4; i++) {
    const height = 4 + i * 3
    ctx.fillStyle =
      i < quality.bars ? 'rgba(255,255,255,0.85)' : 'rgba(255,255,255,0.18)'
    ctx.fillRect(x + i * 6, y + 14 - height, 4, height)
  }

  const label = quality.jam
    ? 'GPS JAM'
    : `GPS ${accuracyM === null ? '---' : `${Math.round(accuracyM)}m`}`
  // El aviso de jam parpadea; el dato bueno se queda fijo.
  if (!quality.jam || blink(900)) {
    text(ctx, label, x + 30, y, { size: 10, alpha: quality.jam ? 0.95 : 0.6, weight: 400 })
  }
}

const MFD = { x: 506, y: 4, size: 64 }
const MFD_INNER = 26

/** Radar tactico pequeno: todos los contactos, sin tapar la cinta de rumbo. */
function drawMfd(ctx: CanvasRenderingContext2D, blips: ScopeBlip[], rangeKm: number): void {
  const cx = MFD.x + MFD.size / 2
  const cy = MFD.y + MFD.size / 2

  ctx.strokeStyle = 'rgba(255,255,255,0.32)'
  ctx.lineWidth = 1
  ctx.strokeRect(MFD.x + 0.5, MFD.y + 0.5, MFD.size - 1, MFD.size - 1)

  ctx.beginPath()
  ctx.moveTo(cx - 4, cy)
  ctx.lineTo(cx + 4, cy)
  ctx.moveTo(cx, cy - 4)
  ctx.lineTo(cx, cy + 4)
  ctx.stroke()

  for (const blip of blips) {
    const { x, y } = plotXY(blip.distKm, blip.bearingDeg, rangeKm, MFD_INNER)
    ctx.fillStyle = blip.stale
      ? 'rgba(255,255,255,0.3)'
      : blip.locked
        ? 'rgba(255,255,255,1)'
        : 'rgba(255,255,255,0.8)'
    ctx.beginPath()
    ctx.arc(cx + x, cy + y, blip.locked ? 2.6 : 1.7, 0, Math.PI * 2)
    ctx.fill()
  }
}

/** Flecha en el borde hacia un contacto que queda fuera de la escala elegida. */
function drawEdgeArrow(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  bearingDeg: number,
  distKm: number,
): void {
  const angle = (bearingDeg * Math.PI) / 180
  const ex = cx + Math.sin(angle) * (RADIUS + 5)
  const ey = cy - Math.cos(angle) * (RADIUS + 5)

  ctx.save()
  ctx.translate(ex, ey)
  ctx.rotate(angle)
  ctx.fillStyle = 'rgba(255,255,255,0.85)'
  ctx.beginPath()
  ctx.moveTo(0, -6)
  ctx.lineTo(5, 4)
  ctx.lineTo(-5, 4)
  ctx.closePath()
  ctx.fill()
  ctx.restore()

  text(ctx, `${Math.round(distKm * 1000)}`, cx + Math.sin(angle) * (RADIUS + 17), cy - Math.cos(angle) * (RADIUS + 17), {
    size: 9,
    align: 'center',
    baseline: 'middle',
    alpha: 0.7,
    weight: 400,
  })
}

/** Corchetes de objetivo con progreso de bloqueo en arco, estilo Ace Combat. */
function drawTargetBox(
  ctx: CanvasRenderingContext2D,
  px: number,
  py: number,
  callsign: string,
  ms: number,
  needMs: number,
  distLabel: string,
  altDelta: string,
): void {
  const s = 15
  const notch = 6

  ctx.strokeStyle = 'rgba(255,255,255,0.95)'
  ctx.lineWidth = 1.5
  for (const sx of [-1, 1]) {
    for (const sy of [-1, 1]) {
      ctx.beginPath()
      ctx.moveTo(px + sx * s, py + sy * (s - notch))
      ctx.lineTo(px + sx * s, py + sy * s)
      ctx.lineTo(px + sx * (s - notch), py + sy * s)
      ctx.stroke()
    }
  }

  const progress = needMs > 0 ? Math.min(1, ms / needMs) : 0
  ctx.strokeStyle = 'rgba(255,255,255,0.6)'
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.arc(px, py, s + 7, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * progress)
  ctx.stroke()

  // El nombre del blanco va en la caja: es lo unico que la identifica.
  text(ctx, shortLabel(callsign), px, py - s - 13, { size: 12, align: 'center', alpha: 1 })
  text(ctx, `${(ms / 1000).toFixed(1)}/${Math.round(needMs / 1000)}`, px, py + s + 7, {
    size: 11,
    align: 'center',
    alpha: 0.9,
    weight: 400,
  })
  // Distancia y cierre del blanco: sin esto el contacto fijado iba a ciegas.
  text(ctx, distLabel, px, py + s + 19, { size: 10, align: 'center', alpha: 0.85, weight: 400 })
  if (altDelta) {
    text(ctx, altDelta, px, py + s + 30, { size: 10, align: 'center', alpha: 0.75, weight: 400 })
  }
}

function drawRadar(
  ctx: CanvasRenderingContext2D,
  radar: RadarState | null,
  blips: ScopeBlip[],
  rangeScale: number,
  ownAltM: number | null,
): void {
  const { x: cx, y: cy } = CENTER
  const plotRange = (radar?.rangeKm ?? 0) * rangeScale

  drawBoresight(ctx)

  for (const blip of blips) {
    // Fuera de la escala elegida: flecha en el borde y sin silueta, para que no
    // se confunda con un contacto que esta justo en el limite.
    if (plotRange > 0 && blip.distKm > plotRange) {
      drawEdgeArrow(ctx, cx, cy, blip.bearingDeg, blip.distKm)
      continue
    }

    const { x, y } = plotXY(blip.distKm, blip.bearingDeg, plotRange, RADIUS)
    const px = cx + x
    const py = cy + y
    // Sin rumbo real del contacto: el morro se alinea con su marcacion.
    const angle = (blip.bearingDeg * Math.PI) / 180
    const scale = blip.stale ? STALE_SCALE : BLIP_SCALE

    drawPlanform(
      ctx,
      px,
      py,
      angle,
      planformFor(blip.aircraft),
      scale,
      blip.stale ? 'rgba(255,255,255,0.4)' : 'rgba(255,255,255,1)',
    )

    const trend = blip.stale ? '' : closureLabel(blip.closureMps)
    const dist = `${Math.round(blip.distKm * 1000)}m${trend ? ` ${trend}` : ''}`

    if (blip.locked && radar?.lock && radar.phase === 'flying') {
      drawTargetBox(
        ctx,
        px,
        py,
        blip.callsign,
        radar.lock.ms,
        radar.lock.needMs,
        dist,
        altitudeDelta(blip.altM, ownAltM),
      )
      continue
    }

    const label = shortLabel(blip.callsign)
    if (!label) continue
    ctx.font = `600 12px ${FONT}`
    const width = ctx.measureText(label).width
    const spot = placeLabel(px, py, width, LABEL_AREA)
    const alpha = blip.stale ? 0.4 : 0.85
    text(ctx, label, spot.x, spot.y, { size: 12, align: spot.align, alpha, baseline: 'middle' })
    text(ctx, dist, spot.x, spot.y + 12, {
      size: 10,
      align: spot.align,
      alpha: alpha * 0.75,
      baseline: 'middle',
      weight: 400,
    })
  }
}

function drawStatusBar(ctx: CanvasRenderingContext2D, input: ScreenInput): void {
  const { hud, radar, conn } = input

  const threat = conn === 'open' && !!radar?.lockedBy
  // El aviso parpadea cuando es una amenaza, como en el HUD de un caza.
  const showAlert = !threat || blink(1000)
  if (showAlert) {
    text(ctx, hud.alert, SCREEN_W / 2, 246, { size: 16, align: 'center', alpha: 1 })
  }

  // La info va en dos lineas: aeronave y alcance del radar (el ALT ya tiene cinta).
  hud.info.split('\n').forEach((line, i) => {
    text(ctx, line, PAD, SCREEN_H - 34 + i * 17, { size: i === 0 ? 14 : 12, alpha: i === 0 ? 0.85 : 0.6, weight: 400 })
  })
  text(ctx, hud.footer, SCREEN_W - PAD, SCREEN_H - 20, { size: 14, align: 'right', alpha: 0.7, weight: 400 })
}

/** Panel centrado con el texto de `detail` (ficha, resultado o sin conexion). */
function drawOverlay(ctx: CanvasRenderingContext2D, detail: string): void {
  const lines = detail.split('\n')
  const lineHeight = 24
  const width = 380
  const height = lines.length * lineHeight + 32
  const left = (SCREEN_W - width) / 2
  const top = (SCREEN_H - height) / 2

  ctx.fillStyle = 'rgba(0,0,0,0.88)'
  ctx.fillRect(left, top, width, height)
  ctx.strokeStyle = 'rgba(255,255,255,0.35)'
  ctx.lineWidth = 1
  ctx.strokeRect(left + 0.5, top + 0.5, width - 1, height - 1)

  lines.forEach((line, i) => {
    text(ctx, line, SCREEN_W / 2, top + 20 + i * lineHeight, { size: 16, align: 'center', alpha: 0.92 })
  })
}

export function drawScreen(ctx: CanvasRenderingContext2D, input: ScreenInput): void {
  const {
    hud,
    radar,
    view,
    conn,
    blips,
    speedKph,
    headingDeg,
    altM,
    attitude,
    gpsAccuracyM,
    gpsSimulated,
    rangeScale,
  } = input

  ctx.fillStyle = '#000000'
  ctx.fillRect(0, 0, SCREEN_W, SCREEN_H)

  const online = conn === 'open' && radar !== null

  // Orden de capas: horizonte al fondo, instrumentos, radar y estado.
  if (attitude) drawHorizon(ctx, attitude)

  const targetBearing = online ? referenceBearing(blips, radar.lock?.callsign ?? null) : null
  // Sin deriva del GPS (parado) la cinta se ancla al blanco para no quedar ciega.
  const hdg = headingDeg ?? targetBearing ?? 0
  drawHeadingTape(ctx, hdg, targetBearing)
  if (targetBearing !== null) drawCdi(ctx, deviationDeg(targetBearing, hdg))

  drawGpsStatus(ctx, gpsAccuracyM, gpsSimulated)

  drawValueTape(ctx, 56, speedKph === null ? '---' : speedKph.toFixed(1), 'SPD', 'KPH', 'left')
  drawValueTape(ctx, SCREEN_W - 56, altM === null ? '---' : String(Math.round(altM)), 'ALT', 'M', 'right')
  text(ctx, rangeScaleLabel(rangeScale), SCREEN_W - 72, 190, {
    size: 10,
    align: 'right',
    alpha: 0.6,
    weight: 400,
  })

  // Sin enlace no hay radar: el panel central explica el estado.
  if (online) {
    drawRadar(ctx, radar, blips, rangeScale, altM)
    drawMfd(ctx, blips, radar.rangeKm)
  }

  drawStatusBar(ctx, input)

  const overlay = view === 'info' || conn !== 'open' || radar?.phase === 'finished'
  if (overlay) drawOverlay(ctx, hud.detail)
}

export interface ScreenTile {
  index: number
  hash: number
  png: Uint8Array
}

/** Niveles de gris del panel: el host convierte la imagen a 4 bits de todos modos. */
const GRAY_LEVELS = 16

/**
 * Ajusta los pixeles a los 16 grises del panel ANTES de codificar el PNG.
 * Dos motivos: el PNG pesa ~35% menos (menos bytes por el enlace) y los hashes
 * de tile dejan de bailar por el antialias, asi que se reenvia menos.
 */
export function quantizeToPanel(data: Uint8ClampedArray): void {
  const max = GRAY_LEVELS - 1
  for (let i = 0; i < data.length; i += 4) {
    const level = Math.round((data[i] / 255) * max)
    const value = Math.round((level / max) * 255)
    data[i] = value
    data[i + 1] = value
    data[i + 2] = value
    data[i + 3] = 255
  }
}

/** FNV-1a sobre los pixeles: detecta tiles sin cambios sin volver a codificarlos. */
export function hashPixels(data: Uint8ClampedArray | Uint8Array): number {
  let h = 0x811c9dc5
  for (let i = 0; i < data.length; i++) {
    h ^= data[i]
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

/** Igual que `hashPixels` pero sobre un rectangulo de un buffer RGBA completo. */
export function hashRegion(
  data: Uint8ClampedArray,
  stridePx: number,
  sx: number,
  sy: number,
  width: number,
  height: number,
): number {
  let h = 0x811c9dc5
  for (let y = 0; y < height; y++) {
    let i = ((sy + y) * stridePx + sx) * 4
    for (let x = 0; x < width; x++, i += 4) {
      h ^= data[i]
      h = Math.imul(h, 0x01000193)
    }
  }
  return h >>> 0
}

const PNG_TYPE = 'image/png'

function encodeTile(source: HTMLCanvasElement, sx: number, sy: number): Promise<Uint8Array> {
  // Un canvas por tile: el bridge solo acepta 288x144 como mucho.
  const tile = document.createElement('canvas')
  tile.width = TILE_W
  tile.height = TILE_H
  const ctx = tile.getContext('2d')
  if (!ctx) return Promise.reject(new Error('canvas 2d no disponible'))
  ctx.drawImage(source, sx, sy, TILE_W, TILE_H, 0, 0, TILE_W, TILE_H)

  return new Promise<Uint8Array>((resolve, reject) => {
    const toArray = async (blob: Blob) => resolve(new Uint8Array(await blob.arrayBuffer()))
    if (typeof tile.toBlob === 'function') {
      tile.toBlob(blob => (blob ? toArray(blob) : reject(new Error('toBlob vacio'))), PNG_TYPE)
      return
    }
    try {
      const base64 = tile.toDataURL(PNG_TYPE).split(',')[1] ?? ''
      const binary = atob(base64)
      const bytes = new Uint8Array(binary.length)
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
      resolve(bytes)
    } catch (err) {
      reject(err)
    }
  })
}

/**
 * Pinta el HUD completo y devuelve solo los tiles cuyo contenido cambio.
 * `prevHashes` permite saltarse la codificacion PNG de lo que sigue igual.
 */
export async function renderScreenTiles(
  input: ScreenInput,
  prevHashes: readonly number[] = [],
): Promise<{ tiles: ScreenTile[]; hashes: number[] }> {
  const source = document.createElement('canvas')
  source.width = SCREEN_W
  source.height = SCREEN_H
  // Leemos los pixeles de los 4 tiles cada frame: el hint evita una copia por lectura.
  const ctx = source.getContext('2d', { willReadFrequently: true })
  if (!ctx) throw new Error('canvas 2d no disponible')

  drawScreen(ctx, input)

  // Un solo readback: se cuantiza una vez y se hashean los 4 tiles del buffer.
  const frame = ctx.getImageData(0, 0, SCREEN_W, SCREEN_H)
  quantizeToPanel(frame.data)
  ctx.putImageData(frame, 0, 0)

  const hashes: number[] = []
  const tiles: ScreenTile[] = []
  for (let i = 0; i < TILE_COUNT; i++) {
    const { x, y } = tileOrigin(i)
    const hash = hashRegion(frame.data, SCREEN_W, x, y, TILE_W, TILE_H)
    hashes.push(hash)
    if (hash === prevHashes[i]) continue
    tiles.push({ index: i, hash, png: await encodeTile(source, x, y) })
  }
  return { tiles, hashes }
}
