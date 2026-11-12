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
    }
  })
}

export function createRules(cfg) {
  const BASE_KM = cfg.baseKm * cfg.scale
  const VISUAL_KM = cfg.visualRangeM / 1000
  const TICK_MS = cfg.tickMs
  const MATCH_MS = cfg.matchSeconds * 1000
  const RESTART_MS = cfg.matchRestartSeconds * 1000
  const MAX_CONTACTS = cfg.maxContacts
  const MAX_PLAYERS = cfg.maxPlayers

  const radarOf = id => cfg.types[id]?.radar ?? 1
  const rcsOf = id => cfg.types[id]?.rcs ?? 1
  const lockOf = id => cfg.types[id]?.lockSeconds ?? 10

  /** Alcance de deteccion con suelo visual: nadie es invisible a menos de VISUAL_KM. */
  const detectKm = (observer, target) =>
    Math.max(
      VISUAL_KM,
      BASE_KM * radarOf(observer.aircraft) * Math.pow(Math.max(rcsOf(target.aircraft), 1e-6), 0.25),
    )

  function createGame({ now = () => Date.now() } = {}) {
    const players = new Map()
    let bots = []
    let anchor = null
    let anchorAt = 0
    let match = { phase: 'flying', endsAt: 0, winner: null, reason: '' }

    function startMatch(at) {
      match = { phase: 'flying', endsAt: at + MATCH_MS, winner: null, reason: '' }
      for (const p of players.values()) p.lock = { id: null, ms: 0 }
    }

    function finishMatch(winner, reason, at) {
      if (match.phase === 'finished') return
      match = { phase: 'finished', endsAt: at + RESTART_MS, winner, reason }
    }

    function join(id, info) {
      if (players.size >= MAX_PLAYERS) return { ok: false, error: 'sala llena' }
      const player = {
        id,
        callsign: String(info.callsign ?? 'ANON').slice(0, 12),
        aircraft: cfg.types[info.aircraft] ? info.aircraft : 'su27',
        lat: null,
        lon: null,
        seenAt: now(),
        lock: { id: null, ms: 0 },
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
        match = { phase: 'flying', endsAt: 0, winner: null, reason: '' }
      }
      return true
    }

    function setPosition(id, lat, lon) {
      const me = players.get(id)
      if (!me || typeof lat !== 'number' || typeof lon !== 'number') return false
      me.lat = lat
      me.lon = lon
      me.seenAt = now()
      if (!anchor) {
        anchor = { lat, lon }
        anchorAt = me.seenAt
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
          })
        }
        contacts.sort((a, b) => a.distKm - b.distKm)

        // Bloqueo: mantener fijado el contacto mas cercano que ves.
        let lock = null
        if (match.phase === 'flying') {
          const target = contacts[0] ?? null
          if (!target) {
            me.lock = { id: null, ms: 0 }
          } else if (me.lock.id === target.id) {
            me.lock.ms += TICK_MS
          } else {
            me.lock = { id: target.id, ms: TICK_MS }
          }

          if (target) {
            const needMs = lockOf(me.aircraft) * 1000
            lock = { callsign: target.callsign, aircraft: target.aircraft, ms: me.lock.ms, needMs }
            if (me.lock.ms >= needMs) finishMatch(me.callsign, `bloqueo sobre ${target.callsign}`, at)
          }
        }

        const lockedBy = humans.find(other => other !== me && other.lock?.id === me.id)

        payloads.push({
          id: me.id,
          payload: {
            type: 'radar',
            t: at,
            phase: match.phase,
            remainingMs: Math.max(0, match.endsAt - at),
            contacts: contacts.slice(0, MAX_CONTACTS),
            you: { callsign: me.callsign, aircraft: me.aircraft, lat: me.lat, lon: me.lon },
            rangeKm: Math.max(VISUAL_KM, BASE_KM * radarOf(me.aircraft) * Math.pow(maxRcs, 0.25)),
            lock,
            lockedBy: lockedBy ? lockedBy.callsign : null,
            result: match.phase === 'finished' ? { winner: match.winner, reason: match.reason } : null,
          },
        })
      }

      return { match, payloads }
    }

    return {
      join,
      remove,
      setPosition,
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

  return { detectKm, botsAt, createGame, BASE_KM, VISUAL_KM, TICK_MS, MATCH_MS, RESTART_MS, rcsOf, radarOf, lockOf }
}
