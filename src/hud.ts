import {
  ALERT_METERS,
  AIRCRAFT,
  type AircraftId,
  type ConnState,
  type RadarState,
} from './types'
import { formatKm } from './geo'
import { aircraftSpecial, aircraftStats, aircraftTitle } from './stats'
import type { TrackedContact } from './track'

const ARROWS = ['↑', '↗', '→', '↘', '↓', '↙', '←', '↖']

export function arrowFor(bearing: number): string {
  const normalized = ((bearing % 360) + 360) % 360
  return ARROWS[Math.round(normalized / 45) % 8]
}

/** mm:ss */
export function clock(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000))
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`
}

/** Progreso de bloqueo en porcentaje, acotado a 0..100. */
export function lockPercent(ms: number, needMs: number): number {
  if (needMs <= 0) return 0
  return Math.max(0, Math.min(100, Math.round((ms / needMs) * 100)))
}

/** Barra de bloqueo con extremos, para que se vea donde acaba: [####----] */
export function lockBar(ms: number, needMs: number, cells = 8): string {
  const filled = Math.round((lockPercent(ms, needMs) / 100) * cells)
  return `[${'#'.repeat(filled)}${'-'.repeat(cells - filled)}]`
}

/** Distancia compacta para la columna estrecha: 220m / 1.2km */
export function compactKm(km: number): string {
  return km < 1 ? `${Math.round(km * 1000)}m` : `${km.toFixed(1)}km`
}

/**
 * A partir de este progreso del que te fija, el aviso deja de ser "te
 * bloquean" y pasa a ser "MISSILE": a falta de un tercio, ya no da tiempo a
 * nada que no sea romper el contacto.
 */
export const MISSILE_PERCENT = 70

export interface HudInput {
  view: 'radar' | 'info'
  callsign: string
  aircraft: AircraftId
  conn: ConnState
  connDetail?: string
  radar: RadarState | null
  /** Contactos con memoria de pings (frescos primero, luego ultima posicion conocida). */
  tracks: TrackedContact[]
  gpsSimulated: boolean
  /** Rumbo propio, para convertir marcaciones en flechas relativas. */
  headingDeg?: number | null
}

/** Cada campo va a un contenedor distinto del display. */
export interface HudTexts {
  /** Banda superior (576x40): la situacion. */
  alert: string
  /** Columna derecha (372x196): progreso de bloqueo y contactos. */
  detail: string
  /** Bajo el radar (200x48): tu avion y tu alcance. */
  info: string
  /** Pie (576x40): reloj y acciones. */
  footer: string
}

function connectionAlert(conn: ConnState, detail?: string): string {
  switch (conn) {
    case 'connecting':
      return 'CONECTANDO CON EL ESCUADRON...'
    case 'error':
      return `ERROR · ${detail ?? 'SIN ENLACE'}`
    case 'closed':
      return 'ENLACE PERDIDO · PULSA TAP'
    case 'idle':
      return 'SIN CONECTAR · ABRE LA APP'
    default:
      return ''
  }
}

function contactLine(track: TrackedContact, lockedCallsign: string | null): string {
  const name = AIRCRAFT[track.aircraft].name
  if (track.stale) {
    return `? ${name} ${compactKm(track.distKm)} ${Math.round(track.ageMs / 1000)}s`
  }
  const marker = lockedCallsign && track.callsign === lockedCallsign ? '*' : arrowFor(track.bearingDeg)
  return `${marker} ${name} ${compactKm(track.distKm)} ${String(Math.round(track.bearingDeg)).padStart(3, '0')}°`
}

export function renderHud(input: HudInput): HudTexts {
  const { view, callsign, aircraft, conn, connDetail, radar, tracks, gpsSimulated, headingDeg } = input
  const me = AIRCRAFT[aircraft]
  const phase = radar?.phase ?? 'flying'
  const lock = radar?.lock ?? null
  const lockedBy = radar?.lockedBy ?? null
  const threat = radar?.threat ?? null
  const missile = threat && threat.percent >= MISSILE_PERCENT ? threat : null
  const winner = radar?.result?.winner ?? null
  const rank = radar?.result?.rank ?? null
  const round = radar?.round ?? null
  const scenario = radar?.scenario ?? null
  const remainingMs = radar?.remainingMs ?? 0
  const rangeKm = radar?.rangeKm ?? 0
  const offline = conn !== 'open'

  const fresh = tracks.filter(t => !t.stale)
  const nearest = fresh[0]
  const threatKm = ALERT_METERS / 1000

  const downMs = radar?.you.downMs ?? 0
  const points = radar?.you.score ?? 0
  const primary = radar?.objectives?.find(o => o.kind === 'primary') ?? null

  /**
   * Flecha hacia la amenaza. Con rumbo conocido es relativa a tu morro (↑ = de
   * frente); sin rumbo fiable se cae a la brujula, que es lo unico honesto.
   */
  const dirOf = (target: { bearingDeg?: number } | null): string | null => {
    if (!target || target.bearingDeg == null) return null
    return arrowFor(((target.bearingDeg - (headingDeg ?? 0)) % 360 + 360) % 360)
  }

  // El aviso lleva la SITUACION (quien es la amenaza); la columna, el progreso.
  let alert: string
  if (offline) {
    alert = connectionAlert(conn, connDetail)
  } else if (phase === 'finished') {
    const suffix = rank ? ` · ${rank}` : ''
    alert = winner ? (winner === callsign ? `VICTORIA${suffix}` : `GANA ${winner}`) : `EMPATE${suffix}`
  } else if (downMs > 0) {
    alert = `DERRIBADO · ${Math.ceil(downMs / 1000)} s`
  } else if (missile) {
    const dir = dirOf(missile)
    alert = dir ? `!! MISSILE ${dir} ${missile.callsign}` : `!! MISSILE · ${missile.callsign}`
  } else if (lockedBy) {
    const dir = dirOf(threat)
    alert = dir ? `!! TE BLOQUEAN ${dir} · ${lockedBy}` : `!! TE BLOQUEAN · ${lockedBy}`
  } else if (nearest && nearest.distKm <= threatKm) {
    alert = `! ${AIRCRAFT[nearest.aircraft].name} A ${formatKm(nearest.distKm)}`
  } else if (lock) {
    alert = `BLOQUEANDO · ${lock.callsign}`
  } else if (primary && !primary.done) {
    // El objetivo de la ronda vive donde antes estaba el contador de contactos:
    // es lo que hay que mirar cuando no pasa nada.
    alert = `${primary.label} · ${primary.progress}/${primary.target}`
  } else if (view === 'info') {
    alert = `${me.name} · ${me.role}`
  } else {
    alert = `${fresh.length} CONTACTO${fresh.length === 1 ? '' : 'S'}`
  }

  let detail: string
  let info: string
  let footer: string

  if (offline) {
    detail = ['AERONET · G2', '', 'Abre la companion', 'y conecta.', '', '2x: salir'].join('\n')
    info = me.name
    footer = 'TAP: info · 2x: salir'
  } else if (phase === 'finished') {
    const lines = [
      winner ? (winner === callsign ? 'BLANCO DERRIBADO' : `GANADOR: ${winner}`) : 'NADIE GANA',
    ]
    if (rank) lines.push(`RANGO ${rank} · ${radar?.result?.points ?? 0} PTS`)
    if (round !== null && scenario) lines.push(`RONDA ${round} · ${scenario.name.toUpperCase()}`)
    lines.push('', 'Nueva partida', 'en unos segundos')
    detail = lines.join('\n')
    info = `${me.name}\nR ${formatKm(rangeKm)}`
    footer = `Nueva partida en ${Math.ceil(remainingMs / 1000)} s`
  } else if (view === 'info') {
    // Misma fuente que la ficha del movil: si cambia la formula, cambian las dos.
    const stats = aircraftStats(aircraft)
    const range = stats.find(s => s.id === 'radar')?.value ?? '—'
    const special = aircraftSpecial(aircraft)
    detail = [
      aircraftTitle(aircraft).toUpperCase(),
      ...stats.map(s => `${s.label} ${s.value}`),
      ...(special ? [`SPW ${special.name}`] : []),
      gpsSimulated ? 'GPS simulado' : 'GPS activo',
    ].join('\n')
    info = `${me.name}\nR ${range}`
    footer = `${clock(remainingMs)} · 2v: alcance · TAP: radar`
  } else {
    const lines: string[] = []
    if (lock) {
      lines.push(`${lockBar(lock.ms, lock.needMs)} ${(lock.ms / 1000).toFixed(1)}/${Math.round(lock.needMs / 1000)}s`)
    }

    const room = lock ? 4 : 5
    for (const track of tracks.slice(0, room)) {
      lines.push(contactLine(track, lock?.callsign ?? null))
    }

    detail = lines.length ? lines.join('\n') : 'SIN CONTACTOS\n\nMuevete para barrer.'
    info = `${me.name}\nR ${formatKm(rangeKm)}`
    footer = `${clock(remainingMs)} · ${points} PTS · 2v: blanco`
  }

  return { alert, detail, info, footer }
}
