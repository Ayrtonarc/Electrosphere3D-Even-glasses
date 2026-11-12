// Geometria del radar de las gafas: donde cae cada contacto, que silueta le
// corresponde y donde va su etiqueta. Sin canvas ni DOM: todo puro y testeable.
// El pintado vive en screen.ts.

import type { AircraftId } from './types'

export interface ScopeBlip {
  distKm: number
  bearingDeg: number
  stale: boolean
  locked: boolean
  /** Tipo de caza: decide que silueta se dibuja en el radar. */
  aircraft: AircraftId
  /** Indicativo, se pinta al lado de la silueta. */
  callsign: string
  /** Acercamiento en m/s; `undefined` si aun no hay dos pings. */
  closureMps?: number
  /** Altitud del contacto en metros, si el servidor la conoce. */
  altM?: number
  /** false si el contacto lleva el radar en silencio. */
  emitting?: boolean
}

export type Point = readonly [x: number, y: number]

/**
 * Siluetas vistas desde arriba, morro hacia el norte (-y) y centradas en (0,0).
 * Las proporciones estan exageradas a proposito: en 200x144 un contacto ocupa
 * ~10 px, asi que el F-35 es corto y ancho (ala en delta) y el Su-27 largo y
 * estrecho (doble deriva) para distinguirlos de un vistazo.
 */
const PLANFORMS = {
  f35: [
    [0, -5.6],
    [2, -1.2],
    [8, 3.2],
    [8, 4.4],
    [2.2, 3.4],
    [2.2, 6],
    [-2.2, 6],
    [-2.2, 3.4],
    [-8, 4.4],
    [-8, 3.2],
    [-2, -1.2],
  ],
  su27: [
    [0, -9.8],
    [1.3, -6.2],
    [1.7, -3.2],
    [2.1, 0.4],
    [7.2, 5.2],
    [7.2, 6.3],
    [2.6, 4],
    [2.6, 6.6],
    [3.1, 8.9],
    [1.5, 9],
    [0, 9],
    [-1.5, 9],
    [-3.1, 8.9],
    [-2.6, 6.6],
    [-2.6, 4],
    [-7.2, 6.3],
    [-7.2, 5.2],
    [-2.1, 0.4],
    [-1.7, -3.2],
    [-1.3, -6.2],
  ],
  unknown: [
    [0, -6],
    [6, 3.5],
    [0, 5.5],
    [-6, 3.5],
  ],
} satisfies Record<string, Point[]>

export type PlanformId = keyof typeof PLANFORMS

/** Tipos de aeronave que ya tienen silueta registrada. */
export const PLANFORM_IDS = Object.keys(PLANFORMS) as PlanformId[]

/** Silueta registrada para un tipo de aeronave; neutra si aun no tiene una. */
export function planformFor(aircraft: string): readonly Point[] {
  return PLANFORMS[aircraft as PlanformId] ?? PLANFORMS.unknown
}

/**
 * Indicativo para el radar. El panel mapea la imagen 1:1, asi que el texto
 * compite por pixeles con la silueta: se queda en pocos caracteres.
 */
export function shortLabel(callsign: string, max = 5): string {
  const clean = callsign.trim().toUpperCase()
  if (clean.length <= max) return clean
  // "FLANKER-1" -> "FLANK", pero sin cortar dejando el guion colgando
  return clean.slice(0, max).replace(/[-_ ]+$/, '')
}

/**
 * Distancia y rumbo a coordenadas del radar, con el centro en (0,0).
 * Norte arriba: un blanco al norte queda por encima del centro.
 */
export function plotXY(
  distKm: number,
  bearingDeg: number,
  rangeKm: number,
  radiusPx: number,
): { x: number; y: number } {
  const ratio = rangeKm > 0 ? Math.min(Math.max(distKm, 0) / rangeKm, 1) : 0
  const angle = (bearingDeg * Math.PI) / 180
  const x = Math.sin(angle) * radiusPx * ratio
  const y = -Math.cos(angle) * radiusPx * ratio
  // evita -0 en los ejes, que complica comparaciones
  return { x: x === 0 ? 0 : x, y: y === 0 ? 0 : y }
}

export function drawPlanform(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  angleRad: number,
  points: readonly Point[],
  scale: number,
  color: string,
): void {
  // Las coordenadas ya estan en unidades de "escala 9"; el resto escala lineal.
  const s = scale / 9
  ctx.save()
  ctx.translate(x, y)
  ctx.rotate(angleRad)
  ctx.beginPath()
  points.forEach(([px, py], i) => {
    if (i === 0) ctx.moveTo(px * s, py * s)
    else ctx.lineTo(px * s, py * s)
  })
  ctx.closePath()
  ctx.fillStyle = color
  ctx.fill()
  ctx.restore()
}

export interface LabelArea {
  width: number
  height: number
  /** Separacion entre el icono y el texto. */
  gap: number
  /** Margen minimo con el borde. */
  padX: number
  padY: number
}

export interface LabelPlacement {
  x: number
  y: number
  align: 'left' | 'right'
}

/**
 * Coloca la etiqueta en el lado exterior del contacto (hacia el borde mas
 * cercano) sin salirse del area visible. Pura a proposito: el clamp contra los
 * bordes es lo que mas se rompe al mover el layout.
 */
export function placeLabel(
  px: number,
  py: number,
  textWidth: number,
  area: LabelArea,
): LabelPlacement {
  const toRight = px >= area.width / 2
  const align: LabelPlacement['align'] = toRight ? 'left' : 'right'
  const raw = px + (toRight ? area.gap : -area.gap)
  const x = toRight
    ? Math.min(raw, area.width - area.padX - textWidth)
    : Math.max(raw, area.padX + textWidth)
  const y = Math.min(Math.max(py, area.padY), area.height - area.padY)
  return { x, y, align }
}

/**
 * Marcacion de referencia para la cinta de rumbo del HUD: la del blanco fijado
 * y, si no hay, la del contacto fresco mas cercano. `null` si no hay nada.
 */
export function referenceBearing(
  blips: readonly ScopeBlip[],
  lockedCallsign: string | null,
): number | null {
  if (lockedCallsign) {
    const locked = blips.find(b => b.callsign === lockedCallsign)
    if (locked) return locked.bearingDeg
  }
  const fresh = blips.filter(b => !b.stale).sort((a, b) => a.distKm - b.distKm)[0]
  return fresh ? fresh.bearingDeg : null
}
