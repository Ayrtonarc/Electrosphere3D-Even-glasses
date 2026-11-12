import { describe, expect, it } from 'vitest'
import { aircraftSpecial, aircraftStats, aircraftTitle } from './stats'
import { AIRCRAFT } from './types'
import { detectRangeKm } from './geo'

describe('aircraftStats', () => {
  it('da las cuatro cifras que importan', () => {
    const stats = aircraftStats('f35')
    expect(stats.map(s => s.id)).toEqual(['rcs', 'radar', 'lock', 'seen'])
    expect(stats.map(s => s.label)).toEqual(['RCS', 'Radar', 'Fija en', 'Te ven a'])
  })

  it('el F-35 ve lejos y tarda en fijar', () => {
    const [rcs, radar, lock] = aircraftStats('f35')
    expect(rcs.value).toBe('0.001 m²')
    expect(radar.value).toBe('480 m')
    expect(lock.value).toBe('18 s')
  })

  it('el Su-27 ve cerca pero fija rapido', () => {
    const [rcs, radar, lock] = aircraftStats('su27')
    expect(rcs.value).toBe('12 m²')
    expect(radar.value).toBe('264 m')
    expect(lock.value).toBe('10 s')
  })

  it('el sigiloso se hace ver a menos distancia', () => {
    const [, , , seenF35] = aircraftStats('f35')
    const [, , , seenSu27] = aircraftStats('su27')
    expect(seenF35.value).toBe('90 m')
    expect(seenSu27.value).toBe('480 m')
  })

  it('los numeros cuadran con la formula del servidor', () => {
    // Si alguien toca `detectRangeKm`, la ficha miente: esto lo delata.
    const [, radar] = aircraftStats('su27')
    expect(radar.value).toBe(`${Math.round(detectRangeKm(0.55, 12, 0.258, 0.09) * 1000)} m`)
  })

  it('el catalogo entero tiene ficha', () => {
    for (const id of Object.keys(AIRCRAFT)) {
      expect(aircraftStats(id as keyof typeof AIRCRAFT)).toHaveLength(4)
      expect(aircraftTitle(id as keyof typeof AIRCRAFT)).toContain(AIRCRAFT[id as keyof typeof AIRCRAFT].name)
    }
  })
})

describe('aircraftSpecial', () => {
  it('los cuatro aviones traen arma y explicacion', () => {
    const ids = Object.keys(AIRCRAFT) as (keyof typeof AIRCRAFT)[]
    expect(ids).toHaveLength(4)

    for (const id of ids) {
      const special = aircraftSpecial(id)
      expect(special?.name).toBeTruthy()
      expect(special?.blurb).toBeTruthy()
    }
  })

  it('cada arma es distinta', () => {
    const names = (Object.keys(AIRCRAFT) as (keyof typeof AIRCRAFT)[]).map(id => aircraftSpecial(id)?.name)
    expect(new Set(names).size).toBe(names.length)
  })

  it('el F-16 y el MiG-29 completan la tabla', () => {
    expect(aircraftStats('f16').map(s => s.value)).toEqual(['5 m²', '336 m', '13 s', '386 m'])
    expect(aircraftStats('mig29').map(s => s.value)).toEqual(['7 m²', '384 m', '15 s', '420 m'])
  })
})
