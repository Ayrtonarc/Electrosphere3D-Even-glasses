// Fuente de posicion del jugador.
//
// Las gafas G2 no tienen GPS: la posicion viene del telefono a traves de la
// app companion, asi que se pide por el bridge. En el simulador (o sin
// permisos) devuelve null, y entonces caemos a una posicion fija para poder
// probar el juego.

import { AppLocationAccuracy, type AppLocation, type EvenAppBridge } from '@evenrealities/even_hub_sdk'

export interface Fix {
  lat: number
  lon: number
  accuracy?: number
  /** Altitud sobre el nivel del mar en metros, si el GPS la da. */
  altitudeM?: number
  /** Rumbo sobre el terreno que ya calcula el GPS (0-360). */
  headingDeg?: number
  /** true si es la posicion de respaldo (simulador / sin GPS). */
  simulated: boolean
  updatedAt: number
}

/** Retiro, Madrid. Solo se usa cuando no hay GPS real. */
const FALLBACK = { lat: 40.4155, lon: -3.6844, altitudeM: 650 }

const POLL_MS = 5000
const FALLBACK_AFTER_MS = 8000

function usable(loc: AppLocation | null): loc is AppLocation {
  return !!loc && typeof loc.latitude === 'number' && typeof loc.longitude === 'number' &&
    !(loc.latitude === 0 && loc.longitude === 0)
}

export interface StartLocationOptions {
  /**
   * Usar una posicion de respaldo si el GPS no responde. Solo para desarrollo:
   * en produccion todos los jugadores sin senal acabarian apilados en el mismo
   * punto y se bloquearian entre ellos.
   */
  allowFallback?: boolean
}

export function startLocation(
  bridge: EvenAppBridge,
  onFix: (fix: Fix) => void,
  options: StartLocationOptions = {},
): () => void {
  let hasReal = false

  const apply = (loc: AppLocation | null) => {
    if (!usable(loc)) return
    hasReal = true
    onFix({
      lat: loc.latitude,
      lon: loc.longitude,
      accuracy: loc.accuracy,
      altitudeM: loc.altitude,
      headingDeg: loc.heading,
      simulated: false,
      updatedAt: Date.now(),
    })
  }

  const unsubscribe = bridge.onAppLocationChanged(apply)

  bridge.getAppLocation({ accuracy: AppLocationAccuracy.High }).then(apply).catch(() => {})

  const poll = setInterval(() => {
    bridge.getAppLocation().then(apply).catch(() => {})
  }, POLL_MS)

  const fallback = options.allowFallback
    ? setTimeout(() => {
        if (hasReal) return
        onFix({ ...FALLBACK, simulated: true, updatedAt: Date.now() })
      }, FALLBACK_AFTER_MS)
    : null

  return () => {
    unsubscribe()
    clearInterval(poll)
    if (fallback) clearTimeout(fallback)
  }
}
