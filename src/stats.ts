/**
 * Ficha táctica de la aeronave que llevas.
 *
 * Los números que importan no son los del catalogo (`radar: 1`, `rcs: 0.001`)
 * sino los que salen de cruzarlos con las reglas: a cuantos metros ves y a
 * cuantos te ven. Es la misma cuenta que hace el servidor, asi que lo que lees
 * en el movil es lo que se aplica en la ronda.
 */

import { AIRCRAFT, BASE_KM, VISUAL_RANGE_KM, type AircraftId } from './types'
import { detectRangeKm, formatKm } from './geo'

/**
 * RCS del blanco mas ruidoso del juego (Su-27). Se usa como escaparate del
 * alcance propio: es el mejor caso, y asi el numero no enganna.
 */
const LOUDEST_RCS = 12

/** Radar de referencia para responder a "a que distancia me ven". */
const REFERENCE_RADAR = 1

export type StatId = 'rcs' | 'radar' | 'lock' | 'seen'

export interface Stat {
  id: StatId
  label: string
  value: string
}

/** Nombre y papel, para la cabecera de la ficha. */
export function aircraftTitle(id: AircraftId): string {
  const me = AIRCRAFT[id]
  return `${me.name} · ${me.role}`
}

export interface SpecialInfo {
  name: string
  blurb: string
}

/** Arma especial del avion, o `null` si el catalogo no define ninguna. */
export function aircraftSpecial(id: AircraftId): SpecialInfo | null {
  const special = AIRCRAFT[id].special
  return special ? { name: special.name, blurb: special.blurb } : null
}

export function aircraftStats(id: AircraftId): Stat[] {
  const me = AIRCRAFT[id]
  const radarKm = detectRangeKm(me.radar, LOUDEST_RCS, BASE_KM, VISUAL_RANGE_KM)
  const seenKm = detectRangeKm(REFERENCE_RADAR, me.rcs, BASE_KM, VISUAL_RANGE_KM)

  return [
    { id: 'rcs', label: 'RCS', value: `${me.rcs} m²` },
    { id: 'radar', label: 'Radar', value: formatKm(radarKm) },
    { id: 'lock', label: 'Fija en', value: `${me.lockSeconds} s` },
    { id: 'seen', label: 'Te ven a', value: formatKm(seenKm) },
  ]
}

/** Una fila del comparador: el nombre, sus cuatro cifras y su arma. */
export interface ComparisonRow {
  id: AircraftId
  name: string
  stats: Stat[]
  special: string
}

/** Todos los aviones del catalogo, en el orden en que se declaran. */
export function comparisonRows(): ComparisonRow[] {
  return (Object.keys(AIRCRAFT) as AircraftId[]).map(id => ({
    id,
    name: AIRCRAFT[id].name,
    stats: aircraftStats(id),
    special: aircraftSpecial(id)?.name ?? '—',
  }))
}
