import { describe, expect, it } from 'vitest'
import { bearingDeg, detectRangeKm, distanceKm, formatKm, offsetLatLon } from './geo'
import { BASE_KM, VISUAL_RANGE_KM } from './types'

const MADRID = { lat: 40.4155, lon: -3.6844 }

describe('distanceKm', () => {
  it('devuelve 0 en el mismo punto', () => {
    expect(distanceKm(MADRID, MADRID)).toBe(0)
  })

  it('mide ~1 km con 0.009 grados de latitud', () => {
    expect(distanceKm(MADRID, { lat: MADRID.lat + 0.009, lon: MADRID.lon })).toBeCloseTo(1, 1)
  })

  it('es simetrica', () => {
    const other = { lat: 40.42, lon: -3.69 }
    expect(distanceKm(MADRID, other)).toBeCloseTo(distanceKm(other, MADRID), 9)
  })
})

describe('bearingDeg', () => {
  const north = { lat: MADRID.lat + 0.01, lon: MADRID.lon }
  const east = { lat: MADRID.lat, lon: MADRID.lon + 0.01 }
  const south = { lat: MADRID.lat - 0.01, lon: MADRID.lon }
  const west = { lat: MADRID.lat, lon: MADRID.lon - 0.01 }

  it('apunta al norte, este, sur y oeste', () => {
    expect(bearingDeg(MADRID, north) % 360).toBeCloseTo(0, 0)
    expect(bearingDeg(MADRID, east)).toBeCloseTo(90, 0)
    expect(bearingDeg(MADRID, south)).toBeCloseTo(180, 0)
    expect(bearingDeg(MADRID, west)).toBeCloseTo(270, 0)
  })

  it('siempre cae en 0..360', () => {
    for (const target of [north, east, south, west]) {
      const b = bearingDeg(MADRID, target)
      expect(b).toBeGreaterThanOrEqual(0)
      expect(b).toBeLessThan(360)
    }
  })
})

describe('offsetLatLon', () => {
  it('ida y vuelta: distancia y rumbo se conservan', () => {
    const dest = offsetLatLon(MADRID.lat, MADRID.lon, 0.25, 45)
    expect(distanceKm(MADRID, dest)).toBeCloseTo(0.25, 3)
    expect(bearingDeg(MADRID, dest)).toBeCloseTo(45, 0)
  })

  it('permite dibujar los bots a radios concretos', () => {
    const dest = offsetLatLon(MADRID.lat, MADRID.lon, 0.48, 90)
    expect(distanceKm(MADRID, dest)).toBeCloseTo(0.48, 3)
  })
})

describe('detectRangeKm', () => {
  const f35 = 1
  const su27Radar = 0.55
  const su27Rcs = 12
  const f35Rcs = 0.001

  it('un F-35 ve a un Su-27 a 480 m', () => {
    const km = detectRangeKm(f35, su27Rcs, BASE_KM, VISUAL_RANGE_KM)
    expect(km).toBeCloseTo(0.48, 2)
  })

  it('un Su-27 ve a otro Su-27 a 264 m', () => {
    const km = detectRangeKm(su27Radar, su27Rcs, BASE_KM, VISUAL_RANGE_KM)
    expect(km).toBeCloseTo(0.264, 2)
  })

  it('el suelo visual de 90 m salva al sigiloso de ser invisible de cerca', () => {
    const bruto = detectRangeKm(su27Radar, f35Rcs, BASE_KM, 0)
    expect(bruto).toBeLessThan(0.09)
    expect(detectRangeKm(su27Radar, f35Rcs, BASE_KM, VISUAL_RANGE_KM)).toBe(0.09)
  })

  it('el RCS entra por la cuarta raiz (ecuacion radar)', () => {
    const dobleRcs = detectRangeKm(f35, 2, BASE_KM, 0)
    const baseRcs = detectRangeKm(f35, 1, BASE_KM, 0)
    expect(dobleRcs / baseRcs).toBeCloseTo(Math.pow(2, 0.25), 6)
  })
})

describe('formatKm', () => {
  it('usa metros por debajo de 1 km', () => {
    expect(formatKm(0.088)).toBe('88 m')
    expect(formatKm(0.999)).toBe('999 m')
  })

  it('usa kilometros con un decimal por encima', () => {
    expect(formatKm(1)).toBe('1.0 km')
    expect(formatKm(1.24)).toBe('1.2 km')
  })
})
