import { describe, expect, it } from 'vitest'
import { backoffMs, Reconnector, type RetryTimer } from './reconnect'

/** Temporizador manual: nada de esperas reales ni de fake timers globales. */
function fakeTimer() {
  let nextId = 1
  const pending = new Map<number, { fn: () => void; ms: number }>()
  const cashed: number[] = []

  const timer: RetryTimer = {
    set(fn, ms) {
      const id = nextId++
      pending.set(id, { fn, ms })
      return id
    },
    clear(handle) {
      cashed.push(handle as number)
      pending.delete(handle as number)
    },
  }

  return {
    timer,
    /** Ejecuta el unico reintento en cola. */
    fire() {
      const entry = [...pending.entries()][0]
      if (!entry) throw new Error('no hay reintento en cola')
      pending.delete(entry[0])
      entry[1].fn()
    },
    get size() {
      return pending.size
    },
    get delay() {
      return [...pending.values()][0]?.ms ?? 0
    },
    cashed,
  }
}

describe('backoffMs', () => {
  // random fijo a 0.5 => factor de ruido exactamente 1, valores legibles.
  const flat = { random: () => 0.5 }

  it('crece al doble y se queda en el tope', () => {
    const waits = [0, 1, 2, 3, 4, 5, 6].map(n => backoffMs(n, flat))
    expect(waits).toEqual([1000, 2000, 4000, 8000, 15000, 15000, 15000])
  })

  it('respeta base y tope configurables', () => {
    const opts = { ...flat, baseMs: 200, capMs: 1000 }
    expect([0, 1, 2, 3, 4].map(n => backoffMs(n, opts))).toEqual([200, 400, 800, 1000, 1000])
  })

  it('el ruido no saca el valor del rango util', () => {
    const low = backoffMs(3, { random: () => 0 })
    const high = backoffMs(3, { random: () => 1 })
    expect(low).toBe(6800) // 8000 * 0,85
    expect(high).toBe(9200) // 8000 * 1,15
    // En el tope el ruido solo puede bajar: nunca se espera mas de `capMs`.
    expect(backoffMs(9, { random: () => 1 })).toBe(15_000)
    expect(backoffMs(9, { random: () => 0 })).toBe(12_750)
  })

  it('nunca devuelve cero ni negativos', () => {
    expect(backoffMs(-5, flat)).toBe(1000)
    expect(backoffMs(2, { ...flat, baseMs: 0, capMs: 0 })).toBe(1)
  })
})

describe('Reconnector', () => {
  it('programa un reintento tras la caida', () => {
    const clock = fakeTimer()
    let calls = 0
    const retry = new Reconnector(() => calls++, { random: () => 0.5, timer: clock.timer })

    expect(retry.dropped()).toBe(1000)
    expect(clock.delay).toBe(1000)
    expect(retry.waiting).toBe(true)
    expect(calls).toBe(0)

    clock.fire()
    expect(calls).toBe(1)
    expect(retry.waiting).toBe(false)
  })

  it('error y close seguidos no cuentan como dos fallos', () => {
    const clock = fakeTimer()
    const retry = new Reconnector(() => {}, { random: () => 0.5, timer: clock.timer })

    expect(retry.dropped()).toBe(1000)
    expect(retry.dropped()).toBe(-1)
    expect(retry.attempts).toBe(1)
    expect(clock.size).toBe(1)
  })

  it('la espera crece con cada fallo', () => {
    const clock = fakeTimer()
    const retry = new Reconnector(() => {}, { random: () => 0.5, timer: clock.timer })

    const waits: number[] = []
    for (let i = 0; i < 4; i++) {
      waits.push(retry.dropped())
      clock.fire()
    }
    expect(waits).toEqual([1000, 2000, 4000, 8000])
  })

  it('al conectar se olvida el historial y se cancela lo pendiente', () => {
    const clock = fakeTimer()
    let calls = 0
    const retry = new Reconnector(() => calls++, { random: () => 0.5, timer: clock.timer })

    retry.dropped()
    retry.dropped()
    retry.reset()

    expect(retry.waiting).toBe(false)
    expect(retry.attempts).toBe(0)
    expect(clock.size).toBe(0)
    expect(clock.cashed).toHaveLength(1)
    // El historial se ha borrado: el proximo fallo vuelve a empezar por 1 s.
    expect(retry.dropped()).toBe(1000)
  })

  it('cancelar no toca el historial', () => {
    const clock = fakeTimer()
    const retry = new Reconnector(() => {}, { random: () => 0.5, timer: clock.timer })

    retry.dropped()
    retry.dropped()
    retry.cancel()

    expect(retry.waiting).toBe(false)
    expect(retry.attempts).toBe(1)
    expect(retry.pendingDelay).toBe(0)
    expect(retry.nextDelay()).toBe(2000)
  })

  it('expone la espera en curso para poder mostrarla', () => {
    const clock = fakeTimer()
    const retry = new Reconnector(() => {}, { random: () => 0.5, timer: clock.timer })

    retry.dropped()
    expect(retry.pendingDelay).toBe(1000)
    retry.cancel()
    expect(retry.pendingDelay).toBe(0)
  })
})
