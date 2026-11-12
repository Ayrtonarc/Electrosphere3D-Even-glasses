import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { NetClient } from './net'
import type { ConnState, RadarState } from './types'

class FakeWebSocket {
  static readonly CONNECTING = 0
  static readonly OPEN = 1
  static readonly CLOSING = 2
  static readonly CLOSED = 3
  static instances: FakeWebSocket[] = []

  readyState = FakeWebSocket.CONNECTING
  sent: string[] = []
  url: string
  onopen: (() => void) | null = null
  onmessage: ((event: { data: string }) => void) | null = null
  onerror: (() => void) | null = null
  onclose: (() => void) | null = null

  constructor(url: string) {
    if (url.includes('invalida')) throw new Error('url invalida')
    this.url = url
    FakeWebSocket.instances.push(this)
  }

  send(data: string): void {
    if (this.readyState !== FakeWebSocket.OPEN) throw new Error('socket cerrado')
    this.sent.push(data)
  }

  close(): void {
    this.readyState = FakeWebSocket.CLOSED
    this.onclose?.()
  }

  // ayudantes del propio test
  open(): void {
    this.readyState = FakeWebSocket.OPEN
    this.onopen?.()
  }

  receive(payload: unknown): void {
    this.onmessage?.({ data: typeof payload === 'string' ? payload : JSON.stringify(payload) })
  }

  fail(): void {
    this.onerror?.()
  }
}

const originalWebSocket = globalThis.WebSocket

function lastSocket(): FakeWebSocket {
  return FakeWebSocket.instances[FakeWebSocket.instances.length - 1]
}

function radarPayload(over: Partial<RadarState> = {}): RadarState {
  return {
    t: 1,
    phase: 'flying',
    remainingMs: 240_000,
    contacts: [
      { id: 'bot-1', callsign: 'FLANKER-1', aircraft: 'su27', distKm: 0.22, bearingDeg: 30, kind: 'bot', visual: true },
    ],
    you: { callsign: 'VIPER-1', aircraft: 'f35', lat: 40.4, lon: -3.7 },
    rangeKm: 0.48,
    lock: { callsign: 'FLANKER-1', aircraft: 'su27', ms: 3000, needMs: 18000 },
    lockedBy: null,
    result: null,
    ...over,
  }
}

function setup() {
  const net = new NetClient()
  const states: ConnState[] = []
  const details: (string | undefined)[] = []
  const radars: RadarState[] = []
  net.onState = (state, detail) => {
    states.push(state)
    details.push(detail)
  }
  net.onRadar = radar => radars.push(radar)
  return { net, states, details, radars }
}

describe('NetClient', () => {
  beforeEach(() => {
    FakeWebSocket.instances.length = 0
    globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket
  })

  afterEach(() => {
    globalThis.WebSocket = originalWebSocket
  })

  it('al abrir manda el join y avisa de conexion', () => {
    const { net, states } = setup()
    net.connect('ws://test:8787', { callsign: 'VIPER-1', aircraft: 'f35' })
    const socket = lastSocket()

    expect(states).toEqual(['connecting'])
    socket.open()

    expect(states).toEqual(['connecting', 'open'])
    expect(JSON.parse(socket.sent[0])).toEqual({ type: 'join', callsign: 'VIPER-1', aircraft: 'f35' })
  })

  it('entrega el radar tal cual llega', () => {
    const { net, radars } = setup()
    net.connect('ws://test', { callsign: 'A', aircraft: 'su27' })
    const socket = lastSocket()
    socket.open()

    socket.receive({ type: 'radar', ...radarPayload() })

    expect(radars).toHaveLength(1)
    expect(radars[0]).toMatchObject({ phase: 'flying', rangeKm: 0.48 })
    expect(radars[0].contacts[0].callsign).toBe('FLANKER-1')
  })

  it('ignora mensajes que no son JSON', () => {
    const { net, radars, states } = setup()
    net.connect('ws://test', { callsign: 'A', aircraft: 'su27' })
    const socket = lastSocket()
    socket.open()

    expect(() => socket.receive('esto no es json')).not.toThrow()
    expect(radars).toHaveLength(0)
    expect(states).toEqual(['connecting', 'open'])
  })

  it('propaga el error del servidor', () => {
    const { net, states, details } = setup()
    net.connect('ws://test', { callsign: 'A', aircraft: 'su27' })
    const socket = lastSocket()
    socket.open()

    socket.receive({ type: 'error', message: 'sala llena' })

    expect(states.at(-1)).toBe('error')
    expect(details.at(-1)).toBe('sala llena')
  })

  it('no manda posiciones antes de abrir', () => {
    const { net } = setup()
    net.connect('ws://test', { callsign: 'A', aircraft: 'su27' })
    const socket = lastSocket()

    net.sendPos(40.4, -3.7)
    expect(net.connected).toBe(false)
    expect(socket.sent).toHaveLength(0)
  })

  it('manda la posicion cuando esta abierto', () => {
    const { net } = setup()
    net.connect('ws://test', { callsign: 'A', aircraft: 'su27' })
    const socket = lastSocket()
    socket.open()

    net.sendPos(40.4, -3.7)

    expect(net.connected).toBe(true)
    expect(JSON.parse(socket.sent.at(-1)!)).toEqual({ type: 'pos', lat: 40.4, lon: -3.7 })
  })

  it('adjunta la altitud cuando se la dan', () => {
    const { net } = setup()
    net.connect('ws://test', { callsign: 'A', aircraft: 'su27' })
    const socket = lastSocket()
    socket.open()

    net.sendPos(40.4, -3.7, 652.4)

    expect(JSON.parse(socket.sent.at(-1)!)).toEqual({
      type: 'pos',
      lat: 40.4,
      lon: -3.7,
      alt: 652.4,
    })
  })

  it('manda el estado del radar', () => {
    const { net } = setup()
    net.connect('ws://test', { callsign: 'A', aircraft: 'su27' })
    const socket = lastSocket()
    socket.open()

    net.sendEmission(false)

    expect(JSON.parse(socket.sent.at(-1)!)).toEqual({ type: 'emission', on: false })
  })

  it('manda el blanco elegido y el automatico', () => {
    const { net } = setup()
    net.connect('ws://test', { callsign: 'A', aircraft: 'su27' })
    const socket = lastSocket()
    socket.open()

    net.sendTarget('bot-1')
    expect(JSON.parse(socket.sent.at(-1)!)).toEqual({ type: 'target', id: 'bot-1' })

    net.sendTarget(null)
    expect(JSON.parse(socket.sent.at(-1)!)).toEqual({ type: 'target', id: null })
  })

  it('no manda nada del juego si el socket no esta abierto', () => {
    const { net } = setup()
    net.connect('ws://test', { callsign: 'A', aircraft: 'su27' })
    const socket = lastSocket()

    net.sendEmission(false)
    net.sendTarget('bot-1')

    expect(socket.sent).toHaveLength(0)
  })

  it('desconectar cierra sin avisar de cierre', () => {
    const { net, states } = setup()
    net.connect('ws://test', { callsign: 'A', aircraft: 'su27' })
    const socket = lastSocket()
    socket.open()

    net.disconnect()

    expect(socket.readyState).toBe(FakeWebSocket.CLOSED)
    expect(states).toEqual(['connecting', 'open'])
    expect(net.connected).toBe(false)
  })

  it('una URL invalida termina en error', () => {
    const { net, states } = setup()
    net.connect('ws://invalida', { callsign: 'A', aircraft: 'su27' })
    expect(states).toEqual(['connecting', 'error'])
  })

  it('un fallo de socket se reporta como error', () => {
    const { net, states } = setup()
    net.connect('ws://test', { callsign: 'A', aircraft: 'su27' })
    lastSocket().fail()
    expect(states.at(-1)).toBe('error')
  })

  it('reconectar sustituye el socket anterior', () => {
    const { net } = setup()
    net.connect('ws://uno', { callsign: 'A', aircraft: 'su27' })
    const primero = lastSocket()
    primero.open()

    net.connect('ws://dos', { callsign: 'A', aircraft: 'su27' })
    const segundo = lastSocket()

    expect(segundo).not.toBe(primero)
    expect(primero.readyState).toBe(FakeWebSocket.CLOSED)
    expect(segundo.url).toBe('ws://dos')
  })
})
