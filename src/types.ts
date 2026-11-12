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
}

export type MatchPhase = 'flying' | 'finished'

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
  /** Mejor bloqueo de la partida en porcentaje del necesario (0..100). */
  score?: number
}

/** Quien te esta fijando y cuanto le falta. */
export interface Threat {
  callsign: string
  /** Progreso de su bloqueo sobre ti, 0..100. */
  percent: number
}

/** Estado del radar propio. El servidor decide que ves: el sigilo no se puede falsear. */
export interface RadarState {
  t: number
  phase: MatchPhase
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
  }
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
