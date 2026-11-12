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

  it('elegir otro blanco a mano reinicia el contador', () => {
    const { game, tick, advance } = soloGame('f35')
    tick()
    advance(1000)
    expect(tick().payloads[0].payload.lock.callsign).toBe('GHOST-1')

    game.setTarget('a', 'bot-1') // FLANKER-1
    const p = tick().payloads[0].payload
    expect(p.lock.callsign).toBe('FLANKER-1')
    expect(p.lock.ms).toBe(1000)
  })

  it('no cambia de blanco porque pase alguien mas cerca', () => {
    // El fantasma se aleja y se pierde a los ~9 s; el Flanker, fijo a 220 m,
    // mantiene el bloqueo aunque luego el fantasma vuelva a acercarse.
    const { game, tick, advance } = soloGame('f35', {
      bots: { engageRangeM: 1, lockMultiplier: 1, warmupSeconds: 0, cooldownSeconds: 0 },
    })
    let ms = 0
    for (let i = 0; i < 74; i++) {
      if (i % 2 === 0) game.setPosition('a', MADRID.lat, MADRID.lon)
      const p = tick().payloads[0].payload
      if (p.lock?.callsign === 'FLANKER-1') ms = p.lock.ms
      // Con el fantasma mas cerca delante, el blanco no debe saltar.
      if (i >= 68 && i < 72) expect(p.lock?.callsign).toBe('FLANKER-1')
      advance(1000)
    }
    expect(ms).toBeGreaterThan(15000)
  })

  // Bots pasivos: el fantasma solo se ve a menos de 90 m y se pierde enseguida,
  // asi que sin esto el primer derribo lo decide la orbita y no la regla.
  const passive = { engageRangeM: 1, lockMultiplier: 1, warmupSeconds: 0, cooldownSeconds: 0 }

  it('el derribo suma puntos y la ronda sigue', () => {
    const { tick, advance } = soloGame('f35', { bots: passive })
    let payload = null
    for (let i = 0; i < 28; i++) {
      payload = tick().payloads[0].payload
      advance(1000)
    }
    expect(payload.you.kills).toBe(1)
    expect(payload.you.score).toBe(100)
    expect(payload.phase).toBe('flying')
  })

  it('el objetivo primario paga su bonus al segundo derribo', () => {
    const { game, tick, advance } = soloGame('f35', { bots: passive })
    let payload = null
    for (let i = 0; i < 90; i++) {
      // Sin posiciones el servidor poda al jugador a los 60 s.
      if (i % 2 === 0) game.setPosition('a', MADRID.lat, MADRID.lon)
      payload = tick().payloads[0].payload
      if (payload.you.kills >= 2) break
      advance(1000)
    }
    expect(payload.you.kills).toBe(2)
    // 100 + 100 de los derribos y 200 del primario.
    expect(payload.you.score).toBe(400)
  })

  it('el Su-27 derriba antes que el F-35', () => {
    const ticksToKill = aircraft => {
      const { tick, advance } = soloGame(aircraft, { bots: passive })
      for (let n = 0; n < 60; n++) {
        if (tick().payloads[0].payload.you.kills > 0) return n + 1
        advance(1000)
      }
      return -1
    }
    const su27 = ticksToKill('su27')
    const f35 = ticksToKill('f35')
    expect(su27).toBeGreaterThan(0)
    expect(f35).toBeGreaterThan(0)
    expect(su27).toBeLessThan(f35)
  })
})

describe('reglas · ciclo de partida', () => {
  it('al agotarse el tiempo gana quien mas puntos tiene', () => {
    // 5 s no dan ni para un derribo del F-35 (18 s): nadie puntua.
    const { tick, advance } = soloGame('f35', { matchSeconds: 5 })
    tick()
    advance(5000)
    const out = tick()
    expect(out.match.phase).toBe('finished')
    expect(out.match.reason).toBe('tiempo agotado')
    expect(out.match.winner).toBeNull()
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

describe('reglas · rango', () => {
  const passive = { engageRangeM: 1, lockMultiplier: 1, warmupSeconds: 0, cooldownSeconds: 0 }

  it('ganar con dos derribos se lleva una S', () => {
    const { game, tick, advance } = soloGame('f35', { bots: passive, matchSeconds: 90 })
    let last = null
    for (let i = 0; i < 95; i++) {
      if (i % 2 === 0) game.setPosition('a', MADRID.lat, MADRID.lon)
      last = tick()
      if (last.match.phase === 'finished') break
      advance(1000)
    }
    const result = last.payloads[0].payload.result
    expect(result.winner).toBe('A')
    expect(result.rank).toBe('S')
    // 200 de dos derribos, 200 del primario y 100 de no morir.
    expect(result.points).toBe(500)
  })

  it('ganar con un solo derribo se queda en A', () => {
    const { tick, advance } = soloGame('f35', { bots: passive, matchSeconds: 30 })
    let last = null
    for (let i = 0; i < 40; i++) {
      last = tick()
      if (last.match.phase === 'finished') break
      advance(1000)
    }
    const payload = last.payloads[0].payload
    expect(payload.result.winner).toBe('A')
    expect(payload.result.rank).toBe('A')
    expect(payload.result.points).toBe(200) // derribo + no morir
  })

  it('el que no puntua acaba en D y no gana', () => {
    const { tick, advance } = soloGame('f35', { matchSeconds: 3 })
    // De espaldas a todo: ni fija ni derriba.
    let last = null
    for (let i = 0; i < 10; i++) {
      const round = tick()
      last = round
      if (round.match.phase === 'finished') break
      advance(1000)
    }
    const result = last.payloads[0].payload.result
    expect(result.winner).toBeNull()
    expect(result.rank).toBe('D')
    expect(result.points).toBe(0)
  })
})

describe('reglas · amenaza', () => {
  it('el que te fija aparece con su progreso', () => {
    const { game, tick, advance } = makeGame()
    game.join('a', { callsign: 'AGRESOR', aircraft: 'su27' }) // fija en 10 s
    game.join('b', { callsign: 'VICTIMA', aircraft: 'f35' })
    game.setPosition('a', MADRID.lat, MADRID.lon)
    game.setPosition('b', MADRID.lat + 0.0005, MADRID.lon)

    tick()
    advance(1000)
    tick()
    advance(1000)
    const radar = tick().payloads.find(p => p.id === 'b').payload

    expect(radar.lockedBy).toBe('AGRESOR')
    // El porcentaje manda; la marcacion se anade para poder señalar con flecha.
    expect(radar.threat).toMatchObject({ callsign: 'AGRESOR', percent: 30 })
    expect(radar.threat.bearingDeg).toBeGreaterThanOrEqual(0)
  })

  it('sin nadie encima no hay amenaza', () => {
    const radar = soloGame('f35').tick().payloads[0].payload
    expect(radar.lockedBy).toBeNull()
    expect(radar.threat).toBeNull()
  })
})

describe('reglas · bots que fijan', () => {
  // Con `lockMultiplier: 0.1` el F-35 del bot cierra en 1,8 s y las pruebas no
  // dependen de la orbita del fantasma.
  const quick = { engageRangeM: 200, lockMultiplier: 0.1, warmupSeconds: 0, cooldownSeconds: 5 }

  it('durante el calentamiento no enganchan', () => {
    const { tick, advance } = soloGame('f35', {
      bots: { ...quick, warmupSeconds: 20 },
    })
    for (let i = 0; i < 10; i++) {
      const payload = tick().payloads[0].payload
      expect(payload.lockedBy).toBeNull()
      expect(payload.threat).toBeNull()
      advance(1000)
    }
  })

  it('cuando el bot cierra, te derriba pero la ronda sigue', () => {
    const { tick, advance } = soloGame('f35', { bots: quick })
    let payload = null
    for (let i = 0; i < 6; i++) {
      payload = tick().payloads[0].payload
      if ((payload.you.downMs ?? 0) > 0) break
      advance(1000)
    }

    expect(payload.phase).toBe('flying')
    expect(payload.you.deaths).toBe(1)
    expect(payload.you.downMs).toBeGreaterThan(0)
    // Morir resta, y sin puntos previos no se baja de cero.
    expect(payload.you.score).toBe(0)
  })

  it('el aviso de amenaza trae el progreso del bot', () => {
    const { tick, advance } = soloGame('f35', {
      bots: { ...quick, lockMultiplier: 1 },
    })
    tick()
    advance(1000)
    tick()
    advance(1000)
    const payload = tick().payloads[0].payload

    expect(payload.lockedBy).toBe('GHOST-1')
    // 3 s de los 18 s que tarda el F-35: 16,7 % redondeado.
    expect(payload.threat).toMatchObject({ callsign: 'GHOST-1', percent: 17 })
  })

  it('apagar el radar acorta el alcance al que te enganchan', () => {
    // A los ~15 s de orbita el fantasma esta a ~177 m: dentro de los 200 m
    // normales, fuera de los 120 m con el radar en silencio.
    const enemyAt = emitting => {
      const { game, tick, advance } = makeGame({
        bots: { engageRangeM: 200, silentFactor: 0.6, lockMultiplier: 1, warmupSeconds: 0, cooldownSeconds: 30 },
      })
      game.join('a', { callsign: 'A', aircraft: 'f35' })
      // De espaldas a todo: asi el jugador no fija y la partida sigue viva.
      game.setPosition('a', MADRID.lat, MADRID.lon, null, 140)
      if (!emitting) game.setEmission('a', false)

      let payload = null
      for (let i = 0; i <= 15; i++) {
        payload = tick().payloads[0].payload
        advance(1000)
      }
      return payload
    }

    expect(enemyAt(true).lockedBy).toBe('GHOST-1')
    expect(enemyAt(false).lockedBy).toBeNull()
  })

  it('el FLANKER-1 orbita fuera de alcance: no te caza desde lejos', () => {
    const { tick, advance } = soloGame('su27', { bots: { ...quick, lockMultiplier: 1 } })
    // Esta a 220 m y el alcance de enganche son 200: se le ve, pero no dispara.
    const seen = new Set()
    for (let i = 0; i < 8; i++) {
      const payload = tick().payloads[0].payload
      expect(payload.contacts.map(c => c.callsign)).toContain('FLANKER-1')
      if (payload.lockedBy) seen.add(payload.lockedBy)
      advance(1000)
    }
    expect(seen.has('FLANKER-1')).toBe(false)
  })
})

describe('reglas · calibracion de los bots', () => {
  it('con la configuracion real, el fantasma derriba al que se queda quieto', () => {
    // Guarda de calibracion: si alguien toca engageRangeM, lockMultiplier o la
    // orbita del fantasma sin mirar, esto avisa. La cuenta con los valores por
    // defecto es: aviso a los 10 s (fin del calentamiento) y derribo al pasar
    // cerca por segunda vez, hacia el segundo 73.
    const { game, tick, advance } = makeGame()
    game.join('a', { callsign: 'A', aircraft: 'f35' })
    game.setPosition('a', MADRID.lat, MADRID.lon, null, 140)

    let warned = false
    let peak = 0
    let deaths = 0
    let finish = null
    for (let i = 0; i < 120 && !finish; i++) {
      // El movil manda posicion cada 2 s; sin esto el servidor lo poda a los 60.
      if (i % 2 === 0) game.setPosition('a', MADRID.lat, MADRID.lon, null, 140)
      const round = tick()
      const payload = round.payloads[0]?.payload
      if (payload?.lockedBy === 'GHOST-1') warned = true
      if (payload?.threat) peak = Math.max(peak, payload.threat.percent)
      if (payload) deaths = payload.you.deaths ?? deaths
      if (round.match.phase === 'finished') finish = round.match
      advance(1000)
    }

    expect(warned).toBe(true)
    // El aviso llega al umbral de misil antes de que el bot cierre.
    expect(peak).toBeGreaterThanOrEqual(70)
    // La ronda sigue: el bot solo te saca de juego un rato y te resta puntos.
    expect(finish).toBeNull()
    expect(deaths).toBeGreaterThan(0)
  })

  it('el jugador que fija a tiempo madruga al bot', () => {
    // Con la config real el bot necesita 10 s de calentamiento mas 14,4 s de
    // bloqueo, y el jugador cierra el fantasma en 18 s: apurando, pero llega
    // antes. Si alguien baja `warmupSeconds` esto empieza a fallar.
    const { game, tick, advance } = makeGame()
    game.join('a', { callsign: 'A', aircraft: 'f35' })
    game.setPosition('a', MADRID.lat, MADRID.lon) // sin rumbo: cono de 360

    let payload = null
    for (let i = 0; i < 35; i++) {
      if (i % 2 === 0) game.setPosition('a', MADRID.lat, MADRID.lon)
      payload = tick().payloads[0].payload
      advance(1000)
    }

    expect(payload.you.kills).toBe(1)
    expect(payload.you.deaths).toBe(0)
  })
})

describe('reglas · ronda y escenario', () => {
  it('cada partida sube el numero de ronda y lo manda en el payload', () => {
    const { tick, advance } = soloGame('f35', { matchSeconds: 2 })
    let last = null
    for (let i = 0; i < 20; i++) {
      last = tick()
      advance(1000)
    }
    const payload = last.payloads[0].payload
    expect(payload.scenario).toMatchObject({ id: 'duel', name: 'Duelo' })
    expect(payload.scenario.rule).toContain('puntos')
    // En 20 s ha dado tiempo a terminar la ronda 1 y empezar la 2.
    expect(payload.round).toBeGreaterThan(1)
  })

  it('el escenario y la ronda son los mismos para todos', () => {
    const { game, tick } = makeGame()
    game.join('a', { callsign: 'A', aircraft: 'f35' })
    game.join('b', { callsign: 'B', aircraft: 'su27' })
    game.setPosition('a', MADRID.lat, MADRID.lon)
    game.setPosition('b', MADRID.lat + 0.0005, MADRID.lon)

    const out = tick().payloads
    expect(out[0].payload.scenario).toEqual(out[1].payload.scenario)
    expect(out[0].payload.round).toBe(out[1].payload.round)
  })

  it('la ronda no se reinicia al vaciarse la sala', () => {
    const { game, tick, advance } = makeGame({ matchSeconds: 2 })
    game.join('a', { callsign: 'A', aircraft: 'f35' })
    game.setPosition('a', MADRID.lat, MADRID.lon)
    for (let i = 0; i < 16; i++) {
      tick()
      advance(1000)
    }
    const before = tick().payloads[0].payload.round

    game.remove('a')
    game.join('b', { callsign: 'B', aircraft: 'f35' })
    game.setPosition('b', MADRID.lat, MADRID.lon)
    const after = tick().payloads[0].payload.round

    expect(after).toBeGreaterThan(before)
  })
})
