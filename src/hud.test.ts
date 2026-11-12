import { describe, expect, it } from 'vitest'
import { arrowFor, clock, compactKm, lockBar, lockPercent, renderHud } from './hud'
import type { HudInput } from './hud'
import type { RadarState } from './types'
import type { TrackedContact } from './track'

function radar(over: Partial<RadarState> = {}): RadarState {
  return {
    t: 0,
    phase: 'flying',
    remainingMs: 300_000,
    contacts: [],
    you: { callsign: 'VIPER-1', aircraft: 'f35', lat: 0, lon: 0 },
    rangeKm: 0.48,
    lock: null,
    lockedBy: null,
    result: null,
    ...over,
  }
}

function track(over: Partial<TrackedContact> = {}): TrackedContact {
  return {
    id: 'bot-1',
    callsign: 'FLANKER-1',
    aircraft: 'su27',
    distKm: 0.3,
    bearingDeg: 90,
    kind: 'bot',
    visual: true,
    ageMs: 0,
    stale: false,
    ...over,
  }
}

function input(over: Partial<HudInput> = {}): HudInput {
  return {
    view: 'radar',
    callsign: 'VIPER-1',
    aircraft: 'f35',
    conn: 'open',
    radar: radar(),
    tracks: [],
    gpsSimulated: false,
    ...over,
  }
}

describe('arrowFor', () => {
  it('mapea el rumbo a ocho flechas', () => {
    expect(arrowFor(0)).toBe('↑')
    expect(arrowFor(90)).toBe('→')
    expect(arrowFor(180)).toBe('↓')
    expect(arrowFor(270)).toBe('←')
    expect(arrowFor(359)).toBe('↑')
  })
})

describe('compactKm', () => {
  it('usa metros por debajo de 1 km', () => {
    expect(compactKm(0.088)).toBe('88m')
    expect(compactKm(0.999)).toBe('999m')
  })

  it('usa kilometros con un decimal por encima', () => {
    expect(compactKm(1.24)).toBe('1.2km')
  })
})

describe('clock', () => {
  it('formatea mm:ss con segundos a dos digitos', () => {
    expect(clock(0)).toBe('0:00')
    expect(clock(65_000)).toBe('1:05')
    expect(clock(300_000)).toBe('5:00')
  })

  it('nunca baja de cero', () => {
    expect(clock(-5000)).toBe('0:00')
  })
})

describe('lockPercent y lockBar', () => {
  it('calcula el progreso', () => {
    expect(lockPercent(9000, 18_000)).toBe(50)
    expect(lockPercent(18_000, 18_000)).toBe(100)
    expect(lockPercent(30_000, 18_000)).toBe(100)
    expect(lockPercent(1000, 0)).toBe(0)
  })

  it('dibuja la barra con extremos', () => {
    expect(lockBar(0, 18_000)).toBe('[--------]')
    expect(lockBar(9000, 18_000)).toBe('[####----]')
    expect(lockBar(18_000, 18_000)).toBe('[########]')
  })
})

describe('renderHud · conexion', () => {
  it('sin conectar pide abrir la app companion', () => {
    const hud = renderHud(input({ conn: 'idle' }))
    expect(hud.alert).toBe('SIN CONECTAR · ABRE LA APP')
    expect(hud.detail).toContain('AERONET · G2')
    expect(hud.footer).toBe('TAP: info · 2x: salir')
  })

  it('al perder el enlace lo dice', () => {
    expect(renderHud(input({ conn: 'closed' })).alert).toBe('ENLACE PERDIDO · PULSA TAP')
  })

  it('muestra el error concreto', () => {
    expect(renderHud(input({ conn: 'error', connDetail: 'sala llena' })).alert).toBe('ERROR · sala llena')
  })
})

describe('renderHud · radar', () => {
  it('cabecera con contactos, reloj en el pie y ficha a la izquierda', () => {
    const hud = renderHud(input())
    expect(hud.alert).toBe('0 CONTACTOS')
    expect(hud.detail).toBe('SIN CONTACTOS\n\nMuevete para barrer.')
    expect(hud.info).toBe('F-35\nR 480 m')
    expect(hud.footer).toBe('5:00 · 2v: blanco · mant: silencio')
  })

  it('singular cuando hay un solo contacto', () => {
    expect(renderHud(input({ tracks: [track()] })).alert).toBe('1 CONTACTO')
  })

  it('avisa de amenaza dentro del umbral y en metros', () => {
    expect(renderHud(input({ tracks: [track({ distKm: 0.09 })] })).alert).toBe('! Su-27 A 90 m')
  })

  it('no avisa fuera del umbral', () => {
    expect(renderHud(input({ tracks: [track({ distKm: 0.3 })] })).alert).toBe('1 CONTACTO')
  })

  it('la lista lleva flecha, distancia compacta y rumbo', () => {
    const hud = renderHud(input({ tracks: [track({ distKm: 0.22, bearingDeg: 90 })] }))
    expect(hud.detail).toContain('→ Su-27 220m 090°')
  })

  it('un contacto viejo se marca aparte', () => {
    const hud = renderHud(input({ tracks: [track({ stale: true, ageMs: 8000, distKm: 0.3 })] }))
    expect(hud.detail).toContain('? Su-27 300m 8s')
    expect(hud.alert).toBe('0 CONTACTOS')
  })
})

describe('renderHud · bloqueo', () => {
  it('blanco en el aviso, barra en la columna', () => {
    const hud = renderHud(
      input({ radar: radar({ lock: { callsign: 'FLANKER-1', aircraft: 'su27', ms: 9000, needMs: 18000 } }) }),
    )
    expect(hud.alert).toBe('BLOQUEANDO · FLANKER-1')
    expect(hud.detail).toContain('[####----] 9.0/18s')
  })

  it('marca con * el contacto fijado', () => {
    const hud = renderHud(
      input({
        tracks: [track({ callsign: 'FLANKER-1', distKm: 0.22, bearingDeg: 90 })],
        radar: radar({ lock: { callsign: 'FLANKER-1', aircraft: 'su27', ms: 2000, needMs: 18000 } }),
      }),
    )
    expect(hud.detail).toContain('* Su-27 220m 090°')
  })

  it('avisa si te estan bloqueando, por encima de la amenaza', () => {
    const hud = renderHud(
      input({
        tracks: [track({ distKm: 0.05 })],
        radar: radar({ lockedBy: 'GHOST-1' }),
      }),
    )
    expect(hud.alert).toBe('!! TE BLOQUEAN · GHOST-1')
  })
})

describe('renderHud · resultado', () => {
  it('victoria propia', () => {
    const hud = renderHud(
      input({
        radar: radar({
          phase: 'finished',
          remainingMs: 4000,
          result: { winner: 'VIPER-1', reason: 'bloqueo sobre FLANKER-1' },
        }),
      }),
    )
    expect(hud.alert).toBe('VICTORIA')
    expect(hud.detail).toContain('BLANCO DERRIBADO')
    expect(hud.footer).toBe('Nueva partida en 4 s')
  })

  it('victoria ajena', () => {
    const hud = renderHud(
      input({ radar: radar({ phase: 'finished', result: { winner: 'GHOST-1', reason: 'tiempo agotado' } }) }),
    )
    expect(hud.alert).toBe('GANA GHOST-1')
    expect(hud.detail).toContain('GANADOR: GHOST-1')
  })

  it('empate', () => {
    const hud = renderHud(
      input({ radar: radar({ phase: 'finished', result: { winner: null, reason: 'tiempo agotado' } }) }),
    )
    expect(hud.alert).toBe('EMPATE')
    expect(hud.detail).toContain('NADIE GANA')
  })
})

describe('renderHud · ficha del avion', () => {
  it('resume radio, firma y tiempo de bloqueo en lineas cortas', () => {
    const hud = renderHud(input({ view: 'info' }))
    expect(hud.alert).toBe('F-35 · Sigilo')
    expect(hud.detail).toContain('Fija en 18 s')
    expect(hud.detail).toContain('RCS 0.001 m²')
    expect(hud.info).toBe('F-35\nR 480 m')
    expect(hud.footer).toBe('5:00 · 2v: alcance · TAP: radar')
  })

  it('avisa del GPS simulado', () => {
    expect(renderHud(input({ view: 'info', gpsSimulated: true })).detail).toContain('GPS simulado')
  })
})

describe('renderHud · amenaza y rango', () => {
  it('por debajo del umbral sigue siendo "te bloquean"', () => {
    const hud = renderHud(
      input({ radar: radar({ lockedBy: 'GHOST-1', threat: { callsign: 'GHOST-1', percent: 69 } }) }),
    )
    expect(hud.alert).toBe('!! TE BLOQUEAN · GHOST-1')
  })

  it('a partir del 70 % el aviso pasa a MISSILE', () => {
    const hud = renderHud(
      input({ radar: radar({ lockedBy: 'GHOST-1', threat: { callsign: 'GHOST-1', percent: 70 } }) }),
    )
    expect(hud.alert).toBe('!! MISSILE · GHOST-1')
  })

  it('el misil manda sobre la amenaza cercana', () => {
    const hud = renderHud(
      input({
        tracks: [track({ distKm: 0.05 })],
        radar: radar({ lockedBy: 'GHOST-1', threat: { callsign: 'GHOST-1', percent: 95 } }),
      }),
    )
    expect(hud.alert).toBe('!! MISSILE · GHOST-1')
  })

  it('el rango acompaña a la victoria', () => {
    const hud = renderHud(
      input({
        radar: radar({
          phase: 'finished',
          result: { winner: 'VIPER-1', reason: 'bloqueo sobre FLANKER-1', rank: 'S', score: 100 },
        }),
      }),
    )
    expect(hud.alert).toBe('VICTORIA · S')
    expect(hud.detail).toContain('RANGO S · 100%')
    expect(hud.detail).toContain('BLANCO DERRIBADO')
  })

  it('un empate tambien lleva nota', () => {
    const hud = renderHud(
      input({
        radar: radar({
          phase: 'finished',
          result: { winner: null, reason: 'tiempo agotado', rank: 'D', score: 0 },
        }),
      }),
    )
    expect(hud.alert).toBe('EMPATE · D')
    expect(hud.detail).toContain('RANGO D · 0%')
  })

  it('sin rango (servidor viejo) el aviso queda como estaba', () => {
    const hud = renderHud(
      input({
        radar: radar({
          phase: 'finished',
          result: { winner: 'VIPER-1', reason: 'bloqueo sobre FLANKER-1' },
        }),
      }),
    )
    expect(hud.alert).toBe('VICTORIA')
    expect(hud.detail).not.toContain('RANGO')
  })
})
