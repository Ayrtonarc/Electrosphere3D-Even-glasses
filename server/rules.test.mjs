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

describe('reglas · silencio radar', () => {
  it('un objetivo callado se detecta mas cerca', () => {
    const { rules } = makeGame()
    const normal = rules.detectKm({ aircraft: 'f35' }, { aircraft: 'su27', emitting: true })
    const silent = rules.detectKm({ aircraft: 'f35' }, { aircraft: 'su27', emitting: false })
    expect(silent).toBeCloseTo(normal * rules.SILENT_FACTOR, 6)
  })

  it('el observador callado tambien ve menos', () => {
    const { rules } = makeGame()
    const normal = rules.detectKm({ aircraft: 'f35', emitting: true }, { aircraft: 'su27' })
    const silent = rules.detectKm({ aircraft: 'f35', emitting: false }, { aircraft: 'su27' })
    expect(silent).toBeLessThan(normal)
  })

  it('el suelo visual sigue mandando aunque los dos callen', () => {
    const { rules } = makeGame()
    const km = rules.detectKm({ aircraft: 'su27', emitting: false }, { aircraft: 'f35', emitting: false })
    expect(km).toBeCloseTo(0.09, 2)
  })

  it('setEmission cambia el estado y viaja en el payload', () => {
    const ctx = soloGame('su27')
    expect(ctx.game.players.get('a').emitting).toBe(true)
    ctx.game.setEmission('a', false)
    expect(ctx.game.players.get('a').emitting).toBe(false)
    expect(ctx.tick().payloads[0].payload.you.emitting).toBe(false)
  })

  it('los bots emiten por defecto', () => {
    const ctx = soloGame('su27')
    const radar = ctx.tick().payloads[0].payload
    expect(radar.contacts.every(c => c.emitting === true)).toBe(true)
  })
})

describe('reglas · elegir blanco', () => {
  it('bloquea el blanco elegido aunque no sea el mas cercano', () => {
    const ctx = soloGame('su27')
    const first = ctx.tick().payloads[0].payload
    const nearest = first.contacts[0]
    const farthest = first.contacts.reduce((a, b) => (b.distKm > a.distKm ? b : a))
    expect(farthest.id).not.toBe(nearest.id)

    ctx.game.setTarget('a', farthest.id)
    const radar = ctx.tick().payloads[0].payload
    expect(radar.lock.callsign).toBe(farthest.callsign)
  })

  it('cambiar de blanco reinicia el contador', () => {
    const ctx = soloGame('su27')
    const contacts = ctx.tick().payloads[0].payload.contacts
    ctx.game.setTarget('a', contacts[0].id)
    ctx.tick()
    ctx.tick()
    const before = ctx.game.players.get('a').lock
    expect(before.ms).toBeGreaterThan(ctx.rules.TICK_MS)

    const other = contacts.find(c => c.id !== contacts[0].id)
    ctx.game.setTarget('a', other.id)
    const radar = ctx.tick().payloads[0].payload
    expect(radar.lock.callsign).toBe(other.callsign)
    expect(ctx.game.players.get('a').lock.ms).toBe(ctx.rules.TICK_MS)
  })

  it('si el elegido no esta, se suelta y al tick siguiente vuelve el automatico', () => {
    const ctx = soloGame('su27')
    ctx.game.setTarget('a', 'fantasma')

    // Ese tick se queda sin bloqueo: perder el blanco se nota.
    const lost = ctx.tick().payloads[0].payload
    expect(ctx.game.players.get('a').targetId).toBeNull()
    expect(lost.lock).toBeNull()

    const next = ctx.tick().payloads[0].payload
    expect(next.lock.callsign).toBe(next.contacts[0].callsign)
  })

  it('sin eleccion bloquea al mas cercano', () => {
    const ctx = soloGame('su27')
    const radar = ctx.tick().payloads[0].payload
    expect(radar.you.targetId).toBeNull()
    expect(radar.lock.callsign).toBe(radar.contacts[0].callsign)
  })
})

describe('reglas · cono de vision', () => {
  it('lo de enfrente es visible y lo de detras no', () => {
    const { game, tick } = makeGame()
    game.join('a', { callsign: 'A', aircraft: 'f35' })
    game.setPosition('a', MADRID.lat, MADRID.lon, null, 0) // mirando al norte
    const radar = tick().payloads.find(p => p.id === 'a').payload
    const byName = name => radar.contacts.find(c => c.callsign === name)
    expect(byName('FLANKER-1').visual).toBe(true) // 30°, 220 m
    expect(byName('GHOST-1').visual).toBe(false) // 245°, 60 m
  })

  it('sin rumbo fiable se permite 360 grados', () => {
    const { game, tick } = makeGame()
    game.join('a', { callsign: 'A', aircraft: 'f35' })
    game.setPosition('a', MADRID.lat, MADRID.lon)
    const radar = tick().payloads.find(p => p.id === 'a').payload
    expect(radar.contacts.every(c => c.visual)).toBe(true)
  })

  it('no se fija lo que queda a la espalda', () => {
    const { game, tick, advance } = makeGame()
    game.join('a', { callsign: 'A', aircraft: 'f35' })
    game.setPosition('a', MADRID.lat, MADRID.lon, null, 180) // de espaldas
    let radar = tick().payloads.find(p => p.id === 'a').payload
    expect(radar.contacts.every(c => !c.visual)).toBe(true)
    expect(radar.lock).toBeNull()

    advance(1000)
    radar = tick().payloads.find(p => p.id === 'a').payload
    expect(radar.lock).toBeNull()
  })

  it('girarse hacia el blanco arranca el bloqueo', () => {
    const { game, tick } = makeGame()
    game.join('a', { callsign: 'A', aircraft: 'f35' })
    game.setPosition('a', MADRID.lat, MADRID.lon, null, 180)
    tick()
    game.setPosition('a', MADRID.lat, MADRID.lon, null, 30)
    const radar = tick().payloads.find(p => p.id === 'a').payload
    expect(radar.lock).not.toBeNull()
    expect(radar.lock.callsign).toBe('FLANKER-1')
  })

  it('de frente pero fuera del alcance visual no se fija', () => {
    const { game, tick } = makeGame()
    game.join('a', { callsign: 'A', aircraft: 'f35' })
    game.join('b', { callsign: 'B', aircraft: 'su27' })
    game.setPosition('a', MADRID.lat, MADRID.lon, null, 0)
    game.setPosition('b', MADRID.lat + 0.004, MADRID.lon, null, 0) // ~445 m al norte
    const radar = tick().payloads.find(p => p.id === 'a').payload
    const contact = radar.contacts.find(c => c.callsign === 'B')
    expect(contact).toBeDefined() // el radar lo ve (480 m)
    expect(contact.visual).toBe(false) // pero no esta a la vista
  })
})
