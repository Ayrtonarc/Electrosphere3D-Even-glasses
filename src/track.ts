import { PING_MEMORY_MS, TICK_MS, type Contact } from './types'

export interface TrackedContact extends Contact {
  /** Milisegundos desde el ultimo ping real. */
  ageMs: number
  /** true si ya no lo ves: solo queda la ultima posicion conocida. */
  stale: boolean
}

/**
 * Memoria de pings del radar.
 *
 * El servidor solo manda lo que ves AHORA. Esta capa guarda la ultima posicion
 * conocida de cada contacto y la deja envejecer: eso convierte una lista de
 * contactos en un mapa mental, que es donde vive el juego.
 */
export class TrackMemory {
  private seen = new Map<string, { contact: Contact; at: number }>()

  update(contacts: Contact[], now = performance.now()): void {
    for (const contact of contacts) this.seen.set(contact.id, { contact, at: now })
    for (const [id, entry] of this.seen) {
      if (now - entry.at > PING_MEMORY_MS) this.seen.delete(id)
    }
  }

  list(now = performance.now()): TrackedContact[] {
    const out: TrackedContact[] = []
    for (const { contact, at } of this.seen.values()) {
      const ageMs = now - at
      out.push({ ...contact, ageMs, stale: ageMs > TICK_MS + 700 })
    }
    out.sort((a, b) => Number(a.stale) - Number(b.stale) || a.distKm - b.distKm)
    return out
  }

  clear(): void {
    this.seen.clear()
  }
}
