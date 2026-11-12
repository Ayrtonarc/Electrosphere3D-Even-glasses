import { describe, expect, it } from 'vitest'
import {
  DEFAULT_CALIBRATION,
  attitudeChanged,
  attitudeFromImu,
  blendAngles,
  smoothAttitude,
  wrapDeg,
} from './imu'

const G = 1

describe('attitudeFromImu', () => {
  it('con la cabeza recta da cero', () => {
    expect(attitudeFromImu({ x: 0, y: 0, z: G })).toEqual({ rollDeg: 0, pitchDeg: 0 })
  })

  it('inclinado 90 grados a la derecha da alabeo +90', () => {
    const att = attitudeFromImu({ x: G, y: 0, z: 0 })!
    expect(att.rollDeg).toBeCloseTo(90, 6)
    expect(att.pitchDeg).toBeCloseTo(0, 6)
  })

  it('inclinado 90 grados a la izquierda da alabeo -90', () => {
    expect(attitudeFromImu({ x: -G, y: 0, z: 0 })!.rollDeg).toBeCloseTo(-90, 6)
  })

  it('mirando 30 grados hacia arriba da cabeceo +30', () => {
    const rad = (30 * Math.PI) / 180
    const att = attitudeFromImu({ x: 0, y: -Math.sin(rad), z: Math.cos(rad) })!
    expect(att.pitchDeg).toBeCloseTo(30, 6)
    expect(att.rollDeg).toBeCloseTo(0, 6)
  })

  it('mirando 30 grados hacia abajo da cabeceo -30', () => {
    const rad = (30 * Math.PI) / 180
    expect(
      attitudeFromImu({ x: 0, y: Math.sin(rad), z: Math.cos(rad) })!.pitchDeg,
    ).toBeCloseTo(-30, 6)
  })

  it('aplica los desfases de calibracion', () => {
    const att = attitudeFromImu(
      { x: 0, y: 0, z: G },
      { ...DEFAULT_CALIBRATION, rollOffsetDeg: 5, pitchOffsetDeg: -3 },
    )!
    expect(att.rollDeg).toBeCloseTo(5, 6)
    expect(att.pitchDeg).toBeCloseTo(-3, 6)
  })

  it('invierte los ejes con sign -1', () => {
    const att = attitudeFromImu({ x: G, y: 0, z: 0 }, { ...DEFAULT_CALIBRATION, sign: -1 })!
    expect(att.rollDeg).toBeCloseTo(-90, 6)
  })

  it('descarta muestras sin gravedad', () => {
    expect(attitudeFromImu({ x: 0, y: 0, z: 0 })).toBeNull()
    expect(attitudeFromImu({ x: 0.01, y: 0, z: 0.01 })).toBeNull()
    expect(attitudeFromImu({ x: Number.NaN, y: 0, z: G })).toBeNull()
  })
})

describe('wrapDeg', () => {
  it('normaliza al rango (-180, 180]', () => {
    expect(wrapDeg(0)).toBe(0)
    expect(wrapDeg(190)).toBe(-170)
    expect(wrapDeg(-190)).toBe(170)
    expect(wrapDeg(360)).toBe(0)
    expect(wrapDeg(-180)).toBe(180)
  })
})

describe('blendAngles', () => {
  it('cruza el limite de 180 por el lado corto', () => {
    // 170 y -170 estan a 20 grados: la media debe caer cerca de +-180.
    const mid = blendAngles(170, -170, 0.5)
    expect(Math.abs(mid)).toBeGreaterThan(175)
  })

  it('con peso 0 conserva el angulo de partida', () => {
    expect(blendAngles(42, 200, 0)).toBeCloseTo(42, 6)
  })
})

describe('smoothAttitude', () => {
  it('sin lectura previa devuelve la nueva tal cual', () => {
    expect(smoothAttitude(null, { rollDeg: 12, pitchDeg: -4 })).toEqual({
      rollDeg: 12,
      pitchDeg: -4,
    })
  })

  it('se acerca a la lectura nueva sin llegar de golpe', () => {
    const att = smoothAttitude({ rollDeg: 0, pitchDeg: 0 }, { rollDeg: 20, pitchDeg: 20 }, 0.5)
    expect(att.rollDeg).toBeCloseTo(10, 6)
    expect(att.pitchDeg).toBeCloseTo(10, 6)
  })
})

describe('attitudeChanged', () => {
  it('siempre repinta la primera lectura', () => {
    expect(attitudeChanged(null, { rollDeg: 0, pitchDeg: 0 })).toBe(true)
  })

  it('ignora el ruido por debajo del umbral', () => {
    expect(attitudeChanged({ rollDeg: 0, pitchDeg: 0 }, { rollDeg: 1, pitchDeg: 1 }, 2)).toBe(false)
  })

  it('detecta cambios por encima del umbral', () => {
    expect(attitudeChanged({ rollDeg: 0, pitchDeg: 0 }, { rollDeg: 3, pitchDeg: 0 }, 2)).toBe(true)
    expect(attitudeChanged({ rollDeg: 0, pitchDeg: 0 }, { rollDeg: 0, pitchDeg: 3 }, 2)).toBe(true)
  })

  it('mide el alabeo por el lado corto del circulo', () => {
    expect(attitudeChanged({ rollDeg: 179, pitchDeg: 0 }, { rollDeg: -179, pitchDeg: 0 }, 2)).toBe(
      false,
    )
  })
})
