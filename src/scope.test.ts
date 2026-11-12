import { describe, expect, it } from 'vitest'
import { plotXY } from './scope'

describe('plotXY', () => {
  it('coloca el norte arriba', () => {
    const { x, y } = plotXY(0.5, 0, 1, 100)
    expect(x).toBeCloseTo(0, 6)
    expect(y).toBeCloseTo(-50, 6)
  })

  it('coloca el este a la derecha', () => {
    const { x, y } = plotXY(0.5, 90, 1, 100)
    expect(x).toBeCloseTo(50, 6)
    expect(y).toBeCloseTo(0, 6)
  })

  it('coloca el sur abajo', () => {
    const { x, y } = plotXY(0.5, 180, 1, 100)
    expect(x).toBeCloseTo(0, 6)
    expect(y).toBeCloseTo(50, 6)
  })

  it('coloca el oeste a la izquierda', () => {
    const { x, y } = plotXY(0.5, 270, 1, 100)
    expect(x).toBeCloseTo(-50, 6)
    expect(y).toBeCloseTo(0, 6)
  })

  it('recorta los contactos fuera de alcance al borde', () => {
    const { x, y } = plotXY(5, 90, 1, 100)
    expect(x).toBeCloseTo(100, 6)
    expect(y).toBeCloseTo(0, 6)
  })

  it('no divide por cero si no hay alcance', () => {
    expect(plotXY(1, 90, 0, 100)).toEqual({ x: 0, y: 0 })
  })

  it('trata distancias negativas como cero', () => {
    expect(plotXY(-1, 90, 1, 100)).toEqual({ x: 0, y: 0 })
  })
})
