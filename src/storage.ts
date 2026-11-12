/**
 * Acceso seguro a `localStorage`.
 *
 * Tocarlo puede lanzar (Safari en modo privado, cookies bloqueadas), asi que en
 * vez de envolver cada uso en try/catch se resuelve una vez. Quien lo recibe
 * sigue teniendo que tolerar que `setItem` falle: aqui solo se comprueba que
 * exista, no que funcione.
 */

export interface StorageLike {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

export function browserStorage(
  nav: { localStorage?: StorageLike } | undefined = globalThis as {
    localStorage?: StorageLike
  },
): StorageLike | undefined {
  try {
    return nav?.localStorage
  } catch {
    return undefined
  }
}
