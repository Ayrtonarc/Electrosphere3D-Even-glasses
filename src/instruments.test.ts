import { describe, expect, it } from 'vitest'
import {
  RANGE_SCALES,
  altitudeDelta,
  closureLabel,
  cycleRange,
  gpsQuality,
  rangeScaleLabel,
} from './instruments'

describe('closureLabel', () => {
  it('no inventa nada sin dos pings', () => {
    expect(closureLabel(undefined)).toBe('')
    expect(closureLabel(Number.NaN)).toBe('')
  })

  it('marca el empate cuando apenas cambia', () => {
    expect(closureLabel(0)).toBe('=')
    expect(closureLabel(0.1)).toBe('=')
    expect(closureLabel(-0.1)).toBe('=')
  })

  it('se acerca cuando la distancia baja', () => {
    expect(closureLabel(1.23)).toBe('▼1.2')
  })

  it('se aleja cuando la distancia sube', () => {
    expect(closureLabel(-0.9)).toBe('▲0.9')
  })
})

describe('gpsQuality', () => {
  it('da 4 barras con buena precision', () => {
    expect(gpsQuality(5)).toEqual({ bars: 4, jam: false })
  })

  it('baja las barras al empeorar', () => {
    expect(gpsQuality(15).bars).toBe(3)
    expect(gpsQuality(25).bars).toBe(2)
    expect(gpsQuality(45).bars).toBe(1)
  })

  it('declara jam sin GPS o con error grande', () => {
    expect(gpsQuality(90)).toEqual({ bars: 0, jam: true })
    expect(gpsQuality(null)).toEqual({ bars: 0, jam: true })
    expect(gpsQuality(5, true)).toEqual({ bars: 0, jam: true })
  })
})

describe('cycleRange', () => {
  it('recorre las escalas y se para en los extremos', () => {
    expect(cycleRange(1, 1)).toBe(RANGE_SCALES[1])
    expect(cycleRange(RANGE_SCALES[1], 1)).toBe(RANGE_SCALES[2])
    expect(cycleRange(RANGE_SCALES[2], 1)).toBe(RANGE_SCALES[2])
    expect(cycleRange(1, -1)).toBe(1)
    expect(cycleRange(RANGE_SCALES[2], -1)).toBe(RANGE_SCALES[1])
  })

  it('parte de la escala mas ancha si el valor no es conocido', () => {
    expect(cycleRange(0.9, 1)).toBe(RANGE_SCALES[1])
  })
})

describe('rangeScaleLabel', () => {
  it('etiqueta cada escala', () => {
    expect(rangeScaleLabel(1)).toBe('WDE')
    expect(rangeScaleLabel(0.65)).toBe('MID')
    expect(rangeScaleLabel(0.35)).toBe('NRW')
  })
})

describe('altitudeDelta', () => {
  it('da la diferencia relativa', () => {
    expect(altitudeDelta(700, 650)).toBe('A+50m')
    expect(altitudeDelta(620, 650)).toBe('A-30m')
    expect(altitudeDelta(650, 650)).toBe('A0m')
  })

  it('no inventa si falta algun dato', () => {
    expect(altitudeDelta(undefined, 650)).toBe('')
    expect(altitudeDelta(700, null)).toBe('')
    expect(altitudeDelta(700, undefined)).toBe('')
  })
})
