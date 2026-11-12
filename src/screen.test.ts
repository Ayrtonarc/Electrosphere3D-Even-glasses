import { afterEach, describe, expect, it, vi } from 'vitest'
import { drawScreen, type ScreenInput } from './screen'
import type { ScopeBlip } from './scope'
import type { RadarState } from './types'
import {
  SCREEN_H,
  SCREEN_W,
  TILE_COLS,
  TILE_COUNT,
  TILE_H,
  TILE_W,
  hashPixels,
  hashRegion,
  quantizeToPanel,
  tileOrigin,
} from './screen'

describe('teselado de la pantalla', () => {
  it('los cuatro tiles cubren exactamente la pantalla fisica', () => {
    expect(TILE_COUNT).toBe(TILE_COLS * TILE_COLS)
    expect(TILE_COUNT * TILE_W * TILE_H).toBe(SCREEN_W * SCREEN_H)
  })

  it('cada tile respeta el maximo de 288x144 que acepta el firmware', () => {
    expect(TILE_W).toBeLessThanOrEqual(288)
    expect(TILE_H).toBeLessThanOrEqual(144)
  })

  it('reparte los origenes en cuadricula sin solaparse', () => {
    const origins = Array.from({ length: TILE_COUNT }, (_, i) => tileOrigin(i))
    expect(origins).toEqual([
      { index: 0, x: 0, y: 0 },
      { index: 1, x: 288, y: 0 },
      { index: 2, x: 0, y: 144 },
      { index: 3, x: 288, y: 144 },
    ])
    for (const { x, y } of origins) {
      expect(x + TILE_W).toBeLessThanOrEqual(SCREEN_W)
      expect(y + TILE_H).toBeLessThanOrEqual(SCREEN_H)
    }
  })
})

describe('hashPixels', () => {
  it('es estable para el mismo contenido', () => {
    expect(hashPixels(new Uint8Array([1, 2, 3]))).toBe(hashPixels(new Uint8Array([1, 2, 3])))
  })

  it('cambia cuando cambia un solo pixel', () => {
    expect(hashPixels(new Uint8Array([1, 2, 3]))).not.toBe(hashPixels(new Uint8Array([1, 2, 4])))
  })

  it('devuelve un entero sin signo', () => {
    const h = hashPixels(new Uint8Array([0, 255, 0, 255]))
    expect(Number.isInteger(h)).toBe(true)
    expect(h).toBeGreaterThanOrEqual(0)
  })
})

describe('cuantizacion al panel', () => {
  it('deja el negro y el blanco intactos', () => {
    const data = new Uint8ClampedArray([0, 0, 0, 255, 255, 255, 255, 255])
    quantizeToPanel(data)
    expect(Array.from(data.slice(0, 4))).toEqual([0, 0, 0, 255])
    expect(Array.from(data.slice(4))).toEqual([255, 255, 255, 255])
  })

  it('solo produce 16 niveles de gris y siempre opaco', () => {
    const data = new Uint8ClampedArray(256 * 4)
    for (let i = 0; i < 256; i++) {
      data[i * 4] = data[i * 4 + 1] = data[i * 4 + 2] = i
      data[i * 4 + 3] = 10
    }
    quantizeToPanel(data)
    const levels = new Set<number>()
    for (let i = 0; i < 256; i++) {
      expect(data[i * 4 + 3]).toBe(255)
      expect(data[i * 4 + 1]).toBe(data[i * 4])
      expect(data[i * 4 + 2]).toBe(data[i * 4])
      levels.add(data[i * 4])
    }
    expect(levels.size).toBe(16)
  })
})

describe('hashRegion', () => {
  const frame = new Uint8ClampedArray(8 * 4 * 4)
  for (let i = 0; i < frame.length; i += 4) frame[i] = i % 251

  it('coincide con hashear el recorte extraido', () => {
    const sx = 2
    const sy = 1
    const w = 3
    const h = 2
    const copy = new Uint8Array(w * h)
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) copy[y * w + x] = frame[((sy + y) * 8 + sx + x) * 4]
    }
    expect(hashRegion(frame, 8, sx, sy, w, h)).toBe(hashPixels(copy))
  })

  it('distingue regiones distintas del mismo buffer', () => {
    expect(hashRegion(frame, 8, 0, 0, 3, 2)).not.toBe(hashRegion(frame, 8, 2, 1, 3, 2))
  })
})

/** Canvas falso: registra que se pinta sin necesitar DOM. */
function fakeCtx() {
  const drawn: string[] = []
  const ctx = {
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    font: '',
    textAlign: 'left',
    textBaseline: 'top',
    save() {},
    restore() {},
    beginPath() {},
    moveTo() {},
    lineTo() {},
    arc() {},
    closePath() {},
    rect() {},
    clip() {},
    translate() {},
    rotate() {},
    fill() {},
    stroke() {},
    fillRect() {},
    strokeRect() {},
    fillText(value: string) {
      drawn.push(value)
    },
    measureText: (value: string) => ({ width: value.length * 7 }),
  } as unknown as CanvasRenderingContext2D
  return { ctx, drawn }
}

const radar: RadarState = {
  t: 0,
  phase: 'flying',
  remainingMs: 120_000,
  contacts: [],
  you: { callsign: 'VIPER', aircraft: 'su27', lat: 0, lon: 0 },
  rangeKm: 0.264,
  lock: { callsign: 'FLANKER-1', aircraft: 'su27', ms: 4000, needMs: 10_000 },
  lockedBy: null,
  result: null,
}

function blip(overrides: Partial<ScopeBlip> = {}): ScopeBlip {
  return {
    distKm: 0.2,
    bearingDeg: 45,
    stale: false,
    locked: false,
    aircraft: 'su27',
    callsign: 'FLANKER-1',
    ...overrides,
  }
}

function input(overrides: Partial<ScreenInput> = {}): ScreenInput {
  return {
    hud: {
      alert: 'BLOQUEANDO · FLANKER-1',
      detail: 'FLANKER-1\n220m',
      info: 'Su-27\nR 264 m',
      footer: '4:52 · TAP: ficha',
    },
    radar,
    view: 'radar',
    conn: 'open',
    blips: [
      blip({ locked: true, altM: 662, closureMps: 1.2 }),
      blip({ callsign: 'GHOST-1', aircraft: 'f35', distKm: 0.09, bearingDeg: 200, stale: true }),
      blip({ callsign: 'LEJOS', distKm: 0.9, bearingDeg: 300, closureMps: -0.9 }),
    ],
    speedKph: 5.4,
    headingDeg: 41,
    altM: 650,
    attitude: { rollDeg: 12, pitchDeg: -8 },
    gpsAccuracyM: 8,
    gpsSimulated: false,
    rangeScale: 1,
    silent: false,
    ...overrides,
  }
}

describe('drawScreen', () => {
  it('pinta el radar en vuelo sin lanzar', () => {
    const { ctx } = fakeCtx()
    expect(() => drawScreen(ctx, input())).not.toThrow()
  })

  it('pinta con la escala mas cerrada y contactos fuera', () => {
    const { ctx, drawn } = fakeCtx()
    drawScreen(ctx, input({ rangeScale: 0.35 }))
    // La escala se anota y el contacto lejano acaba en flecha con su distancia.
    expect(drawn).toContain('NRW')
    expect(drawn).toContain('900')
  })

  it('pinta el indicativo del blanco y su altitud relativa', () => {
    const { ctx, drawn } = fakeCtx()
    drawScreen(ctx, input())
    expect(drawn).toContain('FLANK')
    expect(drawn).toContain('A+12m')
  })

  it('pinta la tasa de cierre del contacto', () => {
    const { ctx, drawn } = fakeCtx()
    drawScreen(ctx, input({ rangeScale: 1 }))
    expect(drawn.some(value => value.includes('▼1.2'))).toBe(true)
  })

  it('pinta GPS JAM cuando la posicion es simulada', () => {
    // El aviso parpadea: se fija el reloj en una fase visible.
    vi.useFakeTimers()
    vi.setSystemTime(1_800_000)
    const { ctx, drawn } = fakeCtx()
    drawScreen(ctx, input({ gpsSimulated: true, gpsAccuracyM: null }))
    expect(drawn).toContain('GPS JAM')
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('no revienta sin IMU, sin GPS y sin radar', () => {
    const { ctx } = fakeCtx()
    expect(() =>
      drawScreen(
        ctx,
        input({ radar: null, conn: 'idle', attitude: null, gpsAccuracyM: null, speedKph: null, altM: null }),
      ),
    ).not.toThrow()
  })

  it('pinta el resultado al terminar la partida sin lanzar', () => {
    const { ctx } = fakeCtx()
    const finished: RadarState = {
      ...radar,
      phase: 'finished',
      result: { winner: 'VIPER', reason: 'bloqueo sobre FLANKER-1' },
      lock: null,
    }
    expect(() => drawScreen(ctx, input({ radar: finished, view: 'info' }))).not.toThrow()
  })
})

describe('drawScreen · silencio', () => {
  it('rotula SILENCIO cuando el radar esta apagado', () => {
    const { ctx, drawn } = fakeCtx()
    drawScreen(ctx, input({ silent: true }))
    expect(drawn).toContain('SILENCIO')
  })

  it('no lo rotula con el radar encendido', () => {
    const { ctx, drawn } = fakeCtx()
    drawScreen(ctx, input({ silent: false }))
    expect(drawn).not.toContain('SILENCIO')
  })

  it('marca con ~ al contacto que lleva el radar apagado', () => {
    const { ctx, drawn } = fakeCtx()
    drawScreen(
      ctx,
      input({
        blips: [blip({ callsign: 'GHOST-1', aircraft: 'f35', locked: false, emitting: false })],
      }),
    )
    expect(drawn).toContain('GHOST~')
  })
})
