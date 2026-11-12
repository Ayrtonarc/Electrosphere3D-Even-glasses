/**
 * Récord del jugador, en el propio móvil.
 *
 * No hay cuentas ni servidor que guarde nada: el récord vive en `localStorage`.
 * Lo importante es que se contabilice **una sola vez por ronda** — durante el
 * marcador `setRadar` corre una vez por segundo durante 12 s, así que contar
 * sin filtro convertiría una victoria en una racha de doce.
 */

import type { Rank } from './types'

export interface PlayerRecord {
  rounds: number
  wins: number
  /** Victorias seguidas ahora mismo. */
  streak: number
  bestStreak: number
  bestRank: Rank | null
  /** Última ronda contabilizada; `null` si no se ha jugado ninguna. */
  lastRound: number | null
}

export const EMPTY_RECORD: PlayerRecord = {
  rounds: 0,
  wins: 0,
  streak: 0,
  bestStreak: 0,
  bestRank: null,
  lastRound: null,
}

/** Orden de peor a mejor: el índice es la nota. */
const RANKS: Rank[] = ['D', 'C', 'B', 'A', 'S']

export function rankScore(rank: Rank | null): number {
  return rank ? RANKS.indexOf(rank) : -1
}

export function bestOf(a: Rank | null, b: Rank | null): Rank | null {
  return rankScore(b) > rankScore(a) ? b : a
}

export interface RoundOutcome {
  /** Número de ronda del servidor; `null` si un servidor viejo no lo manda. */
  round: number | null
  winner: string | null
  me: string
  rank: Rank | null
}

/** Contabiliza una ronda. Idempotente por número de ronda. */
export function settleRound(prev: PlayerRecord, outcome: RoundOutcome): PlayerRecord {
  if (outcome.round != null && prev.lastRound === outcome.round) return prev

  const won = outcome.winner !== null && outcome.winner === outcome.me
  const streak = won ? prev.streak + 1 : 0

  return {
    rounds: prev.rounds + 1,
    wins: prev.wins + (won ? 1 : 0),
    streak,
    bestStreak: Math.max(prev.bestStreak, streak),
    bestRank: bestOf(prev.bestRank, outcome.rank),
    lastRound: outcome.round ?? prev.lastRound,
  }
}

/** Lo mínimo de `localStorage` que hace falta, para poder falsearlo en tests. */
export interface StorageLike {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

export const RECORD_KEY = 'aeronet:record'

function isRank(value: unknown): value is Rank {
  return typeof value === 'string' && (RANKS as string[]).includes(value)
}

function count(value: unknown): number {
  const n = Number(value)
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0
}

export function loadRecord(storage: StorageLike | undefined): PlayerRecord {
  try {
    const raw = storage?.getItem(RECORD_KEY)
    if (!raw) return EMPTY_RECORD
    const parsed = JSON.parse(raw) as Partial<PlayerRecord>
    return {
      rounds: count(parsed.rounds),
      wins: count(parsed.wins),
      streak: count(parsed.streak),
      bestStreak: count(parsed.bestStreak),
      bestRank: isRank(parsed.bestRank) ? parsed.bestRank : null,
      lastRound: typeof parsed.lastRound === 'number' ? parsed.lastRound : null,
    }
  } catch {
    // Récord corrupto o almacenamiento bloqueado: se empieza de cero sin romper.
    return EMPTY_RECORD
  }
}

export function saveRecord(storage: StorageLike | undefined, record: PlayerRecord): void {
  try {
    storage?.setItem(RECORD_KEY, JSON.stringify(record))
  } catch {
    /* modo privado: se juega igual, solo que sin récord */
  }
}

/** Una línea para el debriefing: `2/3 rondas · 2 seguidas · mejor S`. */
export function recordLabel(record: PlayerRecord): string | null {
  if (record.rounds === 0) return null

  const parts = [`${record.wins}/${record.rounds} rondas`]
  if (record.streak >= 2) parts.push(`${record.streak} seguidas`)
  else if (record.bestStreak >= 2) parts.push(`récord ${record.bestStreak}`)
  if (record.bestRank) parts.push(`mejor ${record.bestRank}`)

  return parts.join(' · ')
}
