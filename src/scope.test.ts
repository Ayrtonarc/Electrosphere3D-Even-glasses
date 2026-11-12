import { describe, expect, it } from 'vitest'
import { PLANFORM_IDS, placeLabel, planformFor, plotXY, shortLabel, type LabelArea, type Point } from './scope'

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

describe('siluetas del radar', () => {
  // Las coordenadas se escriben a mano: la simetria es el invariante que
  // delata un vertice mal puesto antes de verlo en las gafas.
  const key = ([x, y]: Point) => `${x === 0 ? 0 : x},${y === 0 ? 0 : y}`

  it.each(PLANFORM_IDS)('%s es simetrica respecto al eje del morro', id => {
    const points = planformFor(id)
    const mirror = new Set(points.map(([x, y]) => key([x === 0 ? 0 : -x, y])))
    for (const point of points) expect(mirror.has(key(point))).toBe(true)
  })

  it.each(PLANFORM_IDS)('%s apunta al norte y cabe en el radar', id => {
    const points = planformFor(id)
    const nose = points.reduce((a, b) => (b[1] < a[1] ? b : a))
    expect(nose[0]).toBe(0)
    for (const [x, y] of points) {
      expect(Math.abs(x)).toBeLessThanOrEqual(9)
      expect(Math.abs(y)).toBeLessThanOrEqual(10)
    }
  })

  it('da una silueta distinta a cada caza', () => {
    expect(planformFor('f35')).not.toEqual(planformFor('su27'))
  })

  it('el Flanker es mucho mas largo que el F-35', () => {
    const length = (id: string) => {
      const ys = planformFor(id).map(([, y]) => y)
      return Math.max(...ys) - Math.min(...ys)
    }
    expect(length('su27')).toBeGreaterThan(length('f35') * 1.4)
  })

  it('usa una silueta neutra para un tipo sin registrar', () => {
    expect(planformFor('mig31')).toEqual(planformFor('unknown'))
    expect(planformFor('mig31')).not.toEqual(planformFor('f35'))
  })
})

describe('shortLabel', () => {
  it('deja intactos los indicativos cortos', () => {
    expect(shortLabel('VIPER')).toBe('VIPER')
    expect(shortLabel('ace')).toBe('ACE')
  })

  it('recorta los largos a cinco caracteres', () => {
    expect(shortLabel('FLANKER-1')).toBe('FLANK')
    expect(shortLabel('GHOST-1')).toBe('GHOST')
  })

  it('no deja separadores colgando del recorte', () => {
    expect(shortLabel('AB-CD-EFG')).toBe('AB-CD')
    expect(shortLabel('A_B_C_DEF')).toBe('A_B_C')
  })

  it('tolera vacios y espacios', () => {
    expect(shortLabel('   ')).toBe('')
    expect(shortLabel('  VIPER-37  ')).toBe('VIPER')
  })
})

describe('placeLabel', () => {
  const area: LabelArea = { width: 576, height: 288, gap: 16, padX: 8, padY: 8 }

  it('pone la etiqueta a la izquierda de un contacto de la mitad izquierda', () => {
    expect(placeLabel(200, 150, 40, area)).toEqual({ x: 184, y: 150, align: 'right' })
  })

  it('la pone a la derecha si el contacto esta en la mitad derecha', () => {
    expect(placeLabel(400, 150, 40, area)).toEqual({ x: 416, y: 150, align: 'left' })
  })

  it('no deja que el texto se salga por la derecha', () => {
    expect(placeLabel(570, 150, 60, area).x).toBe(576 - 8 - 60)
  })

  it('no deja que el texto se salga por la izquierda', () => {
    expect(placeLabel(4, 150, 60, area).x).toBe(8 + 60)
  })

  it('pega la etiqueta a los bordes superior e inferior', () => {
    expect(placeLabel(300, 2, 40, area).y).toBe(8)
    expect(placeLabel(300, 286, 40, area).y).toBe(288 - 8)
  })
})
