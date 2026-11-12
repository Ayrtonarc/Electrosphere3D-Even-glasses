// Instrumentos del HUD: etiquetas y escalas.
//
// Puro a proposito: aqui no hay canvas. El pintado vive en screen.ts y esto se
// testea sin DOM, que es donde de verdad se rompen los redondeos y los limites.

export const RANGE_SCALES = [1, 0.65, 0.35] as const
export type RangeScale = (typeof RANGE_SCALES)[number]

const RANGE_LABELS: Record<number, string> = { 1: 'WDE', 0.65: 'MID', 0.35: 'NRW' }

/** Etiqueta corta (3 letras) de la escala de alcance activa. */
export function rangeScaleLabel(scale: number): string {
  const closest = RANGE_SCALES.reduce(
    (best, candidate) => (Math.abs(candidate - scale) < Math.abs(best - scale) ? candidate : best),
    RANGE_SCALES[0] as number,
  )
  return RANGE_LABELS[closest] ?? 'WDE'
}

/**
 * Siguiente escala al girar la rueda. `step` positivo acerca (menos alcance,
 * contactos mas grandes); negativo aleja. Se queda en los extremos.
 */
export function cycleRange(scale: number, step: 1 | -1): RangeScale {
  const found = RANGE_SCALES.indexOf(scale as RangeScale)
  const from = found === -1 ? 0 : found
  const next = Math.min(RANGE_SCALES.length - 1, Math.max(0, from + step))
  return RANGE_SCALES[next]
}

/**
 * Etiqueta de tasa de cierre: ▼ se acerca (la distancia baja) y ▲ se aleja.
 * Vacia mientras no haya dos pings con los que comparar.
 */
export function closureLabel(closureMps: number | undefined, minMps = 0.15): string {
  if (closureMps === undefined || !Number.isFinite(closureMps)) return ''
  if (Math.abs(closureMps) < minMps) return '='
  return closureMps > 0 ? `▼${closureMps.toFixed(1)}` : `▲${Math.abs(closureMps).toFixed(1)}`
}

export interface GpsQuality {
  /** Barras de 0 a 4. */
  bars: number
  /** true si la posicion no es fiable (sin GPS o con error grande). */
  jam: boolean
}

/** Calidad del GPS a partir de la precision horizontal en metros. */
export function gpsQuality(accuracyM: number | null, simulated = false): GpsQuality {
  if (simulated) return { bars: 0, jam: true }
  if (accuracyM === null || !Number.isFinite(accuracyM) || accuracyM < 0) return { bars: 0, jam: true }
  if (accuracyM <= 10) return { bars: 4, jam: false }
  if (accuracyM <= 20) return { bars: 3, jam: false }
  if (accuracyM <= 30) return { bars: 2, jam: false }
  if (accuracyM <= 60) return { bars: 1, jam: false }
  return { bars: 0, jam: true }
}

/**
 * Diferencia de altitud con el blanco, relativa a ti: `A+12m`.
 * Vacia si falta cualquiera de las dos altitudes.
 */
export function altitudeDelta(contactAltM?: number, ownAltM?: number | null): string {
  if (contactAltM === undefined || !Number.isFinite(contactAltM)) return ''
  if (ownAltM === undefined || ownAltM === null || !Number.isFinite(ownAltM)) return ''
  const delta = Math.round(contactAltM - ownAltM)
  if (delta === 0) return 'A0m'
  return `A${delta > 0 ? '+' : ''}${delta}m`
}
