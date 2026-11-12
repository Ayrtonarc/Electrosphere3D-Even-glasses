import type { AircraftId, ConnState, RadarState } from './types'

export interface JoinInfo {
  callsign: string
  aircraft: AircraftId
}

type Msg =
  | { type: 'welcome'; id: string; tickMs: number }
  | RadarState & { type: 'radar' }
  | { type: 'error'; message: string }

/** Cliente WebSocket minimo para el juego. Sin reconexion automatica en el MVP. */
export class NetClient {
  private ws: WebSocket | null = null

  onState: (state: ConnState, detail?: string) => void = () => {}
  onRadar: (radar: RadarState) => void = () => {}

  get connected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN
  }

  connect(url: string, join: JoinInfo): void {
    this.disconnect()
    this.onState('connecting')

    let ws: WebSocket
    try {
      ws = new WebSocket(url)
    } catch {
      this.onState('error', 'URL invalida')
      return
    }
    this.ws = ws

    ws.onopen = () => {
      ws.send(JSON.stringify({ type: 'join', ...join }))
      this.onState('open')
    }

    ws.onmessage = (ev: MessageEvent<string>) => {
      let msg: Msg
      try {
        msg = JSON.parse(ev.data) as Msg
      } catch {
        return
      }
      if (msg.type === 'radar') this.onRadar(msg)
      else if (msg.type === 'error') this.onState('error', msg.message)
    }

    ws.onerror = () => this.onState('error', 'no se pudo conectar')
    ws.onclose = () => {
      if (this.ws === ws) this.ws = null
      this.onState('closed')
    }
  }

  sendPos(lat: number, lon: number): void {
    if (!this.connected) return
    this.ws!.send(JSON.stringify({ type: 'pos', lat, lon }))
  }

  disconnect(): void {
    const ws = this.ws
    this.ws = null
    if (ws) {
      ws.onclose = null
      ws.close()
    }
  }
}
