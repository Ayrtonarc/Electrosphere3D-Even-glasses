import { describe, expect, it } from 'vitest'
import { EMPTY_RECORD, loadRecord, RECORD_KEY, recordLabel, saveRecord, settleRound } from './record'
import type { RoundOutcome } from './record'

const outcome = (over: Partial<RoundOutcome> = {}): RoundOutcome => ({
  round: 1,
  winner: 'VIPER-1',
  me: 'VIPER-1',
  rank: 'S',
  ...over,
})

describe('settleRound', () => {
  it('cuenta la victoria y arranca la racha', () => {
    expect(settleRound(EMPTY_RECORD, outcome())).toMatchObject({
      rounds: 1,
      wins: 1,
      streak: 1,
      bestStreak: 1,
      bestRank: 'S',
    })
  })

  it('es idempotente por número de ronda', () => {
    const once = settleRound(EMPTY_RECORD, outcome())
    const twice = settleRound(once, outcome())
    expect(twice).toBe(once)
    expect(twice.rounds).toBe(1)
  })

  it('una derrota corta la racha pero no borra el récord', () => {
    let record = settleRound(EMPTY_RECORD, outcome())
    record = settleRound(record, outcome({ round: 2 }))
    record = settleRound(record, outcome({ round: 3, winner: 'GHOST-1', rank: 'C' }))

    expect(record).toMatchObject({ rounds: 3, wins: 2, streak: 0, bestStreak: 2, bestRank: 'S' })
  })

  it('nunca baja la mejor nota', () => {
    const record = settleRound(
      settleRound(EMPTY_RECORD, outcome()),
      outcome({ round: 2, rank: 'D' }),
    )
    expect(record.bestRank).toBe('S')
  })

  it('un empate no es una victoria', () => {
    const record = settleRound(EMPTY_RECORD, outcome({ winner: null, rank: 'D' }))
    expect(record).toMatchObject({ rounds: 1, wins: 0, streak: 0 })
  })

  it('sin número de ronda cuenta igual', () => {
    expect(settleRound(EMPTY_RECORD, outcome({ round: null })).rounds).toBe(1)
  })
})

function fakeStorage(init: Record<string, string> = {}) {
  const data = { ...init }
  return {
    data,
    getItem: (key: string) => data[key] ?? null,
    setItem: (key: string, value: string) => {
      data[key] = value
    },
  }
}

describe('almacenamiento', () => {
  it('guarda y recupera', () => {
    const storage = fakeStorage()
    saveRecord(storage, settleRound(EMPTY_RECORD, outcome()))

    expect(storage.data[RECORD_KEY]).toBeTypeOf('string')
    expect(loadRecord(storage)).toMatchObject({ rounds: 1, wins: 1, bestRank: 'S' })
  })

  it('un récord corrupto no rompe nada', () => {
    expect(loadRecord(fakeStorage({ [RECORD_KEY]: '{{{' }))).toEqual(EMPTY_RECORD)
  })

  it('descarta valores absurdos', () => {
    const storage = fakeStorage({
      [RECORD_KEY]: JSON.stringify({ rounds: -3, wins: 'muchas', bestRank: 'Z' }),
    })
    expect(loadRecord(storage)).toEqual(EMPTY_RECORD)
  })

  it('sin almacenamiento devuelve vacío y no lanza al guardar', () => {
    expect(loadRecord(undefined)).toEqual(EMPTY_RECORD)
    expect(() => saveRecord(undefined, EMPTY_RECORD)).not.toThrow()
  })
})

describe('recordLabel', () => {
  it('resume racha y mejor nota', () => {
    let record = settleRound(EMPTY_RECORD, outcome())
    record = settleRound(record, outcome({ round: 2 }))
    expect(recordLabel(record)).toBe('2/2 rondas · 2 seguidas · mejor S')
  })

  it('con la racha cortada muestra el récord', () => {
    let record = settleRound(EMPTY_RECORD, outcome())
    record = settleRound(record, outcome({ round: 2 }))
    record = settleRound(record, outcome({ round: 3, winner: 'GHOST-1', rank: 'B' }))
    expect(recordLabel(record)).toBe('2/3 rondas · récord 2 · mejor S')
  })

  it('sin rondas no hay línea', () => {
    expect(recordLabel(EMPTY_RECORD)).toBeNull()
  })
})
