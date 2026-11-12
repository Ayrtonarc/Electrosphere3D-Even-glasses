import { describe, expect, it } from 'vitest'
import { browserWakeLock, ScreenWakeLock } from './wakelock'

function fakeSentinel() {
  const listeners: (() => void)[] = []
  const state = { released: false, releases: 0 }
  const sentinel = {
    get released() {
      return state.released
    },
    get releases() {
      return state.releases
    },
    async release() {
      state.releases += 1
      state.released = true
      for (const fn of listeners) fn()
    },
    addEventListener(_type: 'release', listener: () => void) {
      listeners.push(listener)
    },
    /** Lo que hace el navegador al ocultar la pestana. */
    drop() {
      state.released = true
      for (const fn of listeners) fn()
    },
  }
  return sentinel
}

function env(over: { supported?: boolean; fail?: boolean } = {}) {
  const sentinels: ReturnType<typeof fakeSentinel>[] = []
  let requests = 0
  return {
    sentinels,
    get requests() {
      return requests
    },
    env: {
      supported: over.supported ?? true,
      request: () => {
        requests += 1
        if (over.fail) return Promise.reject(new Error('denegado'))
        const sentinel = fakeSentinel()
        sentinels.push(sentinel)
        return Promise.resolve(sentinel)
      },
    },
  }
}

describe('ScreenWakeLock', () => {
  it('sin soporte no pide nada y no rompe', async () => {
    const lock = new ScreenWakeLock(browserWakeLock({}))
    expect(lock.supported).toBe(false)
    await expect(lock.acquire()).resolves.toBe(false)
    expect(lock.active).toBe(false)
  })

  it('pide el bloqueo una sola vez aunque se llame dos veces', async () => {
    const fake = env()
    const lock = new ScreenWakeLock(fake.env)

    const [a, b] = await Promise.all([lock.acquire(), lock.acquire()])

    expect([a, b]).toEqual([true, true])
    expect(fake.requests).toBe(1)
    expect(lock.active).toBe(true)
  })

  it('si ya esta activo no vuelve a pedirlo', async () => {
    const fake = env()
    const lock = new ScreenWakeLock(fake.env)

    await lock.acquire()
    await lock.acquire()

    expect(fake.requests).toBe(1)
  })

  it('al desconectar suelta el bloqueo', async () => {
    const fake = env()
    const lock = new ScreenWakeLock(fake.env)
    await lock.acquire()

    await lock.release()

    expect(lock.active).toBe(false)
    expect(fake.sentinels[0].releases).toBe(1)
  })

  it('si el navegador lo suelta, deja de estar activo y se puede recuperar', async () => {
    const fake = env()
    const lock = new ScreenWakeLock(fake.env)
    await lock.acquire()

    fake.sentinels[0].drop()
    expect(lock.active).toBe(false)

    await expect(lock.onVisibility('visible')).resolves.toBe(true)
    expect(fake.requests).toBe(2)
    expect(lock.active).toBe(true)
  })

  it('al ocultar no pide nada', async () => {
    const fake = env()
    const lock = new ScreenWakeLock(fake.env)
    await lock.acquire()

    await expect(lock.onVisibility('hidden')).resolves.toBe(false)
    expect(fake.requests).toBe(1)
  })

  it('al volver sin ganas de bloquear no pide nada', async () => {
    const fake = env()
    const lock = new ScreenWakeLock(fake.env)

    await expect(lock.onVisibility('visible')).resolves.toBe(false)
    expect(fake.requests).toBe(0)
  })

  it('un permiso denegado no lanza y permite reintentar', async () => {
    let fail = true
    const sentinel = fakeSentinel()
    const lock = new ScreenWakeLock({
      supported: true,
      request: () => (fail ? Promise.reject(new Error('denegado')) : Promise.resolve(sentinel)),
    })

    await expect(lock.acquire()).resolves.toBe(false)
    expect(lock.active).toBe(false)

    fail = false
    await expect(lock.acquire()).resolves.toBe(true)
    expect(lock.active).toBe(true)
  })

  it('soltar dos veces solo llama a release una vez', async () => {
    const fake = env()
    const lock = new ScreenWakeLock(fake.env)
    await lock.acquire()

    await lock.release()
    await lock.release()

    expect(fake.sentinels[0].releases).toBe(1)
  })

  it('un release lento que falla no explota', async () => {
    const lock = new ScreenWakeLock({
      supported: true,
      request: () =>
        Promise.resolve({
          released: false,
          release: () => Promise.reject(new Error('ya no existe')),
        }),
    })
    await lock.acquire()

    await expect(lock.release()).resolves.toBeUndefined()
  })
})
