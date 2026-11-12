/**
 * Screen Wake Lock.
 *
 * Sin la pantalla encendida el navegador congela la geolocalizacion y el
 * jugador deja de mandar posicion: desaparece del radar de los demas sin que
 * nadie se entere. Se pide el bloqueo al conectar y se suelta al desconectar.
 *
 * Detalle incomodo: el navegador suelta el bloqueo el solo cuando la pestana
 * pasa a segundo plano, asi que `wanted` se guarda aparte para poder volver a
 * pedirlo al regresar.
 */

export interface WakeSentinel {
  readonly released: boolean
  release(): Promise<void>
  addEventListener?(type: 'release', listener: () => void): void
}

export interface WakeLockEnv {
  readonly supported: boolean
  request(): Promise<WakeSentinel>
}

export interface NavigatorLike {
  wakeLock?: { request(type?: 'screen'): Promise<WakeSentinel> }
}

export function browserWakeLock(
  nav: NavigatorLike | undefined = globalThis.navigator as NavigatorLike | undefined,
): WakeLockEnv {
  const api = nav?.wakeLock
  return {
    supported: typeof api?.request === 'function',
    request: () =>
      api ? api.request('screen') : Promise.reject(new Error('sin wake lock en este navegador')),
  }
}

export class ScreenWakeLock {
  private sentinel: WakeSentinel | null = null
  private inFlight: Promise<boolean> | null = null
  private wanted = false

  constructor(private readonly env: WakeLockEnv) {}

  get supported(): boolean {
    return this.env.supported
  }

  /** Se ha pedido y el navegador todavia no lo ha soltado. */
  get active(): boolean {
    return this.wanted && this.sentinel !== null && !this.sentinel.released
  }

  /** Idempotente: dos llamadas seguidas comparten la misma peticion. */
  acquire(): Promise<boolean> {
    this.wanted = true
    if (!this.env.supported) return Promise.resolve(false)
    if (this.inFlight) return this.inFlight
    if (this.sentinel && !this.sentinel.released) return Promise.resolve(true)

    const pending = this.env.request().then(
      sentinel => {
        this.sentinel = sentinel
        sentinel.addEventListener?.('release', () => {
          if (this.sentinel === sentinel) this.sentinel = null
        })
        return true
      },
      // Sin permiso o sin bateria: se juega igual, solo que la pantalla se apaga.
      () => false,
    )

    this.inFlight = pending
    void pending.finally(() => {
      if (this.inFlight === pending) this.inFlight = null
    })
    return pending
  }

  async release(): Promise<void> {
    this.wanted = false
    const sentinel = this.sentinel
    this.sentinel = null
    if (!sentinel || sentinel.released) return
    try {
      await sentinel.release()
    } catch {
      /* el navegador ya lo habia soltado por su cuenta */
    }
  }

  /**
   * Al ocultar la pestana el navegador suelta el bloqueo; al volver se vuelve
   * a pedir, pero solo si el jugador sigue en vuelo.
   */
  onVisibility(state: 'visible' | 'hidden'): Promise<boolean> {
    if (state === 'hidden' || !this.wanted) return Promise.resolve(false)
    return this.acquire()
  }
}
