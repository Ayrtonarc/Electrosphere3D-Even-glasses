import { describe, expect, it } from 'vitest'
import { TrackMemory } from './track'
import { PING_MEMORY_MS, TICK_MS } from './types'
import type { Contact } from './types'

function contact(id: string, distKm = 0.2): Contact {
  return { id, callsign: id.toUpperCase(), aircraft: 'su27', distKm, bearingDeg: 90, kind: 'bot' }
}

describe('TrackMemory', () => {
  it('un contacto recien pingado esta fresco', () => {
    const memory = new TrackMemory()
    memory.update([contact('a')], 1000)
    const [track] = memory.list(1400)
    expect(track.stale).toBe(false)
    expect(track.ageMs).toBe(400)
  })

  it('un contacto que deja de llegar pasa a viejo', () => {
    const memory = new TrackMemory()
    memory.update([contact('a')], 0)
    const [track] = memory.list(TICK_MS + 800)
    expect(track.stale).toBe(true)
    expect(track.ageMs).toBe(TICK_MS + 800)
  })

  it('conserva la ultima posicion conocida al perderse', () => {
    const memory = new TrackMemory()
    memory.update([contact('a', 0.42)], 0)
    memory.update([], 2000)
    const [track] = memory.list(2000)
    expect(track.distKm).toBe(0.42)
    expect(track.stale).toBe(true)
  })

  it('olvida el contacto cuando se agota la memoria de pings', () => {
    const memory = new TrackMemory()
    memory.update([contact('a')], 0)
    expect(memory.list(PING_MEMORY_MS - 1)).toHaveLength(1)
    memory.update([], PING_MEMORY_MS + 1)
    expect(memory.list(PING_MEMORY_MS + 1)).toHaveLength(0)
  })

  it('ordena frescos antes que viejos, y cada grupo por distancia', () => {
    const memory = new TrackMemory()
    memory.update([contact('viejo', 0.05)], 0)
    memory.update([contact('lejos', 0.9), contact('cerca', 0.2)], 2000)
    const list = memory.list(2000)
    expect(list.map(t => t.id)).toEqual(['cerca', 'lejos', 'viejo'])
  })

  it('clear vacia la memoria', () => {
    const memory = new TrackMemory()
    memory.update([contact('a')], 0)
    memory.clear()
    expect(memory.list(0)).toHaveLength(0)
  })
})
