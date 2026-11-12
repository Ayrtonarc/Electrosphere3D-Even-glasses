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

  const radarOf = id => cfg.types[id]?.radar ?? 1
  const rcsOf = id => cfg.types[id]?.rcs ?? 1
  const lockOf = id => cfg.types[id]?.lockSeconds ?? 10

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

  /**
   * Silencio radar: apagarlo te hace dificil de ver, pero tu tambien ves menos.
   * El suelo visual sigue mandando, asi que nadie desaparece a menos de 90 m.
   */
  const SILENT_FACTOR = 0.55
  const emissionFactor = p => (p.emitting === false ? SILENT_FACTOR : 1)

  /** Alcance de deteccion con suelo visual: nadie es invisible a menos de VISUAL_KM. */
  const detectKm = (observer, target) =>
    Math.max(
      VISUAL_KM,
      BASE_KM *
        radarOf(observer.aircraft) *
        Math.pow(Math.max(rcsOf(target.aircraft), 1e-6), 0.25) *
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
    return diff <= LOCK_FOV_DEG / 2
  }

  function createGame({ now = () => Date.now() } = {}) {
    const players = new Map()
    let bots = []
    let anchor = null
    let anchorAt = 0
    let match = { phase: 'flying', endsAt: 0, startedAt: 0, winner: null, reason: '' }

    /**
     * Bloqueo de cada bot. Vive aqui y no en el objeto del bot porque `botsAt`
     * devuelve bots nuevos en cada tick: solo la orbita se recalcula, lo que
     * han conseguido fijar no se puede perder.
     */
    const botLocks = new Map()

    function botState(bot) {
      let st = botLocks.get(bot.callsign)
      if (!st) {
        st = { targetId: null, ms: 0, cooldownUntil: 0 }
        botLocks.set(bot.callsign, st)
      }
      return st
    }

    /**
     * Un turno de bots. Devuelve el derribo que hayan cerrado, si hay alguno,
     * pero **no** termina la partida: el que llama decide, para que un jugador
     * que cierra su bloqueo en el mismo tick gane el empate.
     */
    function updateBots(botList, humans, at) {
      let kill = null
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

        if (st.ms >= botNeedMs(bot)) {
          if (!kill) kill = { callsign: bot.callsign, victim: victim.callsign }
          // El estado se limpia en el tick siguiente, cuando la partida ya esta
          // terminada: asi el aviso llega al 100 % en vez de desaparecer justo
          // antes del derribo.
          st.cooldownUntil = at + BOT_COOLDOWN_MS
        }
      }

      return kill
    }

    function startMatch(at) {
      match = { phase: 'flying', endsAt: at + MATCH_MS, startedAt: at, winner: null, reason: '' }
      for (const p of players.values()) {
        p.lock = { id: null, ms: 0 }
        // Mejor bloqueo de la partida: el rango se calcula con esto, asi que
        // perder el blanco y recuperarlo no borra lo ya conseguido.
        p.bestMs = 0
      }
      botLocks.clear()
    }

    function finishMatch(winner, reason, at) {
      if (match.phase === 'finished') return
      match = { phase: 'finished', endsAt: at + RESTART_MS, startedAt: match.startedAt, winner, reason }
    }

    /**
     * Nota de la partida, estilo arcade, a partir del mejor bloqueo contra lo
     * que pedia tu avion. S es derribo, A victoria por tiempo, B/D segun lo
     * cerca que te quedaste. Se calcula por jugador: el `result` de cada
     * payload lleva el suyo.
     */
    function rankOf(me) {
      const needMs = lockOf(me.aircraft) * 1000
      const bestMs = me.bestMs ?? 0
      const score = needMs > 0 ? Math.min(100, Math.round((bestMs / needMs) * 100)) : 0
      const won = match.winner === me.callsign
      const rank = won ? (bestMs >= needMs ? 'S' : 'A') : score >= 75 ? 'B' : score >= 35 ? 'C' : 'D'
      return { rank, score }
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
        match = { phase: 'flying', endsAt: 0, startedAt: 0, winner: null, reason: '' }
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
      bots = botsAt(anchor, (at - anchorAt) / 1000)

      const targets = [...humans, ...bots]
      const maxRcs = targets.reduce((acc, t) => Math.max(acc, rcsOf(t.aircraft)), 1e-6)

      if (match.endsAt === 0) {
        if (humans.length > 0) startMatch(at)
      } else if (match.phase === 'flying' && at >= match.endsAt) {
        const best = humans.slice().sort((a, b) => (b.lock?.ms ?? 0) - (a.lock?.ms ?? 0))[0]
        finishMatch(best && (best.lock?.ms ?? 0) > 0 ? best.callsign : null, 'tiempo agotado', at)
      } else if (match.phase === 'finished' && at >= match.endsAt) {
        startMatch(at)
      }

      // Los bots eligen blanco antes de montar los payloads: el aviso tiene que
      // salir en el mismo tick en que empiezan a fijar. El derribo, en cambio,
      // se aplica al final para que un jugador que cierra su bloqueo en este
      // mismo tick gane el empate.
      const botKill = updateBots(bots, humans, at)

      const payloads = []

      for (const me of humans) {
        const contacts = []
        for (const other of targets) {
          if (other === me) continue
          const distKm = distanceKm(me, other)
          if (distKm > detectKm(me, other)) continue
          contacts.push({
            id: other.id,
            callsign: other.callsign,
            aircraft: other.aircraft,
            distKm: Math.round(distKm * 1000) / 1000,
            bearingDeg: Math.round(bearingDeg(me, other)),
            kind: other.kind ?? 'human',
            visual: distKm <= LOCK_RANGE_KM && inCone(me, other),
            emitting: other.emitting !== false,
            ...(typeof other.altM === 'number' ? { altM: Math.round(other.altM) } : {}),
          })
        }
        contacts.sort((a, b) => a.distKm - b.distKm)

        // Bloqueo: el blanco elegido, o el mas cercano si no se ha elegido nada.
        let lock = null
        if (match.phase === 'flying') {
          // Solo se fija lo que se ve: dentro del cono y a distancia visual.
          let target = contacts.find(c => c.visual) ?? null
          if (me.targetId) {
            target = contacts.find(c => c.id === me.targetId && c.visual) ?? null
            // Si el elegido ya no aparece en el radar, se suelta para no quedarse clavado.
            if (!contacts.some(c => c.id === me.targetId)) me.targetId = null
          }
          if (!target) {
            me.lock = { id: null, ms: 0 }
          } else if (me.lock.id === target.id) {
            me.lock.ms += TICK_MS
          } else {
            me.lock = { id: target.id, ms: TICK_MS }
          }

          if (target) {
            const needMs = lockOf(me.aircraft) * 1000
            if (me.lock.ms > me.bestMs) me.bestMs = me.lock.ms
            lock = { callsign: target.callsign, aircraft: target.aircraft, ms: me.lock.ms, needMs }
            if (me.lock.ms >= needMs) finishMatch(me.callsign, `bloqueo sobre ${target.callsign}`, at)
          }
        }

        const lockedByPlayer = humans.find(other => other !== me && other.lock?.id === me.id)
        // Amenazas de jugadores y de bots en la misma lista: manda la que este
        // mas cerca de cerrarse, sea de quien sea.
        const threats = []
        if (lockedByPlayer) {
          threats.push({
            callsign: lockedByPlayer.callsign,
            percent: Math.round(
              Math.min(100, (lockedByPlayer.lock.ms / (lockOf(lockedByPlayer.aircraft) * 1000)) * 100),
            ),
          })
        }
        for (const bot of bots) {
          const st = botLocks.get(bot.callsign)
          if (!st || st.targetId !== me.id || st.ms <= 0) continue
          threats.push({
            callsign: bot.callsign,
            percent: Math.round(Math.min(100, (st.ms / botNeedMs(bot)) * 100)),
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
            remainingMs: Math.max(0, match.endsAt - at),
            contacts: contacts.slice(0, MAX_CONTACTS),
            you: {
              callsign: me.callsign,
              aircraft: me.aircraft,
              lat: me.lat,
              lon: me.lon,
              emitting: me.emitting !== false,
              targetId: me.targetId,
            },
            rangeKm: Math.max(VISUAL_KM, BASE_KM * radarOf(me.aircraft) * Math.pow(maxRcs, 0.25)),
            lock,
            lockedBy,
            threat,
            result:
              match.phase === 'finished'
                ? { winner: match.winner, reason: match.reason, ...rankOf(me) }
                : null,
          },
        })
      }

      // Derribo de un bot: la partida se cierra despues de los payloads, asi que
      // el resultado del jugador llega en el tick siguiente (1 s).
      if (botKill && match.phase === 'flying') {
        finishMatch(botKill.callsign, `bloqueo sobre ${botKill.victim}`, at)
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
