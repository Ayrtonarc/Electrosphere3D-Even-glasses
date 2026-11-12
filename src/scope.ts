// Dibujo del radar de las gafas.
//
// El display admite un contenedor de imagen (max 288x144) que se actualiza con
// `updateImageRawData`. Se dibuja aqui en un canvas y se envia como PNG: el SDK
// lo decodifica, lo escala y lo convierte a los 16 verdes del panel.

export interface ScopeBlip {
  distKm: number
  bearingDeg: number
  stale: boolean
  locked: boolean
}

export const SCOPE_W = 200
export const SCOPE_H = 144

/**
 * Distancia y rumbo a coordenadas del radar, con el centro en (0,0).
 * Norte arriba: un blanco al norte queda por encima del centro.
 */
export function plotXY(
  distKm: number,
  bearingDeg: number,
  rangeKm: number,
  radiusPx: number,
): { x: number; y: number } {
  const ratio = rangeKm > 0 ? Math.min(Math.max(distKm, 0) / rangeKm, 1) : 0
  const angle = (bearingDeg * Math.PI) / 180
  const x = Math.sin(angle) * radiusPx * ratio
  const y = -Math.cos(angle) * radiusPx * ratio
  // evita -0 en los ejes, que complica comparaciones
  return { x: x === 0 ? 0 : x, y: y === 0 ? 0 : y }
}

function drawAircraft(ctx: CanvasRenderingContext2D, cx: number, cy: number, scale: number): void {
  // Silueta de caza vista desde arriba, morro hacia el norte.
  const s = scale / 9
  ctx.beginPath()
  ctx.moveTo(cx, cy - 9 * s)
  ctx.lineTo(cx + 2 * s, cy - 2 * s)
  ctx.lineTo(cx + 9 * s, cy + 3 * s)
  ctx.lineTo(cx + 9 * s, cy + 5 * s)
  ctx.lineTo(cx + 2 * s, cy + 4 * s)
  ctx.lineTo(cx + 1.5 * s, cy + 8 * s)
  ctx.lineTo(cx - 1.5 * s, cy + 8 * s)
  ctx.lineTo(cx - 2 * s, cy + 4 * s)
  ctx.lineTo(cx - 9 * s, cy + 5 * s)
  ctx.lineTo(cx - 9 * s, cy + 3 * s)
  ctx.lineTo(cx - 2 * s, cy - 2 * s)
  ctx.closePath()
  ctx.fillStyle = 'rgba(255,255,255,0.95)'
  ctx.fill()
}

function canvasToPng(canvas: HTMLCanvasElement): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const toArray = async (blob: Blob) => resolve(new Uint8Array(await blob.arrayBuffer()))
    if (typeof canvas.toBlob === 'function') {
      canvas.toBlob(blob => (blob ? toArray(blob) : reject(new Error('toBlob vacio'))), 'image/png')
      return
    }
    try {
      const base64 = canvas.toDataURL('image/png').split(',')[1] ?? ''
      const binary = atob(base64)
      const bytes = new Uint8Array(binary.length)
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
      resolve(bytes)
    } catch (err) {
      reject(err)
    }
  })
}

/** Dibuja la pantalla radar y devuelve los bytes PNG listos para el bridge. */
export async function renderScopePng(blips: ScopeBlip[], rangeKm: number): Promise<Uint8Array> {
  const canvas = document.createElement('canvas')
  canvas.width = SCOPE_W
  canvas.height = SCOPE_H
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('canvas 2d no disponible')

  ctx.fillStyle = '#000000'
  ctx.fillRect(0, 0, SCOPE_W, SCOPE_H)

  const cx = SCOPE_W / 2
  const cy = SCOPE_H / 2 + 4
  const radius = 56

  // anillos de alcance
  ctx.lineWidth = 1
  for (const frac of [1 / 3, 2 / 3, 1]) {
    ctx.strokeStyle = frac === 1 ? 'rgba(255,255,255,0.55)' : 'rgba(255,255,255,0.22)'
    ctx.beginPath()
    ctx.arc(cx, cy, radius * frac, 0, Math.PI * 2)
    ctx.stroke()
  }

  // ejes y marcas cardinales
  ctx.strokeStyle = 'rgba(255,255,255,0.22)'
  ctx.beginPath()
  ctx.moveTo(cx, cy - radius)
  ctx.lineTo(cx, cy + radius)
  ctx.moveTo(cx - radius, cy)
  ctx.lineTo(cx + radius, cy)
  ctx.stroke()

  ctx.strokeStyle = 'rgba(255,255,255,0.75)'
  ctx.beginPath()
  ctx.moveTo(cx, cy - radius)
  ctx.lineTo(cx, cy - radius + 5)
  ctx.stroke()

  // tu aeronave
  drawAircraft(ctx, cx, cy, 9)

  // contactos
  for (const blip of blips) {
    const { x, y } = plotXY(blip.distKm, blip.bearingDeg, rangeKm, radius)
    const px = cx + x
    const py = cy + y

    if (blip.locked) {
      ctx.strokeStyle = 'rgba(255,255,255,0.9)'
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.arc(px, py, 5, 0, Math.PI * 2)
      ctx.stroke()
    }

    ctx.fillStyle = blip.stale ? 'rgba(255,255,255,0.35)' : 'rgba(255,255,255,1)'
    ctx.beginPath()
    ctx.arc(px, py, blip.stale ? 1.6 : 2.6, 0, Math.PI * 2)
    ctx.fill()
  }

  return canvasToPng(canvas)
}
