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
})
