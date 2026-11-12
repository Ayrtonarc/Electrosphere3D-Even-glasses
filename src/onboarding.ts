/**
 * Tutorial de entrada.
 *
 * Cuatro pasos y ni uno mas. La tentacion es explicar el juego entero, pero el
 * tutorial solo tiene que resolver lo que el jugador NO puede descubrir solo:
 * que el movil es el radar, que se gana por puntos y, sobre todo, los cuatro
 * gestos del tactil de la patilla, que no se ven en ninguna parte.
 *
 * El texto vive aqui (y no en el HTML) para poder testearlo y para que el
 * movil no tenga dos copias que se desincronicen.
 */

import type { StorageLike } from './storage'

export type TutorialGlyph = 'tap' | 'scroll' | 'long' | 'double'
export type TutorialIcon = 'cockpit' | 'target' | 'lock'

export interface TutorialRow {
  glyph: TutorialGlyph
  label: string
  hint: string
}

export interface TutorialStep {
  id: string
  title: string
  body: string
  /** Dibujo grande del paso. */
  icon?: TutorialIcon
  /** O una lista de gestos con su glifo. */
  rows?: TutorialRow[]
}

export const STEPS: TutorialStep[] = [
  {
    id: 'que-es',
    title: 'Esto es Aeronet',
    body: 'El movil es tu radar y las gafas, tu cabina. Te mueves tu: la posicion la pone el GPS, y hacia donde miras importa.',
    icon: 'cockpit',
  },
  {
    id: 'ganar',
    title: 'Gana quien suma mas',
    body: 'Cinco minutos por ronda. Cada derribo son 100 puntos; morir resta y te deja diez segundos fuera.',
    icon: 'target',
  },
  {
    id: 'bloqueo',
    title: 'Se derriba encarando',
    body: 'Mira al contacto y manten el bloqueo sin perderlo de vista. Cada avion tarda lo suyo: de 10 a 18 segundos.',
    icon: 'lock',
  },
  {
    id: 'gestos',
    title: 'Cuatro gestos',
    body: 'En las gafas no hay botones: todo se hace en el tactil de la patilla derecha.',
    rows: [
      { glyph: 'tap', label: 'Tap', hint: 'radar y ficha del avion' },
      { glyph: 'scroll', label: 'Rueda', hint: 'elegir blanco; en la ficha, alcance' },
      { glyph: 'long', label: 'Pulsacion larga', hint: 'radar en silencio' },
      { glyph: 'double', label: 'Doble tap', hint: 'salir al movil' },
    ],
  },
]

export const TUTORIAL_KEY = 'aeronet:tutorial'

/** Se muestra mientras no se haya terminado. Un fallo de lectura no bloquea. */
export function shouldShowTutorial(storage: StorageLike | undefined): boolean {
  try {
    return storage?.getItem(TUTORIAL_KEY) !== 'done'
  } catch {
    return true
  }
}

export function completeTutorial(storage: StorageLike | undefined): void {
  try {
    storage?.setItem(TUTORIAL_KEY, 'done')
  } catch {
    /* modo privado: se ve el tutorial cada vez, pero se puede jugar igual */
  }
}
