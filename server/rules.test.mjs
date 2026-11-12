import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { botsAt, createRules, distanceKm } from './rules.mjs'

const cfg = JSON.parse(readFileSync(new URL('../src/shared/aircraft.json', import.meta.url), 'utf8'))
const MADRID = { lat: 40.4155, lon: -3.6844 }

function makeGame(overrides = {}, start = 1_000_000) {
  const conf = { ...cfg, ...overrides }
  let t = start
  const rules = createRules(conf)
  const game = rules.createGame({ now: () => t })
  return {
    conf,
    rules,
    game,
    advance: ms => {
      t += ms
    },
    tick: () => game.tick(),
    now: () => t,
  }
}

/** Juego con un jugador ya posicionado y el primer tick hecho. */
function soloGame(aircraft = 'f35', overrides = {}) {
  const ctx = makeGame(overrides)
  ctx.game.join('a', { callsign: 'A', aircraft })
  ctx.game.setPosition('a', MADRID.lat, MADRID.lon)
  return ctx
}

describe('reglas · deteccion', () => {
  it('el alcance sale de radar y RCS, ya escalado a pie', () => {
    const { rules } = makeGame()
    expect(rules.detectKm({ aircraft: 'f35' }, { aircraft: 'su27' })).toBeCloseTo(0.48, 2)
    expect(rules.detectKm({ aircraft: 'su27' }, { aircraft: 'su27' })).toBeCloseTo(0.264, 2)
  })

  it('el suelo visual deja ver al sigiloso a 90 m', () => {
    const { rules } = makeGame()
    expect(rules.detectKm({ aircraft: 'su27' }, { aircraft: 'f35' })).toBeCloseTo(0.09, 5)
    expect(rules.detectKm({ aircraft: 'f35' }, { aircraft: 'f35' })).toBeCloseTo(0.09, 5)
  })
})

describe('reglas · bots', () => {
  it('se colocan a radios de barrio', () => {
    const bots = botsAt(MADRID, 0)
    const byName = name => bots.find(b => b.callsign === name)
    expect(distanceKm(MADRID, byName('FLANKER-1'))).toBeCloseTo(0.22, 3)
    expect(distanceKm(MADRID, byName('GHOST-1'))).toBeCloseTo(0.06, 3)
  })

  it('el fantasma se aleja con el tiempo', () => {
    const near = botsAt(MADRID, 0).find(b => b.callsign === 'GHOST-1')
    const far = botsAt(MADRID, 37.5).find(b => b.callsign === 'GHOST-1')
    expect(distanceKm(MADRID, far)).toBeGreaterThan(distanceKm(MADRID, near))
    expect(distanceKm(MADRID, far)).toBeCloseTo(0.4, 2)
  })
})

describe('reglas · visibilidad', () => {
  it('no manda un contacto que no puedes ver', () => {
    const { game, tick } = makeGame()
    game.join('a', { callsign: 'A', aircraft: 'f35' })
    game.join('b', { callsign: 'B', aircraft: 'f35' })
    game.setPosition('a', MADRID.lat, MADRID.lon)
    game.setPosition('b', MADRID.lat + 0.009, MADRID.lon) // ~1 km
    const a = tick().payloads.find(p => p.id === 'a').payload
    expect(a.contacts.map(c => c.callsign)).not.toContain('B')
  })

  it('a 80 m si se ve, aunque el RCS sea minimo', () => {
    const { game, tick } = makeGame()
    game.join('a', { callsign: 'A', aircraft: 'su27' })
    game.join('b', { callsign: 'B', aircraft: 'f35' })
    game.setPosition('a', MADRID.lat, MADRID.lon)
    game.setPosition('b', MADRID.lat + 0.0007, MADRID.lon) // ~78 m
    const a = tick().payloads.find(p => p.id === 'a').payload
    expect(a.contacts.map(c => c.callsign)).toContain('B')
  })
})

describe('reglas · bloqueo', () => {
  it('crece mientras mantienes el contacto', () => {
    const { tick, advance } = soloGame('f35')
    let p = tick().payloads[0].payload
    expect(p.lock.callsign).toBe('GHOST-1')
    expect(p.lock.ms).toBe(1000)
    advance(1000)
    p = tick().payloads[0].payload
    expect(p.lock.ms).toBe(2000)
    expect(p.lock.needMs).toBe(18000)
  })

  it('si cambias de blanco el contador vuelve a cero', () => {
    const { tick, advance } = soloGame('f35')
    let prev = null
    let switched = false
    for (let i = 0; i < 15 && !switched; i++) {
      const p = tick().payloads[0].payload
      if (prev?.callsign === 'GHOST-1' && p.lock?.callsign === 'FLANKER-1') {
        expect(p.lock.ms).toBe(1000)
        switched = true
      }
      prev = p.lock
      advance(1000)
    }
    expect(switched).toBe(true)
  })

  it('gana quien completa su tiempo de bloqueo', () => {
    const { tick, advance } = soloGame('f35')
    let last = null
    for (let i = 0; i < 40; i++) {
      last = tick()
      if (last.match.phase === 'finished') break
      advance(1000)
    }
    expect(last.match.phase).toBe('finished')
    expect(last.match.winner).toBe('A')
    expect(last.match.reason).toContain('bloqueo sobre')
    expect(last.payloads[0].payload.result.winner).toBe('A')
  })

  it('el Su-27 cierra antes que el F-35', () => {
    const ticksToWin = aircraft => {
      const { tick, advance } = soloGame(aircraft)
      let n = 0
      for (; n < 40; n++) {
        const out = tick()
        if (out.match.phase === 'finished') return n + 1
        advance(1000)
      }
      return -1
    }
    const su27 = ticksToWin('su27')
    const f35 = ticksToWin('f35')
    expect(su27).toBeGreaterThan(0)
    expect(f35).toBeGreaterThan(0)
    expect(su27).toBeLessThan(f35)
  })
})

describe('reglas · ciclo de partida', () => {
  it('al agotarse el tiempo gana quien mas bloqueo acumulo', () => {
    const { tick, advance } = soloGame('f35', { matchSeconds: 5 })
    tick() // arranca la partida y acumula 1 s de bloqueo
    advance(5000)
    const out = tick()
    expect(out.match.phase).toBe('finished')
    expect(out.match.reason).toBe('tiempo agotado')
    expect(out.match.winner).toBe('A')
  })

  it('reinicia la partida tras el marcador', () => {
    const { conf, tick, advance } = soloGame('f35', { matchSeconds: 3 })
    let out = tick()
    advance(3000)
    out = tick()
    expect(out.match.phase).toBe('finished')
    advance(conf.matchRestartSeconds * 1000)
    out = tick()
    expect(out.match.phase).toBe('flying')
    expect(out.payloads[0].payload.remainingMs).toBe(conf.matchSeconds * 1000)
  })

  it('al quedarse la sala vacia se reinicia todo', () => {
    const { game, tick } = soloGame('f35')
    tick()
    expect(game.anchor).not.toBeNull()
    game.remove('a')
    expect(game.size).toBe(0)
    expect(game.anchor).toBeNull()
    expect(game.match.endsAt).toBe(0)
  })

  it('el payload lleva todo lo que espera el cliente', () => {
    const { tick } = soloGame('f35')
    const payload = tick().payloads[0].payload
    expect(payload.type).toBe('radar')
    for (const key of ['phase', 'remainingMs', 'contacts', 'you', 'rangeKm', 'lock', 'lockedBy', 'result']) {
      expect(payload).toHaveProperty(key)
    }
  })

  it('un jugador sin posicion no aparece en el radar de nadie', () => {
    const { game, tick } = makeGame()
    game.join('a', { callsign: 'A', aircraft: 'f35' })
    game.join('b', { callsign: 'B', aircraft: 'f35' })
    game.setPosition('a', MADRID.lat, MADRID.lon)
    const payloads = tick().payloads
    expect(payloads.map(p => p.id)).toEqual(['a'])
  })
})

describe('reglas · altitud', () => {
  it('el ancla toma la altitud del primer jugador y los bots la heredan', () => {
    const ctx = makeGame()
    ctx.game.join('a', { callsign: 'A', aircraft: 'su27' })
    ctx.game.setPosition('a', MADRID.lat, MADRID.lon, 650)
    const bots = botsAt(ctx.game.anchor, 0)
    expect(bots.every(b => b.altM === 650)).toBe(true)
  })

  it('sin altitud no se inventa el campo', () => {
    const ctx = makeGame()
    ctx.game.join('a', { callsign: 'A', aircraft: 'su27' })
    ctx.game.setPosition('a', MADRID.lat, MADRID.lon)
    const bots = botsAt(ctx.game.anchor, 0)
    expect(bots.every(b => b.altM === undefined)).toBe(true)
  })

  it('los contactos llevan la altitud redondeada', () => {
    const ctx = soloGame('su27')
    ctx.game.setPosition('a', MADRID.lat, MADRID.lon, 652.6)
    const { payloads } = ctx.tick()
    const radar = payloads[0].payload
    expect(radar.contacts.length).toBeGreaterThan(0)
    expect(radar.contacts[0].altM).toBe(653)
  })

  it('una altitud no finita no rompe la posicion', () => {
    const ctx = makeGame()
    ctx.game.join('a', { callsign: 'A', aircraft: 'su27' })
    expect(ctx.game.setPosition('a', MADRID.lat, MADRID.lon, Number.NaN)).toBe(true)
    expect(ctx.game.players.get('a').altM).toBeNull()
  })
})
