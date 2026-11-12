// Actitud de la cabeza a partir del IMU de las gafas.
//
// El SDK entrega aceleraciones crudas (x, y, z) en `IMU_DATA_REPORT`. Usando la
// gravedad como referencia se obtiene el alabeo (roll) y el cabeceo (pitch),
// que es todo lo que necesita el horizonte artificial.
//
// Convenio de ejes asumido:
//   - z positivo apunta hacia arriba con la cabeza recta
//   - y positivo apunta al frente (morro)
//   - x positivo apunta a la derecha
// Si en la gafa real el eje sale invertido, se corrige con la calibracion sin
// tocar la matematica.

export interface ImuSample {
  x?: number
  y?: number
  z?: number
}

export interface Attitude {
  /** Alabeo en grados: positivo = inclinado a la derecha. */
  rollDeg: number
  /** Cabeceo en grados: positivo = mirando hacia arriba. */
  pitchDeg: number
}

export interface ImuCalibration {
  /** Invierte los tres ejes si la gafa monta el acelerometro al reves. */
  sign: 1 | -1
  /** Desfase de alabeo por montaje torcido de la montura. */
  rollOffsetDeg: number
  /** Desfase de cabeceo (mirar de pie no es mirar al horizonte). */
  pitchOffsetDeg: number
}

export const DEFAULT_CALIBRATION: ImuCalibration = {
  sign: 1,
  rollOffsetDeg: 0,
  pitchOffsetDeg: 0,
}

/** Por debajo de esto no hay gravedad reconocible: muestra invalida. */
const MIN_GRAVITY_G = 0.15
const RAD = Math.PI / 180

const clamp = (v: number, min: number, max: number) => Math.min(Math.max(v, min), max)

/** Normaliza a (-180, 180] para que alabeo y cabeceo comparen bien. */
export function wrapDeg(deg: number): number {
  const wrapped = (((deg + 180) % 360) + 360) % 360 - 180
  return wrapped === -180 ? 180 : wrapped
}

/**
 * Alabeo y cabeceo a partir de una muestra del acelerometro.
 * Devuelve `null` si la muestra no sirve (todo ceros o valores no finitos).
 */
export function attitudeFromImu(
  sample: ImuSample,
  calib: ImuCalibration = DEFAULT_CALIBRATION,
): Attitude | null {
  const { x = 0, y = 0, z = 0 } = sample
  const { sign } = calib
  const gx = x * sign
  const gy = y * sign
  const gz = z * sign

  const magnitude = Math.hypot(gx, gy, gz)
  if (!Number.isFinite(magnitude) || magnitude < MIN_GRAVITY_G) return null

  const roll = Math.atan2(gx, gz) / RAD + calib.rollOffsetDeg
  const pitch = Math.atan2(-gy, Math.hypot(gx, gz)) / RAD + calib.pitchOffsetDeg

  return { rollDeg: wrapDeg(roll), pitchDeg: clamp(pitch, -90, 90) }
}

/**
 * Media circular de dos angulos: 350 y 10 estan a 20 grados, no a 340.
 * Necesario para el alabeo, que salta de 180 a -180.
 */
export function blendAngles(from: number, to: number, weight: number): number {
  const a = from * RAD
  const b = to * RAD
  const x = Math.cos(a) * (1 - weight) + Math.cos(b) * weight
  const y = Math.sin(a) * (1 - weight) + Math.sin(b) * weight
  return wrapDeg(Math.atan2(y, x) / RAD)
}

/** Suaviza la actitud nueva contra la anterior para quitar el temblor del IMU. */
export function smoothAttitude(prev: Attitude | null, next: Attitude, weight = 0.35): Attitude {
  if (!prev) return next
  return {
    rollDeg: blendAngles(prev.rollDeg, next.rollDeg, weight),
    pitchDeg: prev.pitchDeg + (next.pitchDeg - prev.pitchDeg) * weight,
  }
}

/** true si el cambio merece repintar; evita reenviar tiles por simple ruido. */
export function attitudeChanged(
  prev: Attitude | null,
  next: Attitude,
  thresholdDeg = 2,
): boolean {
  if (!prev) return true
  // Estrictamente por encima: en el umbral exacto no merece la pena repintar.
  if (Math.abs(wrapDeg(next.rollDeg - prev.rollDeg)) > thresholdDeg) return true
  return Math.abs(next.pitchDeg - prev.pitchDeg) > thresholdDeg
}
