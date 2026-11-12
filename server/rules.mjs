// Reglas puras de Aeronet: visibilidad, bloqueo, partidas y bots.
//
// Este modulo no sabe nada de red ni de relojes reales (el tiempo se inyecta),
// asi que se puede probar entero con tests sin abrir un WebSocket.

const EARTH_KM = 6371
const rad = d => (d * Math.PI) / 180
const deg = r => (r * 180) / Math.PI

export function distanceKm(a, b) {
  const dLat = rad(b.lat - a.lat)
  const dLon = rad(b.lon - a.lon)
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2
  return 2 * EARTH_KM * Math.asin(Math.min(1, Math.sqrt(h)))
}

export function bearingDeg(a, b) {
  const dLon = rad(b.lon - a.lon)
  const y = Math.sin(dLon) * Math.cos(rad(b.lat))
  const x =
    Math.cos(rad(a.lat)) * Math.sin(rad(b.lat)) -
    Math.sin(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.cos(dLon)
  return (deg(Math.atan2(y, x)) + 360) % 360
}

export function offsetLatLon(lat, lon, distKm, bearing) {
  const d = distKm / EARTH_KM
  const br = rad(bearing)
  const lat1 = rad(lat)
  const lon1 = rad(lon)
  const lat2 = Math.asin(Math.sin(lat1) * Math.cos(d) + Math.cos(lat1) * Math.sin(d) * Math.cos(br))
  const lon2 =
    lon1 +
    Math.atan2(Math.sin(br) * Math.sin(d) * Math.cos(lat1), Math.cos(d) - Math.sin(lat1) * Math.sin(lat2))
  return { lat: deg(lat2), lon: ((deg(lon2) + 540) % 360) - 180 }
}

/** Bots de prueba, ya a escala de barrio (radios en km). */
export const GHOST_PERIOD_S = 75
export const BOT_DEFS = [
  { callsign: 'FLANKER-1', aircraft: 'su27', bearingDeg: 30, speedDeg: 1.1, radius: () => 0.22 },
  {
    callsign: 'GHOST-1',
    aircraft: 'f35',
    bearingDeg: 245,
    speedDeg: -0.8,
    radius: t => 0.23 - 0.17 * Math.cos((2 * Math.PI * t) / GHOST_PERIOD_S),
  },
]

/** Posicion de los bots en el instante t (segundos desde el ancla). */
export function botsAt(anchor, tSec) {
  if (!anchor) return []
  return BOT_DEFS.map((def, i) => {
    const bearing = (def.bearingDeg + def.speedDeg * tSec + 360) % 360
    const pos = offsetLatLon(anchor.lat, anchor.lon, Math.abs(def.radius(tSec)), bearing)
    return {
      id: `bot-${i + 1}`,
      callsign: def.callsign,
      aircraft: def.aircraft,
      kind: 'bot',
      lat: pos.lat,
      lon: pos.lon,
      // Los bots vuelan a la altura del ancla: sin dato no se manda el campo.
      altM: anchor.altM ?? undefined,
    }
  })
}

export function createRules(cfg) {
  const BASE_KM = cfg.baseKm * cfg.scale
  const VISUAL_KM = cfg.visualRangeM / 1000
  const LOCK_RANGE_KM = cfg.lock.rangeM / 1000
  const LOCK_FOV_DEG = cfg.lock.fovDeg
  const TICK_MS = cfg.tickMs
  const MATCH_MS = cfg.matchSeconds * 1000
  const RESTART_MS = cfg.matchRestartSeconds * 1000
  const MAX_CONTACTS = cfg.maxContacts
  const MAX_PLAYERS = cfg.maxPlayers

  // Escenario de la ronda. Hoy solo hay uno, pero la tarjeta de partida y el HUD
  // lo leen del servidor para que los ocho jugadores vean exactamente lo mismo.
  const SCENARIO = {
    id: cfg.scenario?.id ?? 'duel',
    name: cfg.scenario?.name ?? 'Duelo',
    rule: cfg.scenario?.rule ?? 'Gana quien cierra el primer bloqueo',
  }

  const radarOf = id => cfg.types[id]?.radar ?? 1
  const rcsOf = id => cfg.types[id]?.rcs ?? 1
  const lockOf = id => cfg.types[id]?.lockSeconds ?? 10

  // ── Armas especiales ────────────────────────────────────────
  // Cada avion trae la suya y cambia una regla concreta. Los numeros viven en
  // `types[id].special.fx`: el catalogo es la unica fuente, y el cliente lee el
  // mismo objeto para la ficha, asi que no hay dos verdades.
  const fxOf = id => cfg.types[id]?.special?.fx ?? {}
  /** Alcance de vision directa propio (el cono se mide sobre el observador). */
  const lockRangeKmOf = id => (fxOf(id).rangeM ?? cfg.lock.rangeM) / 1000
  const fovOf = id => fxOf(id).fovDeg ?? LOCK_FOV_DEG
  /** Lo que le cuesta a OTRO bloquearte (ECM). */
  const ecmOf = id => fxOf(id).lockPenalty ?? 1
  const keepMsOf = id => fxOf(id).keepMs ?? 0
  const freeDeathsOf = id => fxOf(id).freeDeaths ?? 0

  // ── Bots que fijan ──────────────────────────────────────────────────────
  // Los bots no tienen cono de vision ni radar propio: usan un alcance de
  // enganche fijo. Con `detectKm` el bot F-35 (radar 1, 480 m) derribaria a
  // cualquiera en cada partida y el Su-27 (264 m) no llegaria nunca al
  // FLANKER-1 que orbita a 220 m. Un alcance plano es controlable y deja el
  // modelo de RCS para el PvP, que es donde importa.
  const BOT_CFG = cfg.bots ?? {}
  const BOT_ENGAGE_KM = (BOT_CFG.engageRangeM ?? 160) / 1000
  /** Apagar el radar te hace dificil de enganchar tambien para los bots. */
  const BOT_SILENT_FACTOR = BOT_CFG.silentFactor ?? 0.6
  const BOT_LOCK_MULT = BOT_CFG.lockMultiplier ?? 1.2
  const BOT_WARMUP_MS = (BOT_CFG.warmupSeconds ?? 20) * 1000
  const BOT_COOLDOWN_MS = (BOT_CFG.cooldownSeconds ?? 12) * 1000
  const botNeedMs = bot => lockOf(bot.aircraft) * 1000 * BOT_LOCK_MULT

  // ── Puntuacion ──────────────────────────────────────────────────────────
  // La ronda no termina con el primer derribo: es una carrera de puntos. El
  // derribo suma, morir resta, y los objetivos pagan bonus una sola vez.
  const POINTS = { kill: cfg.points?.kill ?? 100, death: cfg.points?.death ?? 50 }

  // ── El as ───────────────────────────────────────────────────────────────
  // El as no es un personaje: es el jugador que va primero en el marcador. Se
  // le ve desde mas lejos (firma mas grande) y derribarlo paga recompensa, para
  // que ir primero sea una responsabilidad y no un paseo.
  const ACE = {
    rcsMultiplier: cfg.ace?.rcsMultiplier ?? 4,
    bounty: cfg.ace?.bounty ?? 250,
  }
  /** Tiempo fuera de juego tras ser derribado. */
  const RESPAWN_MS = (cfg.respawnSeconds ?? 10) * 1000
  /** Los bots no mueren: se retiran un rato para que no se puedan farmear. */
  const BOT_DOWN_MS = (cfg.botDownSeconds ?? 30) * 1000

  const OBJECTIVES = (
    cfg.objectives ?? [
      { id: 'kills', kind: 'primary', label: 'DERRIBA 2', target: 2, bonus: 200 },
      { id: 'hunt', kind: 'secondary', label: 'FIJA 3 BLANCOS', target: 3, bonus: 100 },
      { id: 'clean', kind: 'secondary', label: 'SIN QUE TE DERRIBEN', target: 1, bonus: 100, atEnd: true },
    ]
  ).map(o => ({ atEnd: false, ...o }))

  /**
   * Silencio radar: apagarlo te hace dificil de ver, pero tu tambien ves menos.
   * El suelo visual sigue mandando, asi que nadie desaparece a menos de 90 m.
   */
  const SILENT_FACTOR = 0.55
  const emissionFactor = p => (p.emitting === false ? SILENT_FACTOR : 1)

  /** Alcance de deteccion con suelo visual: nadie es invisible a menos de VISUAL_KM. */
  const detectKm = (observer, target, rcsScale = 1) =>
    Math.max(
      VISUAL_KM,
      BASE_KM *
        radarOf(observer.aircraft) *
        Math.pow(Math.max(rcsOf(target.aircraft) * rcsScale, 1e-6), 0.25) *
        emissionFactor(observer) *
        emissionFactor(target),
    )

  /**
   * Vision directa: el blanco esta cerca Y dentro del cono de ±FOV/2 respecto
   * al rumbo del observador. Sin rumbo fiable (movil parado, GPS sin heading)
   * se permite 360 grados para que el juego siga siendo jugable.
   */
  const inCone = (observer, target) => {
    if (observer.heading == null) return true
    const diff = Math.abs(((bearingDeg(observer, target) - observer.heading + 540) % 360) - 180)
    return diff <= fovOf(observer.aircraft) / 2
  }

  function createGame({ now = () => Date.now() } = {}) {
    const players = new Map()
    let bots = []
    let anchor = null
    let anchorAt = 0
    /** Contador de rondas que no se reinicia al vaciarse la sala. */
    let roundSeq = 0
    let match = { phase: 'flying', endsAt: 0, startedAt: 0, round: 0, winner: null, reason: '' }

    /**
     * Bloqueo de cada bot. Vive aqui y no en el objeto del bot porque `botsAt`
     * devuelve bots nuevos en cada tick: solo la orbita se recalcula, lo que
     * han conseguido fijar no se puede perder.
     */
    const botLocks = new Map()

    /** Bots retirados tras ser derribados: callsign -> instante de vuelta. */
    const botDown = new Map()

    function downPlayer(player, at) {
      player.downUntil = at + RESPAWN_MS
      player.deaths += 1
      // Fox-2: las primeras bajas de la ronda salen gratis.
      if (player.deaths > freeDeathsOf(player.aircraft)) {
        player.score = Math.max(0, player.score - POINTS.death)
      }
      player.lock = { id: null, ms: 0 }
      player.holdUntil = null
    }

    /** Un derribo: cobra el atacante y saca al blanco de la ronda un rato. */
    function awardKill(killer, contact, at, aceTarget = false) {
      killer.score += aceTarget ? ACE.bounty : POINTS.kill
      killer.kills += 1
      killer.lock = { id: null, ms: 0 }

      if (contact.kind === 'bot') {
        // Sin esto se podria farmear al mismo bot en cada pasada: su orbita es
        // siempre la misma, asi que volveria a estar a tiro en segundos.
        botDown.set(contact.callsign, at + BOT_DOWN_MS)
        botLocks.delete(contact.callsign)
        return
      }

      const victim = players.get(contact.id)
      if (victim) downPlayer(victim, at)
    }

    function progressOf(me, objective) {
      switch (objective.id) {
        case 'kills':
          return me.kills
        case 'hunt':
          return me.targets.size
        case 'clean':
          // Morir resta, pero no matar tambien: si no, esconderse sin disparar
          // un tiro daria bonus y ganaria la ronda.
          return me.deaths === 0 && me.kills > 0 ? 1 : 0
        default:
          return 0
      }
    }

    /** Objetivos con su progreso, listos para pintar. */
    function objectivesFor(me) {
      return OBJECTIVES.map(o => {
        const progress = Math.min(o.target, progressOf(me, o))
        // Los de final no se dan por cumplidos hasta que termina la ronda.
        const done = progress >= o.target && (!o.atEnd || match.phase === 'finished')
        return { id: o.id, kind: o.kind, label: o.label, progress, target: o.target, done }
      })
    }

    /** Paga los bonus cumplidos que aun no se hayan pagado. */
    function payObjectives(me, atEnd) {
      for (const o of OBJECTIVES) {
        if (!!o.atEnd !== atEnd) continue
        if (me.awarded.has(o.id)) continue
        if (progressOf(me, o) < o.target) continue
        me.score += o.bonus
        me.awarded.add(o.id)
      }
    }

    function botState(bot) {
      let st = botLocks.get(bot.callsign)
      if (!st) {
        st = { targetId: null, ms: 0, cooldownUntil: 0 }
        botLocks.set(bot.callsign, st)
      }
      return st
    }

    /**
     * Un turno de bots. Derriba directamente: como la ronda ya no se acaba con
     * el primer derribo, no hace falta diferir nada.
     */
    function updateBots(botList, humans, at) {
      const warm = at - match.startedAt < BOT_WARMUP_MS

      for (const bot of botList) {
        const st = botState(bot)
        if (match.phase !== 'flying' || warm || at < st.cooldownUntil) {
          st.targetId = null
          st.ms = 0
          continue
        }

        let victim = null
        let bestKm = Infinity
        for (const h of humans) {
          const km = distanceKm(bot, h)
          const reach = BOT_ENGAGE_KM * (h.emitting === false ? BOT_SILENT_FACTOR : 1)
          if (km > reach) continue
          if (km < bestKm) {
            bestKm = km
            victim = h
          }
        }

        if (!victim) {
          // Te han perdido: sin la espera volverian a engancharse en cuanto
          // asomes, y no habria forma de salir de una.
          if (st.targetId) st.cooldownUntil = at + BOT_COOLDOWN_MS
          st.targetId = null
          st.ms = 0
          continue
        }

        if (st.targetId !== victim.id) {
          st.targetId = victim.id
          st.ms = 0
        }
        st.ms += TICK_MS

        if (st.ms >= botNeedMs(bot) * ecmOf(victim.aircraft)) {
          downPlayer(victim, at)
          st.targetId = null
          st.ms = 0
          st.cooldownUntil = at + BOT_COOLDOWN_MS
        }
      }
    }

    function startMatch(at) {
      match = {
        phase: 'flying',
        endsAt: at + MATCH_MS,
        startedAt: at,
        round: ++roundSeq,
        winner: null,
        reason: '',
      }
      for (const p of players.values()) {
        p.lock = { id: null, ms: 0 }
        // Mejor bloqueo de la partida, para el rango final.
        p.bestMs = 0
        p.score = 0
        p.kills = 0
        p.deaths = 0
        p.downUntil = 0
        p.holdUntil = null
        p.targets = new Set()
        p.awarded = new Set()
      }
      botLocks.clear()
      botDown.clear()
    }

    function finishMatch(winner, reason, at) {
      if (match.phase === 'finished') return
      match = {
        phase: 'finished',
        endsAt: at + RESTART_MS,
        startedAt: match.startedAt,
        round: match.round,
        winner,
        reason,
      }
    }

    /**
     * Nota de la partida a partir de los puntos y de la cabeza de la tabla.
     * S exige ganar con 400 (dos derribos y el primario), A ganar de cualquier
     * forma, B acercarse al lider, C haber rascado algo y D nada.
     */
    function rankOf(me, topScore) {
      const points = me.score ?? 0
      const won = match.winner === me.callsign
      const rank = won
        ? points >= 400
          ? 'S'
          : 'A'
        : topScore > 0 && points >= topScore * 0.75
          ? 'B'
          : points > 0
            ? 'C'
            : 'D'
      return { rank, points }
    }

    function join(id, info) {
      if (players.size >= MAX_PLAYERS) return { ok: false, error: 'sala llena' }
      const player = {
        id,
        callsign: String(info.callsign ?? 'ANON').slice(0, 12),
        aircraft: cfg.types[info.aircraft] ? info.aircraft : 'su27',
        lat: null,
        lon: null,
        altM: null,
        seenAt: now(),
        lock: { id: null, ms: 0 },
        /** Mejor bloqueo de la partida, para el rango final. */
        bestMs: 0,
        /** Marcador de la ronda: puntos, derribos y bajas. */
        score: 0,
        kills: 0,
        deaths: 0,
        /** Hasta cuando esta fuera de juego por haber sido derribado. */
        downUntil: 0,
        /** Caducidad de la memoria de bloqueo (solo aviones con QAAM). */
        holdUntil: null,
        /** Blancos distintos que ha llegado a fijar (objetivo secundario). */
        targets: new Set(),
        /** Bonus de objetivos ya cobrados. */
        awarded: new Set(),
        /** Radar encendido: apagarlo es la unica forma de pasar desapercibido. */
        emitting: true,
        /** Blanco elegido a mano; `null` = automatico al mas cercano. */
        targetId: null,
      }
      players.set(id, player)
      return { ok: true, player }
    }

    function remove(id) {
      if (!players.delete(id)) return false
      if (players.size === 0) {
        anchor = null
        anchorAt = 0
        bots = []
        botLocks.clear()
        match = { phase: 'flying', endsAt: 0, startedAt: 0, round: 0, winner: null, reason: '' }
      }
      return true
    }

    function setEmission(id, on) {
      const me = players.get(id)
      if (!me) return false
      me.emitting = on !== false
      return true
    }

    function setTarget(id, targetId) {
      const me = players.get(id)
      if (!me) return false
      me.targetId = typeof targetId === 'string' && targetId ? targetId : null
      return true
    }

    function setPosition(id, lat, lon, altM, headingDeg) {
      const me = players.get(id)
      if (!me || typeof lat !== 'number' || typeof lon !== 'number') return false
      me.lat = lat
      me.lon = lon
      // La altitud es opcional: si el GPS del movil no la da, se queda en null.
      if (typeof altM === 'number' && Number.isFinite(altM)) me.altM = altM
      // El rumbo define el cono de vision; sin el se permite 360 grados.
      me.heading =
        typeof headingDeg === 'number' && Number.isFinite(headingDeg)
          ? ((headingDeg % 360) + 360) % 360
          : null
      me.seenAt = now()
      if (!anchor) {
        anchor = { lat, lon, altM: me.altM }
        anchorAt = me.seenAt
      } else if (anchor.altM == null && typeof me.altM === 'number') {
        // El primer fix puede llegar sin altitud (GPS arrancando): se adopta en
        // cuanto alguien la da, o los bots se quedarian sin altitud para siempre.
        anchor.altM = me.altM
      }
      return true
    }

    /** Jugadores que llevan demasiado tiempo sin mandar posicion (movil dormido). */
    function prune(maxIdleMs) {
      const at = now()
      const dead = []
      for (const [id, p] of players) {
        if (at - p.seenAt > maxIdleMs) dead.push(id)
      }
      for (const id of dead) remove(id)
      return dead
    }

    function tick() {
      const at = now()
      prune(60_000)

      const humans = [...players.values()].filter(p => p.lat !== null)
      // Los derribados siguen viendo el radar, pero no son objetivo de nadie ni
      // pueden fijar hasta que se recuperan.
      const alive = humans.filter(p => at >= (p.downUntil ?? 0))

      // El as: el que lidera el marcador. Rota solo, segun se juega.
      const leader = humans.slice().sort((a, b) => b.score - a.score)[0]
      const topScore = leader?.score ?? 0
      const aceId = topScore > 0 ? leader.id : null
      const isAce = t => aceId !== null && t.id === aceId
      const leaderPayload = topScore > 0 ? { callsign: leader.callsign, score: topScore } : null

      bots = botsAt(anchor, (at - anchorAt) / 1000).filter(b => at >= (botDown.get(b.callsign) ?? 0))

      const targets = [...alive, ...bots]
      const rcsScale = t => (isAce(t) ? ACE.rcsMultiplier : 1)
      const maxRcs = targets.reduce((acc, t) => Math.max(acc, rcsOf(t.aircraft) * rcsScale(t)), 1e-6)

      if (match.endsAt === 0) {
        if (humans.length > 0) startMatch(at)
      } else if (match.phase === 'flying' && at >= match.endsAt) {
        // Los objetivos de final se pagan antes de decidir el ganador.
        for (const p of humans) payObjectives(p, true)
        const best = humans.slice().sort((a, b) => b.score - a.score)[0]
        const winner = best && best.score > 0 ? best.callsign : null
        finishMatch(winner, winner ? 'puntuación' : 'tiempo agotado', at)
      } else if (match.phase === 'finished' && at >= match.endsAt) {
        startMatch(at)
      }

      updateBots(bots, alive, at)

      const payloads = []

      for (const me of humans) {
        const contacts = []
        for (const other of targets) {
          if (other === me) continue
          const distKm = distanceKm(me, other)
          // Al as se le ve desde mas lejos: es el precio de ir primero.
          if (distKm > detectKm(me, other, rcsScale(other))) continue
          contacts.push({
            id: other.id,
            callsign: other.callsign,
            aircraft: other.aircraft,
            distKm: Math.round(distKm * 1000) / 1000,
            bearingDeg: Math.round(bearingDeg(me, other)),
            kind: other.kind ?? 'human',
            visual: distKm <= lockRangeKmOf(me.aircraft) && inCone(me, other),
            emitting: other.emitting !== false,
            ...(isAce(other) ? { ace: true } : {}),
            ...(typeof other.altM === 'number' ? { altM: Math.round(other.altM) } : {}),
          })
        }
        contacts.sort((a, b) => a.distKm - b.distKm)

        // Bloqueo: el blanco elegido, o el mas cercano si no se ha elegido nada.
        let lock = null
        const flying = match.phase === 'flying' && at >= (me.downUntil ?? 0)
        if (flying) {
          // El blanco actual manda mientras siga a la vista: si pasa alguien
          // mas cerca, cambiar de golpe reinicia el contador y el jugador no
          // entiende por que. Para cambiar de blanco esta la rueda.
          const keep = me.lock.id ? contacts.find(c => c.id === me.lock.id && c.visual) : null
          let target = keep ?? null
          if (me.targetId) {
            target = contacts.find(c => c.id === me.targetId && c.visual) ?? null
            // Si el elegido ya no aparece en el radar, se suelta para no quedarse clavado.
            if (!contacts.some(c => c.id === me.targetId)) me.targetId = null
          } else if (!target) {
            target = contacts.find(c => c.visual) ?? null
          }
          if (!target) {
            // Sin blanco: si el avion tiene memoria de bloqueo (QAAM) se
            // conserva el progreso un rato por si vuelve a asomar.
            const keepMs = keepMsOf(me.aircraft)
            if (me.lock.id && keepMs > 0) {
              if (me.holdUntil == null) me.holdUntil = at + keepMs
              if (at > me.holdUntil) {
                me.lock = { id: null, ms: 0 }
                me.holdUntil = null
              }
            } else {
              me.lock = { id: null, ms: 0 }
            }
          } else if (me.lock.id === target.id) {
            me.holdUntil = null
            me.lock.ms += TICK_MS
          } else {
            me.lock = { id: target.id, ms: TICK_MS }
            me.holdUntil = null
          }

          if (target) {
            const needMs = lockOf(me.aircraft) * 1000 * ecmOf(target.aircraft)
            if (me.lock.ms > me.bestMs) me.bestMs = me.lock.ms
            me.targets.add(target.id)
            lock = { callsign: target.callsign, aircraft: target.aircraft, ms: me.lock.ms, needMs }
            // El derribo cobra y sigue la ronda: esto es una carrera de puntos.
            if (me.lock.ms >= needMs) awardKill(me, target, at, isAce(target))
          }

          payObjectives(me, false)
        } else if (match.phase === 'flying') {
          me.lock = { id: null, ms: 0 }
        }

        const lockedByPlayer = alive.find(other => other !== me && other.lock?.id === me.id)
        // Amenazas de jugadores y de bots en la misma lista: manda la que este
        // mas cerca de cerrarse, sea de quien sea.
        const threats = []
        if (lockedByPlayer) {
          threats.push({
            callsign: lockedByPlayer.callsign,
            // Hacia donde esta el que te fija, para que el aviso pueda señalar.
            bearingDeg: Math.round(bearingDeg(me, lockedByPlayer)),
            percent: Math.round(
              Math.min(
                100,
                (lockedByPlayer.lock.ms /
                  (lockOf(lockedByPlayer.aircraft) * 1000 * ecmOf(me.aircraft))) *
                  100,
              ),
            ),
          })
        }
        for (const bot of bots) {
          const st = botLocks.get(bot.callsign)
          if (!st || st.targetId !== me.id || st.ms <= 0) continue
          threats.push({
            callsign: bot.callsign,
            bearingDeg: Math.round(bearingDeg(me, bot)),
            percent: Math.round(
              Math.min(100, (st.ms / (botNeedMs(bot) * ecmOf(me.aircraft))) * 100),
            ),
          })
        }
        threats.sort((a, b) => b.percent - a.percent)

        // Aviso de misil: cuanto le falta al que te fija. El servidor solo dice
        // el porcentaje; el umbral de "MISSILE" es del cliente.
        const threat = threats[0] ?? null
        const lockedBy = threat ? threat.callsign : null

        payloads.push({
          id: me.id,
          payload: {
            type: 'radar',
            t: at,
            phase: match.phase,
            round: match.round,
            scenario: SCENARIO,
            remainingMs: Math.max(0, match.endsAt - at),
            contacts: contacts.slice(0, MAX_CONTACTS),
            you: {
              callsign: me.callsign,
              aircraft: me.aircraft,
              lat: me.lat,
              lon: me.lon,
              emitting: me.emitting !== false,
              targetId: me.targetId,
              score: me.score,
              kills: me.kills,
              deaths: me.deaths,
              /** Milisegundos que le quedan fuera de juego; 0 si esta en vuelo. */
              downMs: Math.max(0, (me.downUntil ?? 0) - at),
              /** true si lleva la marca de as de la ronda. */
              ace: isAce(me),
            },
            objectives: objectivesFor(me),
            leader: leaderPayload,
            rangeKm: Math.max(VISUAL_KM, BASE_KM * radarOf(me.aircraft) * Math.pow(maxRcs, 0.25)),
            lock,
            lockedBy,
            threat,
            result:
              match.phase === 'finished'
                ? { winner: match.winner, reason: match.reason, ...rankOf(me, topScore) }
                : null,
          },
        })
      }

      return { match, payloads }
    }

    return {
      join,
      remove,
      setPosition,
      setEmission,
      setTarget,
      prune,
      tick,
      get size() {
        return players.size
      },
      get match() {
        return match
      },
      get players() {
        return players
      },
      get anchor() {
        return anchor
      },
    }
  }

  return {
    detectKm,
    botsAt,
    createGame,
    BASE_KM,
    VISUAL_KM,
    TICK_MS,
    MATCH_MS,
    RESTART_MS,
    SILENT_FACTOR,
    rcsOf,
    radarOf,
    lockOf,
  }
}
