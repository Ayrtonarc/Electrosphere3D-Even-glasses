// Aeronet · servidor WebSocket.
//
// Toda la logica de juego vive en rules.mjs (pura y testeable). Aqui solo se
// conectan los sockets con las reglas.

import { readFileSync } from 'node:fs'
import { WebSocketServer } from 'ws'
import { createRules } from './rules.mjs'

const cfg = JSON.parse(readFileSync(new URL('../src/shared/aircraft.json', import.meta.url), 'utf8'))
const PORT = Number(process.env.PORT ?? cfg.serverPort)

const rules = createRules(cfg)
const game = rules.createGame()
const sockets = new Map()

const wss = new WebSocketServer({ port: PORT, host: '0.0.0.0' })

wss.on('connection', ws => {
  const id = `p${Date.now().toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`
  let joined = false

  ws.on('message', raw => {
    let msg
    try {
      msg = JSON.parse(raw.toString())
    } catch {
      return
    }

    if (msg.type === 'join') {
      const res = game.join(id, msg)
      if (!res.ok) {
        ws.send(JSON.stringify({ type: 'error', message: res.error }))
        ws.close()
        return
      }
      sockets.set(id, ws)
      joined = true
      ws.send(JSON.stringify({ type: 'welcome', id, tickMs: rules.TICK_MS }))
      console.log(`+ ${res.player.callsign} (${res.player.aircraft}) · ${game.size} jugador(es)`)
      return
    }

    if (msg.type === 'pos' && joined) game.setPosition(id, msg.lat, msg.lon, msg.alt)
  })

  ws.on('close', () => {
    sockets.delete(id)
    if (game.remove(id)) console.log(`- ${id} · ${game.size} jugador(es)`)
  })
})

// ── Tick ──────────────────────────────────────────────────────────────────
let lastSignature = ''

setInterval(() => {
  const { match, payloads } = game.tick()

  const signature = `${match.phase}:${match.endsAt}`
  if (signature !== lastSignature) {
    if (match.endsAt !== 0) {
      if (match.phase === 'flying') console.log(`partida nueva · ${Math.round(rules.MATCH_MS / 1000)} s`)
      else console.log(`resultado: ${match.winner ?? 'empate'} · ${match.reason}`)
    }
    lastSignature = signature
  }

  for (const { id, payload } of payloads) {
    const ws = sockets.get(id)
    if (ws && ws.readyState === ws.OPEN) ws.send(JSON.stringify(payload))
  }
}, rules.TICK_MS)

// Solo anunciamos la escucha cuando el socket esta realmente abierto: los
// clientes (y el test de contrato) esperan esa linea para conectarse.
wss.on('listening', () => {
  console.log(`Aeronet escuchando en ws://0.0.0.0:${PORT}`)
  console.log(
    `Perfiles: ${Object.entries(cfg.types)
      .map(([, v]) => `${v.name} (radar ${v.radar}, rcs ${v.rcs}, bloqueo ${v.lockSeconds}s)`)
      .join(' · ')}`,
  )
  console.log(
    `Alcance maximo del radar en juego: ${Math.round(rules.BASE_KM * 1000)} m base · suelo visual ${Math.round(rules.VISUAL_KM * 1000)} m`,
  )
})
