/**
 * Reconexion con espera creciente.
 *
 * El caso real: el movil se queda sin cobertura un momento o el servidor se
 * reinicia mientras juegas. Sin reconexion hay que volver al lobby a mano, y
 * en las gafas eso significa sacarse el telefono del bolsillo y teclear el
 * indicativo otra vez. Aqui solo vive la *decision* de cuando reintentar; el
 * socket lo sigue llevando `NetClient`.
 */

export interface BackoffOptions {
  baseMs?: number
  capMs?: number
  /** 0..1. Se inyecta para poder testear sin depender de Math.random. */
  random?: () => number
}

const BASE_MS = 1000
const CAP_MS = 15_000
/** ±15 % de ruido: si el servidor cae, no todos los clientes vuelven a la vez. */
const JITTER_SPAN = 0.3
const JITTER_FLOOR = 1 - JITTER_SPAN / 2

/**
 * 1 s, 2 s, 4 s, 8 s, 15 s, 15 s… con ruido.
 *
 * Sin tope, un servidor caido durante una hora generaria esperas absurdas; sin
 * ruido, ocho moviles reintentarian sincronizados y caerian todos juntos otra
 * vez.
 */
export function backoffMs(attempt: number, options: BackoffOptions = {}): number {
  const base = options.baseMs ?? BASE_MS
  const cap = options.capMs ?? CAP_MS
  const random = options.random ?? Math.random
  const n = Math.max(0, Math.floor(attempt))
  const raw = Math.min(cap, base * 2 ** n)
  const jittered = raw * (JITTER_FLOOR + JITTER_SPAN * random())
  // El suelo de 1 ms se aplica DESPUES del tope: un `capMs` absurdo no debe
  // convertir la espera en un bucle cerrado de reintentos.
  return Math.max(1, Math.min(cap, Math.round(jittered)))
}

/** Lo justo de `setTimeout` para poder sustituirlo en los tests. */
export interface RetryTimer {
  set: (fn: () => void, ms: number) => unknown
  clear: (handle: unknown) => void
}

const systemTimer: RetryTimer = {
  set: (fn, ms) => setTimeout(fn, ms),
  clear: handle => clearTimeout(handle as ReturnType<typeof setTimeout>),
}

export class Reconnector {
  private handle: unknown = null
  private failures = 0
  private delay = 0

  constructor(
    private readonly retry: () => void,
    private readonly options: BackoffOptions & { timer?: RetryTimer } = {},
  ) {}

  private get timer(): RetryTimer {
    return this.options.timer ?? systemTimer
  }

  /** Fallos seguidos desde la ultima conexion buena. */
  get attempts(): number {
    return this.failures
  }

  /** Hay un reintento en cola. */
  get waiting(): boolean {
    return this.handle !== null
  }

  /** Espera del reintento que esta en cola (0 si no hay ninguno). */
  get pendingDelay(): number {
    return this.handle === null ? 0 : this.delay
  }

  /** Retardo que tocaria al siguiente fallo, sin programar nada. */
  nextDelay(): number {
    return backoffMs(this.failures, this.options)
  }

  /**
   * Tras una caida: programa el siguiente intento y devuelve la espera.
   * Devuelve -1 si ya habia uno en cola: `error` y `close` llegan seguidos y
   * no deben contarse como dos fallos.
   */
  dropped(): number {
    if (this.handle !== null) return -1
    const wait = this.nextDelay()
    this.failures += 1
    this.delay = wait
    this.handle = this.timer.set(() => {
      this.handle = null
      this.retry()
    }, wait)
    return wait
  }

  /** Conectado: se olvida el historial de fallos. */
  reset(): void {
    this.cancel()
    this.failures = 0
  }

  /** Cancela el reintento pendiente sin tocar el historial. */
  cancel(): void {
    if (this.handle === null) return
    this.timer.clear(this.handle)
    this.handle = null
  }
}
