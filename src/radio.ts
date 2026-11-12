/**
 * Radio: la voz del sistema de a bordo.
 *
 * No hay personajes. Esto es jugador contra jugador, y nadie va a fingir un
 * AWACS ni un companero de ala: habla el avion. Por eso todo lo que dice son
 * hechos del tablon —quien te fija, cuantos puntos llevas, quien lidera— y
 * nunca un guion.
 *
 * Se separa en dos mitades a proposito:
 *
 * - `planRadio` es una funcion pura que, comparando el radar anterior con el
 *   actual, decide SI hay algo que decir y QUE. Asi se puede testear el guion
 *   entero sin sintetizador.
 * - `browserSpeaker` es el pegamento con `speechSynthesis`, diez lineas que no
 *   merecen otro nivel de indireccion.
 *
 * Con el movil en el bolsillo, la voz es la unica forma de enterarte de que te
 * estan fijando sin mirar las gafas.
 */

import { lockPercent, MISSILE_PERCENT } from './hud'
import { AIRCRAFT, type AircraftId, type MatchPhase, type RadarState } from './types'
import type { TrackedContact } from './track'

export type RadioUrgency = 'info' | 'alert'

export interface RadioLine {
  text: string
  /** Un aviso interrumpe la locucion en curso; la chachara espera turno. */
  urgency: RadioUrgency
  /** Clave anti-repeticion: la misma frase no se suelta dos veces seguidas. */
  key: string
}

export interface RadioContact {
  callsign: string
  aircraft: AircraftId
  bearingDeg: number
  distKm: number
}

/** Lo minimo que hace falta para decidir la siguiente frase. */
export interface RadioSnapshot {
  /** `null` si no hay radar (sin conectar). */
  phase: MatchPhase | null
  me: string | null
  winner: string | null
  rank: string | null
  lockCallsign: string | null
  lockPercent: number
  threatCallsign: string | null
  threatPercent: number
  /** Marcador propio. */
  score: number
  kills: number
  deaths: number
  /** Cabeza de la tabla, si alguien ha puntuado. */
  leaderCallsign: string | null
  leaderScore: number
  /** El objetivo primario de la ronda ya esta cumplido. */
  primaryDone: boolean
  /** Contactos frescos, ordenados por distancia. */
  contacts: RadioContact[]
}

/**
 * A este progreso del que te fija, la radio deja de avisar y grita. Es el
 * mismo umbral que el HUD a proposito: lo que se ve es lo que se oye.
 */
export const MISSILE_VOICE_PERCENT = MISSILE_PERCENT

/** Hueco minimo entre frases informativas: la radio no puede ir a su bola. */
export const INFO_GAP_MS = 4000
/** Los avisos tambien tienen un minimo, pero mucho mas corto. */
export const ALERT_GAP_MS = 1500

export function snapshotOf(radar: RadarState | null, tracks: TrackedContact[]): RadioSnapshot {
  const fresh = tracks.filter(t => !t.stale)
  return {
    phase: radar?.phase ?? null,
    me: radar?.you.callsign ?? null,
    winner: radar?.result?.winner ?? null,
    rank: radar?.result?.rank ?? null,
    lockCallsign: radar?.lock?.callsign ?? null,
    lockPercent: radar?.lock ? lockPercent(radar.lock.ms, radar.lock.needMs) : 0,
    threatCallsign: radar?.threat?.callsign ?? radar?.lockedBy ?? null,
    threatPercent: radar?.threat?.percent ?? 0,
    score: radar?.you.score ?? 0,
    kills: radar?.you.kills ?? 0,
    deaths: radar?.you.deaths ?? 0,
    leaderCallsign: radar?.leader?.callsign ?? null,
    leaderScore: radar?.leader?.score ?? 0,
    primaryDone: radar?.objectives?.some(o => o.kind === 'primary' && o.done) ?? false,
    contacts: fresh.map(t => ({
      callsign: t.callsign,
      aircraft: t.aircraft,
      bearingDeg: t.bearingDeg,
      distKm: t.distKm,
    })),
  }
}

const threeDigits = (deg: number) => String(Math.round(deg) % 360).padStart(3, '0')

/**
 * El guion. Compara dos fotos del radar y devuelve como mucho una frase: la
 * mas urgente. El orden importa — lo que te puede derribar va primero.
 */
export function planRadio(prev: RadioSnapshot | null, next: RadioSnapshot): RadioLine | null {
  // 1. Amenaza: misil encima, o alguien que acaba de fijarte.
  if (
    next.threatCallsign &&
    next.threatPercent >= MISSILE_VOICE_PERCENT &&
    (prev?.threatPercent ?? 0) < MISSILE_VOICE_PERCENT
  ) {
    return { text: 'Misil entrante. Rompe el contacto.', urgency: 'alert', key: 'missile' }
  }
  if (next.threatCallsign && next.threatCallsign !== prev?.threatCallsign) {
    return {
      text: `${next.threatCallsign} nos tiene fijados.`,
      urgency: 'alert',
      key: `threat:${next.threatCallsign}`,
    }
  }

  // 2. Resultado y cambio de partida.
  if (next.phase === 'finished' && prev?.phase !== 'finished') {
    const won = next.winner !== null && next.winner === next.me
    if (won) return { text: 'Blanco derribado. Buen trabajo.', urgency: 'alert', key: 'result:win' }
    if (next.winner) {
      return {
        text: `Nos han derribado. ${next.winner} se lleva la partida.`,
        urgency: 'alert',
        key: 'result:lose',
      }
    }
    return { text: 'Fin de la partida. Nadie ha fijado un blanco.', urgency: 'info', key: 'result:draw' }
  }
  if (next.phase === 'flying' && prev?.phase === 'finished') {
    return { text: 'Nueva partida. Radar barriendo.', urgency: 'info', key: 'match:new' }
  }
  if (next.phase !== null && prev?.phase == null) {
    return { text: 'Aeronet, en vuelo. Radar activo.', urgency: 'info', key: 'match:first' }
  }

  // 3. El tablon: lo que ha cambiado en la ronda. Son hechos, no guion.
  if (next.deaths > (prev?.deaths ?? 0)) {
    return { text: 'Te han derribado. Vuelves en diez segundos.', urgency: 'alert', key: 'down' }
  }
  if (next.kills > (prev?.kills ?? 0)) {
    return {
      text: `Derribo confirmado. ${next.score} puntos.`,
      urgency: 'alert',
      key: `kill:${next.kills}`,
    }
  }
  if (next.primaryDone && !prev?.primaryDone) {
    return { text: 'Objetivo primario cumplido.', urgency: 'info', key: 'objective:primary' }
  }
  if (next.leaderCallsign && next.leaderCallsign !== prev?.leaderCallsign) {
    return next.leaderCallsign === next.me
      ? { text: 'Lideras la ronda.', urgency: 'info', key: 'lead:me' }
      : {
          text: `${next.leaderCallsign} lidera con ${next.leaderScore} puntos.`,
          urgency: 'info',
          key: `lead:${next.leaderCallsign}`,
        }
  }

  // 4. Bloqueo propio.
  if (next.lockCallsign && next.lockCallsign !== prev?.lockCallsign) {
    return {
      text: `Fijando ${next.lockCallsign}.`,
      urgency: 'info',
      key: `lock:${next.lockCallsign}`,
    }
  }
  if (next.lockCallsign && next.lockPercent >= 50 && (prev?.lockPercent ?? 0) < 50) {
    return {
      text: 'Manten el bloqueo. Estas cerca.',
      urgency: 'info',
      key: `half:${next.lockCallsign}`,
    }
  }

  // 5. Contactos nuevos y perdidos.
  const before = new Set((prev?.contacts ?? []).map(c => c.callsign))
  const added = next.contacts.find(c => !before.has(c.callsign))
  if (added) {
    const name = AIRCRAFT[added.aircraft]?.name ?? 'Contacto'
    return {
      text: `${name}, ${threeDigits(added.bearingDeg)}, ${Math.round(added.distKm * 1000)} metros.`,
      urgency: 'info',
      key: `contact:${added.callsign}`,
    }
  }
  const now = new Set(next.contacts.map(c => c.callsign))
  const lost = (prev?.contacts ?? []).find(c => !now.has(c.callsign))
  if (lost) {
    return { text: `Contacto perdido, ${lost.callsign}.`, urgency: 'info', key: `lost:${lost.callsign}` }
  }

  return null
}

/** Lo unico que necesita `Radio` del navegador. */
export interface Speaker {
  say(line: RadioLine): void
  cancel(): void
}

export interface SpeechLike {
  cancel(): void
  speak(utterance: SpeechSynthesisUtterance): void
  readonly speaking: boolean
}

/**
 * `make` se inyecta para poder testear el envoltorio sin sintetizador real:
 * `SpeechSynthesisUtterance` no existe fuera del navegador.
 */
export function browserSpeaker(
  synth: SpeechLike | undefined = (globalThis as { speechSynthesis?: SpeechLike }).speechSynthesis,
  make: (text: string) => SpeechSynthesisUtterance | null = text =>
    typeof SpeechSynthesisUtterance === 'undefined' ? null : new SpeechSynthesisUtterance(text),
): Speaker {
  return {
    say(line) {
      if (!synth) return
      // Un aviso corta lo que este sonando; la chachara no se encola, se pierde:
      // una cola larga acabaria contando cosas de hace un minuto.
      if (line.urgency === 'alert') synth.cancel()
      else if (synth.speaking) return

      const utterance = make(line.text)
      if (!utterance) return
      utterance.lang = 'es-ES'
      utterance.rate = 1.05
      utterance.pitch = 0.85
      utterance.volume = 1
      synth.speak(utterance)
    },
    cancel() {
      synth?.cancel()
    },
  }
}

/**
 * Une el guion con el altavoz y aplica los huecos: sin esto, un contacto que
 * oscila entre verse y no verse soltaria una frase por segundo.
 */
export class Radio {
  private prev: RadioSnapshot | null = null
  private spoken = new Map<string, number>()
  private enabled = true

  constructor(
    private readonly speaker: Speaker,
    private readonly now: () => number = () => Date.now(),
  ) {}

  get isEnabled(): boolean {
    return this.enabled
  }

  setEnabled(on: boolean): void {
    this.enabled = on
    if (!on) this.speaker.cancel()
  }

  /** Al desconectar o cambiar de sesion no se arrastra el contexto anterior. */
  reset(): void {
    this.prev = null
    this.spoken.clear()
    this.speaker.cancel()
  }

  update(radar: RadarState | null, tracks: TrackedContact[]): RadioLine | null {
    const next = snapshotOf(radar, tracks)
    const line = this.enabled ? planRadio(this.prev, next) : null
    // La foto se guarda aunque este en silencio: al reactivar la radio no debe
    // soltar de golpe todo lo que ha pasado mientras estaba muda.
    this.prev = next
    if (!line) return null

    const gap = line.urgency === 'alert' ? ALERT_GAP_MS : INFO_GAP_MS
    const at = this.now()
    if (at - (this.spoken.get(line.key) ?? -Infinity) < gap) return null

    this.spoken.set(line.key, at)
    this.speaker.say(line)
    return line
  }
}
