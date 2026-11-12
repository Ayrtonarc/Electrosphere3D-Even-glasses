import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AppLocation, EvenAppBridge } from '@evenrealities/even_hub_sdk'
import { startLocation, type Fix } from './location'

const FALLBACK_AFTER_MS = 8000
const POLL_MS = 5000

type Listener = (location: AppLocation) => void

function fakeBridge(location: AppLocation | null) {
  const listeners: Listener[] = []
  const unsubscribe = vi.fn(() => {
    listeners.length = 0
  })
  const bridge = {
    getAppLocation: vi.fn(async () => location),
    onAppLocationChanged: vi.fn((cb: Listener) => {
      listeners.push(cb)
      return unsubscribe
    }),
  }
  return { bridge: bridge as unknown as EvenAppBridge, listeners, unsubscribe, raw: bridge }
}

describe('startLocation', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('parte de la lectura inicial del bridge', async () => {
    const { bridge, raw } = fakeBridge({ latitude: 40.4, longitude: -3.7, accuracy: 12 })
    const fixes: Fix[] = []

    startLocation(bridge, fix => fixes.push(fix))
    await vi.advanceTimersByTimeAsync(0)

    expect(raw.getAppLocation).toHaveBeenCalled()
    expect(fixes).toHaveLength(1)
    expect(fixes[0]).toMatchObject({ lat: 40.4, lon: -3.7, accuracy: 12, simulated: false })
  })

  it('acepta las actualizaciones que llegan por el listener', async () => {
    const { bridge, listeners } = fakeBridge(null)
    const fixes: Fix[] = []

    startLocation(bridge, fix => fixes.push(fix))
    await vi.advanceTimersByTimeAsync(0)

    expect(listeners).toHaveLength(1)
    listeners[0]({ latitude: 41, longitude: -4 })
    expect(fixes.at(-1)).toMatchObject({ lat: 41, lon: -4, simulated: false })
  })

  it('ignora lecturas nulas o con 0,0', async () => {
    const { bridge } = fakeBridge(null)
    const fixes: Fix[] = []

    startLocation(bridge, fix => fixes.push(fix))
    await vi.advanceTimersByTimeAsync(0)
    expect(fixes).toHaveLength(0)

    const ceroCero = fakeBridge({ latitude: 0, longitude: 0 })
    startLocation(ceroCero.bridge, fix => fixes.push(fix))
    await vi.advanceTimersByTimeAsync(0)
    expect(fixes).toHaveLength(0)
  })

  it('cae a la posicion simulada si no hay GPS en 8 s', async () => {
    const { bridge } = fakeBridge(null)
    const fixes: Fix[] = []

    startLocation(bridge, fix => fixes.push(fix))
    await vi.advanceTimersByTimeAsync(FALLBACK_AFTER_MS - 1)
    expect(fixes).toHaveLength(0)

    await vi.advanceTimersByTimeAsync(1)
    expect(fixes).toHaveLength(1)
    expect(fixes[0]).toMatchObject({ simulated: true, lat: 40.4155, lon: -3.6844 })
  })

  it('no cae al respaldo si ya habia posicion real', async () => {
    const { bridge } = fakeBridge({ latitude: 40.4, longitude: -3.7 })
    const fixes: Fix[] = []

    startLocation(bridge, fix => fixes.push(fix))
    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(FALLBACK_AFTER_MS)

    expect(fixes.some(f => f.simulated)).toBe(false)
  })

  it('reintenta la lectura periodicamente', async () => {
    const { bridge, raw } = fakeBridge(null)
    startLocation(bridge, () => {})

    await vi.advanceTimersByTimeAsync(0)
    const inicial = raw.getAppLocation.mock.calls.length
    await vi.advanceTimersByTimeAsync(POLL_MS)
    expect(raw.getAppLocation.mock.calls.length).toBe(inicial + 1)
  })

  it('al limpiar cancela el listener y los temporizadores', async () => {
    const { bridge, unsubscribe } = fakeBridge(null)
    const fixes: Fix[] = []

    const stop = startLocation(bridge, fix => fixes.push(fix))
    await vi.advanceTimersByTimeAsync(0)
    stop()

    expect(unsubscribe).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(FALLBACK_AFTER_MS * 2)
    expect(fixes).toHaveLength(0)
  })
})
