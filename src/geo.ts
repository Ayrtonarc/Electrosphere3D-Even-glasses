const EARTH_KM = 6371

const toRad = (deg: number) => (deg * Math.PI) / 180
const toDeg = (rad: number) => (rad * 180) / Math.PI

export interface LatLon {
  lat: number
  lon: number
}

/** Distancia ortodromica (haversine) en kilometros. */
export function distanceKm(a: LatLon, b: LatLon): number {
  const dLat = toRad(b.lat - a.lat)
  const dLon = toRad(b.lon - a.lon)
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2
  return 2 * EARTH_KM * Math.asin(Math.min(1, Math.sqrt(h)))
}

/** Rumbo inicial de A hacia B, 0..360 grados (0 = norte). */
export function bearingDeg(a: LatLon, b: LatLon): number {
  const dLon = toRad(b.lon - a.lon)
  const y = Math.sin(dLon) * Math.cos(toRad(b.lat))
  const x =
    Math.cos(toRad(a.lat)) * Math.sin(toRad(b.lat)) -
    Math.sin(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.cos(dLon)
  return (toDeg(Math.atan2(y, x)) + 360) % 360
}

/** Punto a `distKm` y `bearing` desde el origen. */
export function offsetLatLon(
  lat: number,
  lon: number,
  distKm: number,
  bearing: number,
): { lat: number; lon: number } {
  const d = distKm / EARTH_KM
  const br = toRad(bearing)
  const lat1 = toRad(lat)
  const lon1 = toRad(lon)
  const lat2 = Math.asin(Math.sin(lat1) * Math.cos(d) + Math.cos(lat1) * Math.sin(d) * Math.cos(br))
  const lon2 =
    lon1 +
    Math.atan2(Math.sin(br) * Math.sin(d) * Math.cos(lat1), Math.cos(d) - Math.sin(lat1) * Math.sin(lat2))
  return { lat: toDeg(lat2), lon: ((toDeg(lon2) + 540) % 360) - 180 }
}

/** Alcance de deteccion en km: observer -> target, segun ecuacion radar simplificada. */
export function detectRangeKm(
  observerRadar: number,
  targetRcs: number,
  baseKm: number,
  floorKm = 0,
): number {
  return Math.max(floorKm, baseKm * observerRadar * Math.pow(Math.max(targetRcs, 1e-6), 0.25))
}

/** Distancia corta y legible: 420 m / 1.2 km. */
export function formatKm(km: number): string {
  if (km < 1) return `${Math.round(km * 1000)} m`
  return `${km.toFixed(1)} km`
}
