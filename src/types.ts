import profiles from './shared/aircraft.json'

/** Clave de los perfiles de aeronave definidos en shared/aircraft.json. */
export type AircraftId = keyof typeof profiles.types

export interface AircraftProfile {
  name: string
  role: string
  rcs: number
  radar: number
  lockSeconds: number
  blurb: string
  /** Arma especial del avion: cambia una regla concreta de la ronda. */
  special?: AircraftSpecial
}

/**
 * Arma especial. `fx` son los numeros que aplica el servidor y `blurb` lo que
 * lee el jugador: el catalogo es la unica fuente para ambos.
 */
export interface AircraftSpecial {
  id: string
  name: string
  blurb: string
  fx?: {
    /** Metros de alcance de fijado (por defecto `lock.rangeM`). */
    rangeM?: number
    /** Apertura del cono en grados (por defecto `lock.fovDeg`). */
    fovDeg?: number
    /** Milisegundos que aguanta el bloqueo sin linea de vision. */
    keepMs?: number
    /** Multiplicador del bloqueo que te cuesta a quien te fija. */
    lockPenalty?: number
    /** Bajas de la ronda que no cuestan puntos. */
    freeDeaths?: number
  }
}

export const AIRCRAFT = profiles.types as Record<AircraftId, AircraftProfile>
export const TICK_MS = profiles.tickMs
/** Alcance de referencia ya escalado al espacio jugable (a pie). */
export const BASE_KM = profiles.baseKm * profiles.scale
/** Suelo de deteccion visual: nadie es invisible a menos de esto. */
export const VISUAL_RANGE_KM = profiles.visualRangeM / 1000
/** Alcance de vision directa: dentro de esto y en el cono, puedes fijar. */
export const LOCK_RANGE_KM = profiles.lock.rangeM / 1000
/** Apertura total del cono de vision, en grados. */
export const LOCK_FOV_DEG = profiles.lock.fovDeg
export const ALERT_METERS = profiles.alertMeters
export const MAX_CONTACTS = profiles.maxContacts
export const SERVER_PORT = profiles.serverPort
export const PING_MEMORY_MS = profiles.pingMemorySeconds * 1000
export const MATCH_SECONDS = profiles.matchSeconds

/** Un contacto tal y como lo manda el servidor (ya filtrado por visibilidad). */
export interface Contact {
  id: string
  callsign: string
  aircraft: AircraftId
  distKm: number
  bearingDeg: number
  kind: 'human' | 'bot'
  /** true si lo tienes dentro del cono de vision: solo esos se pueden fijar. */
  visual: boolean
  /** Altitud del contacto en metros; ausente si su GPS no la da. */
  altM?: number
  /** false si lleva el radar apagado (mas dificil de detectar). */
  emitting?: boolean
  /** true si es el as de la ronda: el que lidera el marcador. */
  ace?: boolean
}

export type MatchPhase = 'flying' | 'finished'

/** Escenario de la ronda: lo mismo para todos los jugadores conectados. */
export interface Scenario {
  id: string
  name: string
  rule: string
}

/** Nota arcade de la partida. S derribo, A victoria por tiempo, B/C/D el resto. */
export type Rank = 'S' | 'A' | 'B' | 'C' | 'D'

/** Progreso de bloqueo del jugador sobre su contacto mas cercano. */
export interface LockState {
  callsign: string
  aircraft: AircraftId
  ms: number
  needMs: number
}

export interface MatchResult {
  winner: string | null
  reason: string
  /** Rango propio; el servidor lo manda ya calculado para cada jugador. */
  rank?: Rank
  /** Puntos conseguidos en la ronda. */
  points?: number
}

/** Quien te esta fijando y cuanto le falta. */
export interface Threat {
  callsign: string
  /** Progreso de su bloqueo sobre ti, 0..100. */
  percent: number
  /** Marcacion desde ti hacia el atacante, 0..359. */
  bearingDeg?: number
}

/** Objetivo de la ronda: uno primario y varios secundarios. */
export interface Objective {
  id: string
  kind: 'primary' | 'secondary'
  label: string
  progress: number
  target: number
  done: boolean
}

/** Estado del radar propio. El servidor decide que ves: el sigilo no se puede falsear. */
export interface RadarState {
  t: number
  phase: MatchPhase
  /** Numero de ronda; lo comparten todos los jugadores a la vez. */
  round?: number
  /** Escenario de la ronda: nombre y regla para la tarjeta de partida. */
  scenario?: Scenario
  /** Milisegundos restantes de partida (o del reinicio si esta terminada). */
  remainingMs: number
  contacts: Contact[]
  you: {
    callsign: string
    aircraft: AircraftId
    lat: number
    lon: number
    /** false si llevas el radar en silencio. */
    emitting?: boolean
    /** Blanco elegido a mano; `null` o ausente = automatico. */
    targetId?: string | null
    /** Marcador de la ronda. */
    score?: number
    kills?: number
    deaths?: number
    /** Milisegundos fuera de juego tras ser derribado; 0 si estas en vuelo. */
    downMs?: number
    /** true si llevas la marca de as. */
    ace?: boolean
  }
  /** Objetivos de la ronda con su progreso. */
  objectives?: Objective[]
  /** Cabeza de la tabla, para marcar al as. */
  leader?: { callsign: string; score: number } | null
  /** Alcance maximo del radar propio contra el blanco mas visible (km). */
  rangeKm: number
  lock: LockState | null
  /** Quien te esta bloqueando a ti, si alguien lo hace. */
  lockedBy: string | null
  /** Detalle de esa amenaza, con el progreso. Ausente si no hay nadie. */
  threat?: Threat | null
  result: MatchResult | null
}

export type ConnState = 'idle' | 'connecting' | 'open' | 'closed' | 'error'
