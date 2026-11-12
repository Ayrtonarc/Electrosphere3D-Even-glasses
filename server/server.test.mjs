import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

// Test de contrato del protocolo: levanta el servidor de verdad en un puerto
// libre y comprueba que un cliente recibe lo que espera el HUD.

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const PORT = 9100 + Math.floor(Math.random() * 400)
const MADRID = { lat: 40.4155, lon: -3.6844 }

let child = null

beforeAll(async () => {
  child = spawn(process.execPath, ['server/index.mjs'], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(PORT) },
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('el servidor no arrancó')), 10_000)
    child.stdout.on('data', chunk => {
      if (chunk.toString().includes('escuchando')) {
        clearTimeout(timer)
        resolve()
      }
    })
    child.on('error', reject)
  })
}, 15_000)

afterAll(() => {
  child?.kill('SIGTERM')
})

function openClient() {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${PORT}`)
    const messages = []
    ws.onmessage = event => messages.push(JSON.parse(event.data))
    ws.onopen = () => resolve({ ws, messages })
    ws.onerror = () => reject(new Error('no se pudo conectar'))
  })
}

function waitFor(messages, type, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const started = Date.now()
    const timer = setInterval(() => {
      const found = messages.find(m => m.type === type)
      if (found) {
        clearInterval(timer)
        resolve(found)
        return
      }
      if (Date.now() - started > timeoutMs) {
        clearInterval(timer)
        reject(new Error(`sin mensaje ${type}`))
      }
    }, 50)
  })
}

/** Espera un radar nuevo (a partir de `startIndex`) que cumpla el predicado. */
function waitForRadarSince(messages, startIndex, predicate, timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    const started = Date.now()
    const timer = setInterval(() => {
      const found = messages
        .slice(startIndex)
        .filter(m => m.type === 'radar')
        .find(predicate)
      if (found) {
        clearInterval(timer)
        resolve(found)
        return
      }
      if (Date.now() - started > timeoutMs) {
        clearInterval(timer)
        reject(new Error('sin radar que cumpla la condicion'))
      }
    }, 50)
  })
}

describe('protocolo WebSocket', () => {
  it('saluda, posiciona y manda radar con el contrato completo', async () => {
    const { ws, messages } = await openClient()

    ws.send(JSON.stringify({ type: 'join', callsign: 'TEST', aircraft: 'f35' }))
    const welcome = await waitFor(messages, 'welcome')
    expect(welcome.id).toBeTruthy()
    expect(welcome.tickMs).toBeGreaterThan(0)

    ws.send(JSON.stringify({ type: 'pos', ...MADRID, alt: 650 }))

    const radar = await waitFor(messages, 'radar')
    expect(radar.phase).toBe('flying')
    expect(radar.remainingMs).toBeGreaterThan(0)
    expect(radar.rangeKm).toBeGreaterThan(0)
    expect(radar.contacts.length).toBeGreaterThan(0)
    expect(radar.contacts[0]).toMatchObject({
      callsign: expect.any(String),
      aircraft: expect.any(String),
      distKm: expect.any(Number),
      bearingDeg: expect.any(Number),
      kind: expect.any(String),
      altM: expect.any(Number),
    })
    expect(radar.lock).not.toBeNull()
    expect(radar.you).toMatchObject({ callsign: 'TEST', aircraft: 'f35' })
    expect(radar.result).toBeNull()

    ws.close()
  }, 15_000)

  it('acepta el modo silencio y lo refleja en el radar', async () => {
    const { ws, messages } = await openClient()
    ws.send(JSON.stringify({ type: 'join', callsign: 'QUIET', aircraft: 'su27' }))
    await waitFor(messages, 'welcome')
    ws.send(JSON.stringify({ type: 'pos', ...MADRID, alt: 650 }))

    const before = await waitFor(messages, 'radar')
    expect(before.you.emitting).toBe(true)
    expect(before.you.targetId).toBeNull()

    const seen = messages.length
    ws.send(JSON.stringify({ type: 'emission', on: false }))
    ws.send(JSON.stringify({ type: 'target', id: before.contacts[0].id }))

    // Hay que esperar un radar NUEVO: el anterior ya estaba en `messages`.
    await new Promise((resolve, reject) => {
      const started = Date.now()
      const timer = setInterval(() => {
        if (messages.slice(seen).some(m => m.type === 'radar')) {
          clearInterval(timer)
          resolve()
        } else if (Date.now() - started > 5000) {
          clearInterval(timer)
          reject(new Error('sin radar nuevo'))
        }
      }, 50)
    })
    const after = messages.filter(m => m.type === 'radar').at(-1)
    expect(after.you.emitting).toBe(false)
    expect(after.lock.callsign).toBe(before.contacts[0].callsign)

    ws.close()
  }, 15_000)

  it('rechaza un mensaje que no es JSON sin romper la conexion', async () => {
    const { ws, messages } = await openClient()
    ws.send('esto no es json')
    ws.send(JSON.stringify({ type: 'join', callsign: 'BRUTO', aircraft: 'su27' }))
    await waitFor(messages, 'welcome')
    ws.send(JSON.stringify({ type: 'pos', ...MADRID }))
    const radar = await waitFor(messages, 'radar')
    expect(radar.you.callsign).toBe('BRUTO')
    ws.close()
  }, 15_000)

  it('el rumbo viaja y decide el cono de vision', async () => {
    const a = await openClient()
    a.ws.send(JSON.stringify({ type: 'join', callsign: 'CONO-A', aircraft: 'f35' }))
    await waitFor(a.messages, 'welcome')

    const b = await openClient()
    b.ws.send(JSON.stringify({ type: 'join', callsign: 'CONO-B', aircraft: 'su27' }))
    await waitFor(b.messages, 'welcome')

    // B a ~100 m al norte de A
    b.ws.send(JSON.stringify({ type: 'pos', lat: MADRID.lat + 0.0009, lon: MADRID.lon }))
    // A mirando al norte: lo tiene de frente
    a.ws.send(JSON.stringify({ type: 'pos', lat: MADRID.lat, lon: MADRID.lon, heading: 0 }))

    const sinceStart = a.messages.length
    const sees = await waitForRadarSince(
      a.messages,
      sinceStart,
      m => m.contacts.some(c => c.callsign === 'CONO-B'),
    )
    expect(sees.contacts.find(c => c.callsign === 'CONO-B').visual).toBe(true)

    // A se gira 180 grados: el mismo contacto sigue en el radar pero ya no se ve
    const mark = a.messages.length
    a.ws.send(JSON.stringify({ type: 'pos', lat: MADRID.lat, lon: MADRID.lon, heading: 180 }))
    const blind = await waitForRadarSince(
      a.messages,
      mark,
      m => m.contacts.some(c => c.callsign === 'CONO-B' && c.visual === false),
    )
    expect(blind.contacts.find(c => c.callsign === 'CONO-B').visual).toBe(false)

    a.ws.close()
    b.ws.close()
  }, 20_000)
})
