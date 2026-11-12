import { describe, expect, it } from 'vitest'
import {
  ALERT_GAP_MS,
  INFO_GAP_MS,
  MISSILE_VOICE_PERCENT,
  browserSpeaker,
  planRadio,
  Radio,
  snapshotOf,
  type RadioLine,
  type RadioSnapshot,
  type SpeechLike,
} from './radio'
import type { RadarState } from './types'
import type { TrackedContact } from './track'

function snap(over: Partial<RadioSnapshot> = {}): RadioSnapshot {
  return {
    phase: 'flying',
    me: 'VIPER-1',
    winner: null,
    rank: null,
    lockCallsign: null,
    lockPercent: 0,
    threatCallsign: null,
    threatPercent: 0,
    contacts: [],
    ...over,
  }
}

function contact(callsign: string, over: Partial<{ bearingDeg: number; distKm: number }> = {}) {
  return { callsign, aircraft: 'su27' as const, bearingDeg: 90, distKm: 0.22, ...over }
}

describe('planRadio · avisos', () => {
  it('el misil manda sobre todo lo demas', () => {
    const line = planRadio(
      snap({ threatCallsign: 'GHOST-1', threatPercent: 40 }),
      snap({ threatCallsign: 'GHOST-1', threatPercent: MISSILE_VOICE_PERCENT, lockCallsign: 'X' }),
    )
    expect(line).toMatchObject({ urgency: 'alert', key: 'missile' })
    expect(line?.text).toContain('Misil')
  })

  it('el misil no se repite en cada tick por encima del umbral', () => {
    const line = planRadio(
      snap({ threatCallsign: 'GHOST-1', threatPercent: 71 }),
      snap({ threatCallsign: 'GHOST-1', threatPercent: 80 }),
    )
    expect(line).toBeNull()
  })

  it('avisa cuando alguien te acaba de fijar', () => {
    const line = planRadio(snap(), snap({ threatCallsign: 'GHOST-1' }))
    expect(line).toEqual({
      text: 'GHOST-1 nos tiene fijados.',
      urgency: 'alert',
      key: 'threat:GHOST-1',
    })
  })

  it('el resultado habla antes que el contacto', () => {
    const line = planRadio(
      snap({ contacts: [contact('FLANKER-1')] }),
      snap({ phase: 'finished', winner: 'VIPER-1', contacts: [contact('FLANKER-1'), contact('X')] }),
    )
    expect(line?.key).toBe('result:win')
    expect(line?.text).toContain('Blanco derribado')
  })

  it('sabe perder sin dramatizar de mas', () => {
    const line = planRadio(snap(), snap({ phase: 'finished', winner: 'GHOST-1' }))
    expect(line?.urgency).toBe('alert')
    expect(line?.text).toContain('GHOST-1')
  })

  it('un empate es informativo, no un grito', () => {
    const line = planRadio(snap(), snap({ phase: 'finished', winner: null }))
    expect(line?.urgency).toBe('info')
  })
})

describe('planRadio · partida y bloqueo', () => {
  it('saluda al entrar en vuelo', () => {
    const line = planRadio(null, snap())
    expect(line?.key).toBe('match:first')
  })

  it('anuncia la partida nueva tras el marcador', () => {
    const line = planRadio(snap({ phase: 'finished' }), snap({ phase: 'flying' }))
    expect(line?.key).toBe('match:new')
  })

  it('canta el blanco al empezar a fijar', () => {
    const line = planRadio(snap(), snap({ lockCallsign: 'FLANKER-1', lockPercent: 10 }))
    expect(line).toEqual({ text: 'Fijando FLANKER-1.', urgency: 'info', key: 'lock:FLANKER-1' })
  })

  it('avisa al pasar del 50 %', () => {
    const line = planRadio(
      snap({ lockCallsign: 'FLANKER-1', lockPercent: 45 }),
      snap({ lockCallsign: 'FLANKER-1', lockPercent: 55 }),
    )
    expect(line?.key).toBe('half:FLANKER-1')
  })

  it('no repite el aviso del 50 % mientras siga por encima', () => {
    const line = planRadio(
      snap({ lockCallsign: 'FLANKER-1', lockPercent: 60 }),
      snap({ lockCallsign: 'FLANKER-1', lockPercent: 80 }),
    )
    expect(line).toBeNull()
  })
})

describe('planRadio · contactos', () => {
  it('canta el contacto nuevo con rumbo y distancia', () => {
    const line = planRadio(snap(), snap({ contacts: [contact('FLANKER-1', { bearingDeg: 7, distKm: 0.22 })] }))
    expect(line?.text).toBe('Su-27, 007, 220 metros.')
  })

  it('avisa de la perdida', () => {
    const line = planRadio(snap({ contacts: [contact('FLANKER-1')] }), snap())
    expect(line?.key).toBe('lost:FLANKER-1')
  })

  it('sin cambios no habla', () => {
    const only = [contact('FLANKER-1')]
    expect(planRadio(snap({ contacts: only }), snap({ contacts: only }))).toBeNull()
  })
})

describe('snapshotOf', () => {
  it('traduce el radar y descarta los pings viejos', () => {
    const radar: RadarState = {
      t: 0,
      phase: 'flying',
      remainingMs: 1000,
      contacts: [],
      you: { callsign: 'VIPER-1', aircraft: 'f35', lat: 0, lon: 0 },
      rangeKm: 0.4,
      lock: { callsign: 'FLANKER-1', aircraft: 'su27', ms: 9000, needMs: 18000 },
      lockedBy: 'GHOST-1',
      threat: { callsign: 'GHOST-1', percent: 66 },
      result: null,
    }
    const tracks = [
      { ...track('FLANKER-1'), stale: false },
      { ...track('GHOST-1'), stale: true },
    ]

    const shot = snapshotOf(radar, tracks)
    expect(shot.lockPercent).toBe(50)
    expect(shot.threatCallsign).toBe('GHOST-1')
    expect(shot.threatPercent).toBe(66)
    expect(shot.contacts.map(c => c.callsign)).toEqual(['FLANKER-1'])
  })

  it('sin radar no hay fase', () => {
    expect(snapshotOf(null, []).phase).toBeNull()
  })
})

function track(callsign: string): TrackedContact {
  return {
    id: callsign,
    callsign,
    aircraft: 'su27',
    distKm: 0.22,
    bearingDeg: 90,
    kind: 'human',
    visual: true,
    ageMs: 0,
    stale: false,
  }
}

function fakeSpeaker() {
  const said: RadioLine[] = []
  return {
    said,
    cancels: 0,
    say(line: RadioLine) {
      said.push(line)
    },
    cancel() {
      this.cancels += 1
    },
  }
}

describe('Radio', () => {
  it('respeta el hueco entre frases del mismo asunto', () => {
    const speaker = fakeSpeaker()
    const first = track('FLANKER-1')
    let t = 0
    const radio = new Radio(speaker, () => t)

    radio.update(radar([]), []) // saludo
    radio.update(radar([first]), [first]) // contacto cantado
    radio.update(radar([]), []) // y perdido
    expect(speaker.said.map(l => l.key)).toEqual([
      'match:first',
      'contact:FLANKER-1',
      'lost:FLANKER-1',
    ])

    // Aparece otra vez enseguida: misma clave dentro del hueco, no se repite.
    t = 1000
    radio.update(radar([first]), [first])
    expect(speaker.said).toHaveLength(3)

    // Pasado el hueco, la misma frase vuelve a sonar.
    t = INFO_GAP_MS
    radio.update(radar([]), [])
    expect(speaker.said.at(-1)?.key).toBe('lost:FLANKER-1')
    expect(speaker.said).toHaveLength(4)
  })

  it('los avisos tienen un hueco mucho mas corto', () => {
    const speaker = fakeSpeaker()
    let t = 0
    const radio = new Radio(speaker, () => t)

    radio.update(radar([], { lockedBy: 'GHOST-1', threat: { callsign: 'GHOST-1', percent: 20 } }), [])
    expect(speaker.said.at(-1)?.urgency).toBe('alert')

    t += ALERT_GAP_MS + 1
    radio.update(radar([], { threat: { callsign: 'GHOST-1', percent: 80 }, lockedBy: 'GHOST-1' }), [])
    expect(speaker.said.at(-1)?.key).toBe('missile')
  })

  it('en silencio no habla, pero no se pierde el contexto', () => {
    const speaker = fakeSpeaker()
    const radio = new Radio(speaker, () => 0)
    radio.setEnabled(false)

    radio.update(radar([track('FLANKER-1')]), [track('FLANKER-1')])
    expect(speaker.said).toHaveLength(0)

    // Al reactivar no suelta de golpe lo que paso mientras estaba muda.
    radio.setEnabled(true)
    radio.update(radar([track('FLANKER-1')]), [track('FLANKER-1')])
    expect(speaker.said).toHaveLength(0)
  })

  it('reset corta la locucion y olvida la foto anterior', () => {
    const speaker = fakeSpeaker()
    const radio = new Radio(speaker, () => 0)
    radio.update(radar([track('FLANKER-1')]), [track('FLANKER-1')])
    expect(speaker.said).toHaveLength(1)

    radio.reset()
    expect(speaker.cancels).toBe(1)

    radio.update(radar([track('FLANKER-1')]), [track('FLANKER-1')])
    expect(speaker.said.at(-1)?.key).toBe('match:first')
  })
})

function radar(tracks: TrackedContact[], over: Partial<RadarState> = {}): RadarState {
  return {
    t: 0,
    phase: 'flying',
    remainingMs: 200_000,
    contacts: tracks,
    you: { callsign: 'VIPER-1', aircraft: 'f35', lat: 0, lon: 0 },
    rangeKm: 0.48,
    lock: null,
    lockedBy: null,
    threat: null,
    result: null,
    ...over,
  }
}

describe('browserSpeaker', () => {
  function fakeSynth(over: Partial<SpeechLike> = {}) {
    const spoken: string[] = []
    const synth = {
      speaking: false,
      cancels: 0,
      cancel() {
        synth.cancels += 1
      },
      speak(utterance: SpeechSynthesisUtterance) {
        spoken.push(utterance.text)
      },
      ...over,
    }
    return { synth, spoken }
  }

  const make = (text: string) => ({ text }) as unknown as SpeechSynthesisUtterance

  it('un aviso interrumpe lo que este sonando', () => {
    const { synth, spoken } = fakeSynth()
    const speaker = browserSpeaker(synth, make)

    speaker.say({ text: 'Misil entrante.', urgency: 'alert', key: 'missile' })

    expect(synth.cancels).toBe(1)
    expect(spoken).toEqual(['Misil entrante.'])
  })

  it('la chachara no se encola si ya hay alguien hablando', () => {
    const { synth, spoken } = fakeSynth({ speaking: true })
    browserSpeaker(synth, make).say({ text: 'Contacto.', urgency: 'info', key: 'k' })
    expect(spoken).toEqual([])
  })

  it('sin sintetizador no revienta', () => {
    const speaker = browserSpeaker(undefined, make)
    expect(() => speaker.say({ text: 'x', urgency: 'info', key: 'k' })).not.toThrow()
    expect(() => speaker.cancel()).not.toThrow()
  })

  it('sin voces disponibles en el motor no intenta hablar', () => {
    const { synth, spoken } = fakeSynth()
    browserSpeaker(synth, () => null).say({ text: 'x', urgency: 'info', key: 'k' })
    expect(spoken).toEqual([])
  })
})
