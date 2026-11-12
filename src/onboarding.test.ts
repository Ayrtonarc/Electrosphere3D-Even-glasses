import { describe, expect, it } from 'vitest'
import { completeTutorial, shouldShowTutorial, STEPS, TUTORIAL_KEY } from './onboarding'
import type { StorageLike } from './storage'

function fakeStorage(init: Record<string, string> = {}) {
  const data = { ...init }
  return {
    data,
    getItem: (key: string) => data[key] ?? null,
    setItem: (key: string, value: string) => {
      data[key] = value
    },
  }
}

describe('STEPS', () => {
  it('son cuatro y con identificadores únicos', () => {
    expect(STEPS).toHaveLength(4)
    expect(new Set(STEPS.map(s => s.id)).size).toBe(4)
  })

  it('todos tienen título y texto', () => {
    for (const step of STEPS) {
      expect(step.title.length).toBeGreaterThan(3)
      expect(step.body.length).toBeGreaterThan(20)
    }
  })

  it('el último enseña los cuatro gestos', () => {
    const gestos = STEPS.at(-1)
    expect(gestos?.rows?.map(r => r.glyph)).toEqual(['tap', 'scroll', 'long', 'double'])
    // Cada gesto tiene que decir qué hace, no solo cómo se llama.
    for (const row of gestos?.rows ?? []) {
      expect(row.label).toBeTruthy()
      expect(row.hint.length).toBeGreaterThan(5)
    }
  })

  it('los tres primeros traen dibujo y el de gestos no', () => {
    expect(STEPS.slice(0, 3).every(s => s.icon)).toBe(true)
    expect(STEPS.at(-1)?.icon).toBeUndefined()
  })
})

describe('shouldShowTutorial', () => {
  it('se muestra la primera vez', () => {
    expect(shouldShowTutorial(fakeStorage())).toBe(true)
  })

  it('no se repite una vez terminado', () => {
    const storage = fakeStorage()
    completeTutorial(storage)
    expect(storage.data[TUTORIAL_KEY]).toBe('done')
    expect(shouldShowTutorial(storage)).toBe(false)
  })

  it('sin almacenamiento se muestra igual y no rompe', () => {
    expect(shouldShowTutorial(undefined)).toBe(true)
    expect(() => completeTutorial(undefined)).not.toThrow()
  })

  it('un almacenamiento que lanza no bloquea la entrada', () => {
    const angry: StorageLike = {
      getItem: () => {
        throw new Error('bloqueado')
      },
      setItem: () => {
        throw new Error('bloqueado')
      },
    }
    expect(shouldShowTutorial(angry)).toBe(true)
    expect(() => completeTutorial(angry)).not.toThrow()
  })
})
