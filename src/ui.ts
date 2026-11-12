import { AIRCRAFT, SERVER_PORT, type AircraftId, type ConnState, type RadarState } from './types'
import { formatKm } from './geo'
import { arrowFor, clock, lockPercent, MISSILE_PERCENT } from './hud'
import type { TrackedContact } from './track'
import type { Fix } from './location'
import {
  loadRecord,
  recordLabel,
  saveRecord,
  settleRound,
  type PlayerRecord,
  type StorageLike,
} from './record'

export interface UiHandlers {
  onConnect: (url: string, callsign: string, aircraft: AircraftId) => void
  onDisconnect: () => void
  onAircraft: (id: AircraftId) => void
  onRadio: (on: boolean) => void
}

export interface Ui {
  setConn: (state: ConnState, detail?: string) => void
  setFix: (fix: Fix) => void
  setRadar: (radar: RadarState | null, tracks: TrackedContact[]) => void
  getCallsign: () => string
  getAircraft: () => AircraftId
  getServerUrl: () => string
  setConnected: (connected: boolean) => void
  /** Aviso de enlace (wake lock, reintento). `null` lo oculta. */
  setLink: (text: string | null, live?: boolean) => void
  setRadio: (on: boolean) => void
  getRadio: () => boolean
}

const LS_KEY = 'aeronet:profile'
const RADIO_KEY = 'aeronet:radio'

function loadRadio(): boolean {
  try {
    return localStorage.getItem(RADIO_KEY) !== 'off'
  } catch {
    return true
  }
}

interface Stored {
  callsign: string
  aircraft: AircraftId
}

function loadProfile(): Stored {
  try {
    const raw = localStorage.getItem(LS_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<Stored>
      if (parsed.callsign && parsed.aircraft && parsed.aircraft in AIRCRAFT) {
        return { callsign: parsed.callsign, aircraft: parsed.aircraft }
      }
    }
  } catch {
    /* perfil corrupto: seguimos con el por defecto */
  }
  const n = Math.floor(Math.random() * 90) + 10
  return { callsign: `VIPER-${n}`, aircraft: 'f35' }
}

function defaultServerUrl(): string {
  const host = location.hostname || 'localhost'
  return `ws://${host}:${SERVER_PORT}`
}

const STATUS_TEXT: Record<ConnState, string> = {
  idle: 'Sin conectar',
  connecting: 'Conectando…',
  open: 'En vuelo',
  closed: 'Desconectado',
  error: 'Error',
}

const PHASE_TEXT: Record<ConnState, string> = {
  idle: 'EN ESPERA',
  connecting: 'CONECTANDO',
  open: 'EN VUELO',
  closed: 'EN ESPERA',
  error: 'EN ESPERA',
}

export function mountUi(handlers: UiHandlers): Ui {
  const $ = <T extends HTMLElement>(sel: string) => document.querySelector<T>(sel)!

  const statusEl = $<HTMLSpanElement>('#status')
  const lobbyEl = $<HTMLElement>('#lobby')
  const flightEl = $<HTMLElement>('#flight')
  const callsignEl = $<HTMLInputElement>('#callsign')
  const serverEl = $<HTMLInputElement>('#server')
  const cardsEl = $<HTMLDivElement>('#aircraft')
  const connectEl = $<HTMLButtonElement>('#connect')
  const disconnectEl = $<HTMLButtonElement>('#disconnect')
  const linkEl = $<HTMLSpanElement>('#link')
  const radioEl = $<HTMLButtonElement>('#radio')
  const objectivesEl = $<HTMLDivElement>('#objectives')
  const locationEl = $<HTMLDivElement>('#location')
  const gpsEl = $<HTMLSpanElement>('#gps')
  const contactsEl = $<HTMLUListElement>('#contacts')
  const canvas = $<HTMLCanvasElement>('#radar')
  const timerEl = $<HTMLSpanElement>('#timer')
  const phaseEl = $<HTMLSpanElement>('#phase')
  const lockWrap = $<HTMLDivElement>('#lockwrap')
  const lockLabel = $<HTMLSpanElement>('#locklabel')
  const lockTime = $<HTMLSpanElement>('#locktime')
  const lockFill = $<HTMLElement>('#lockfill')
  const warnEl = $<HTMLDivElement>('#warn')
  const resultEl = $<HTMLDivElement>('#result')
  const ctx = canvas.getContext('2d')

  const stored = loadProfile()
  let aircraft: AircraftId = stored.aircraft
  let connected = false
  let radioOn = loadRadio()

  // `localStorage` puede lanzar al tocarlo (modo privado de Safari), asi que se
  // resuelve una vez y el resto del modulo trabaja con `undefined` si no hay.
  const storage: StorageLike | undefined = (() => {
    try {
      return globalThis.localStorage
    } catch {
      return undefined
    }
  })()
  let record: PlayerRecord = loadRecord(storage)

  callsignEl.value = stored.callsign
  serverEl.value = defaultServerUrl()

  const persist = () => {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify({ callsign: callsignEl.value, aircraft }))
    } catch {
      /* modo privado: sin persistencia */
    }
  }

  for (const [id, profile] of Object.entries(AIRCRAFT) as [AircraftId, (typeof AIRCRAFT)[AircraftId]][]) {
    const card = document.createElement('button')
    card.type = 'button'
    card.className = 'card'
    card.dataset.id = id
    card.innerHTML = `
      <span class="card-name">${profile.name}</span>
      <span class="card-role">${profile.role}</span>
      <span class="card-blurb">${profile.blurb}</span>
      <span class="card-stats">RCS ${profile.rcs} m² · radar ${profile.radar.toFixed(2)}</span>
    `
    card.addEventListener('click', () => {
      if (connected) return
      aircraft = id
      renderCards()
      persist()
      handlers.onAircraft(id)
    })
    cardsEl.appendChild(card)
  }

  function renderCards() {
    for (const card of cardsEl.querySelectorAll<HTMLButtonElement>('.card')) {
      card.classList.toggle('is-selected', card.dataset.id === aircraft)
    }
  }
  renderCards()

  callsignEl.addEventListener('change', persist)

  connectEl.addEventListener('click', () => {
    const callsign = callsignEl.value.trim() || 'VIPER-1'
    persist()
    handlers.onConnect(serverEl.value.trim() || defaultServerUrl(), callsign, aircraft)
  })

  disconnectEl.addEventListener('click', () => handlers.onDisconnect())

  function drawEmpty() {
    if (!ctx) return
    ctx.fillStyle = '#141414'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
  }

  /** Vuelve a dejar la pantalla de vuelo limpia (al conectar y al desconectar). */
  function resetFlight() {
    timerEl.textContent = '--:--'
    timerEl.classList.remove('is-low')
    lockWrap.hidden = true
    lockFill.style.width = '0%'
    warnEl.hidden = true
    warnEl.classList.remove('is-missile')
    resultEl.hidden = true
    contactsEl.replaceChildren()
    objectivesEl.replaceChildren()
    drawEmpty()
  }

  const setConn = (state: ConnState, detail?: string) => {
    statusEl.textContent = detail ? `${STATUS_TEXT[state]} · ${detail}` : STATUS_TEXT[state]
    statusEl.className = `status status-${state}`
    phaseEl.textContent = PHASE_TEXT[state]
    phaseEl.classList.toggle('is-live', state === 'open')
  }

  const setConnected = (value: boolean) => {
    connected = value
    lobbyEl.hidden = value
    flightEl.hidden = !value
    resetFlight()
  }

  const setLink = (text: string | null, live = false) => {
    linkEl.hidden = text === null
    linkEl.textContent = text ?? ''
    linkEl.classList.toggle('is-live', live)
  }

  const paintRadio = () => {
    radioEl.textContent = radioOn ? 'Radio ON' : 'Radio OFF'
    radioEl.classList.toggle('is-off', !radioOn)
  }

  const setRadio = (on: boolean) => {
    radioOn = on
    paintRadio()
  }

  radioEl.addEventListener('click', () => {
    radioOn = !radioOn
    try {
      localStorage.setItem(RADIO_KEY, radioOn ? 'on' : 'off')
    } catch {
      /* modo privado: sin persistencia */
    }
    paintRadio()
    handlers.onRadio(radioOn)
  })
  paintRadio()

  const setFix = (fix: Fix) => {
    const coords = `${fix.lat.toFixed(4)}, ${fix.lon.toFixed(4)}`
    const acc = fix.accuracy != null ? ` · ±${Math.round(fix.accuracy)} m` : ''
    locationEl.textContent = fix.simulated ? `GPS simulado · ${coords}` : `GPS ${coords}${acc}`
    locationEl.classList.toggle('is-warn', fix.simulated)

    gpsEl.textContent = fix.simulated
      ? 'GPS simulado'
      : fix.accuracy != null
        ? `GPS ±${Math.round(fix.accuracy)} m`
        : 'GPS activo'
    gpsEl.classList.toggle('is-warn', fix.simulated)
  }

  /**
   * Marcador y objetivos. Es lo que el jugador mira mientras vuela, asi que va
   * siempre en el mismo sitio y con el mismo formato que en las gafas.
   */
  function renderObjectives(radar: RadarState | null) {
    objectivesEl.replaceChildren()
    if (!radar) return

    const score = document.createElement('div')
    score.className = 'score'
    score.textContent = `${radar.you.score ?? 0} pts · ${radar.you.kills ?? 0} derribos · ${radar.you.deaths ?? 0} bajas`
    objectivesEl.appendChild(score)

    for (const objective of radar.objectives ?? []) {
      const row = document.createElement('div')
      row.className = 'obj'
      if (objective.kind === 'primary') row.classList.add('is-primary')
      if (objective.done) row.classList.add('is-done')

      const label = document.createElement('span')
      label.textContent = `${objective.kind === 'primary' ? '◆' : '◇'} ${objective.label}`

      const progress = document.createElement('span')
      progress.textContent = `${objective.progress}/${objective.target}${objective.done ? ' OK' : ''}`

      row.append(label, progress)
      objectivesEl.appendChild(row)
    }
  }

  function renderResult(radar: RadarState) {
    const winner = radar.result?.winner ?? null
    const mine = radar.you.callsign
    const rank = radar.result?.rank ?? null
    const scenario = radar.scenario
    const secs = Math.ceil(radar.remainingMs / 1000)

    const strong = document.createElement('strong')
    const verdict = winner ? (winner === mine ? 'Victoria' : `Gana ${winner}`) : 'Empate'
    strong.textContent = rank ? `${verdict} · ${rank}` : verdict

    const reason = document.createElement('span')
    const why = radar.result?.reason ?? ''
    const score = radar.result?.points != null ? `${radar.result.points} pts · ` : ''
    // Con escenario, la cuenta atras vive en la tarjeta de abajo.
    reason.textContent = scenario ? `${score}${why}` : `${score}${why} · nueva partida en ${secs} s`

    const nodes: HTMLElement[] = [strong, reason]

    const summary = recordLabel(record)
    if (summary) {
      const line = document.createElement('span')
      line.className = 'rec'
      line.textContent = summary
      nodes.push(line)
    }

    // Tarjeta de la ronda siguiente: identica para todos y, de paso, explica el
    // salto que antes no tenia explicacion.
    if (scenario) {
      const card = document.createElement('div')
      card.className = 'next'
      const next = radar.round != null ? `ronda ${radar.round + 1} · ` : ''
      card.textContent = `Siguiente · ${next}${scenario.name} — ${scenario.rule} · en ${secs} s`
      nodes.push(card)
    }

    resultEl.replaceChildren(...nodes)
    resultEl.hidden = false
  }

  function renderContacts(tracks: TrackedContact[], lockedCallsign: string | null) {
    contactsEl.replaceChildren()

    if (tracks.length === 0) {
      const li = document.createElement('li')
      li.className = 'empty'
      li.textContent = 'Sin contactos en el alcance del radar'
      contactsEl.appendChild(li)
      return
    }

    for (const track of tracks) {
      const li = document.createElement('li')
      li.className = 'contact'
      if (track.stale) li.classList.add('is-stale')
      if (lockedCallsign && track.callsign === lockedCallsign) li.classList.add('is-locked')

      const arrow = document.createElement('span')
      arrow.className = 'arrow'
      arrow.textContent = track.stale ? '?' : arrowFor(track.bearingDeg)

      const name = document.createElement('span')
      name.className = 'name'
      name.textContent = AIRCRAFT[track.aircraft].name

      const bearing = document.createElement('span')
      bearing.className = 'bearing'
      bearing.textContent = track.stale
        ? `${Math.round(track.ageMs / 1000)} s`
        : `${String(Math.round(track.bearingDeg)).padStart(3, '0')}°`

      const dist = document.createElement('span')
      dist.className = 'dist'
      dist.textContent = formatKm(track.distKm)

      li.append(arrow, name, bearing, dist)
      contactsEl.appendChild(li)
    }
  }

  const setRadar = (radar: RadarState | null, tracks: TrackedContact[]) => {
    if (!radar) {
      resetFlight()
      return
    }

    const live = radar.phase === 'flying'
    const downMs = radar.you.downMs ?? 0

    timerEl.textContent = clock(radar.remainingMs)
    timerEl.classList.toggle('is-low', live && radar.remainingMs <= 30_000)
    renderObjectives(radar)

    if (live && radar.lock) {
      lockWrap.hidden = false
      lockLabel.textContent = `Bloqueando ${radar.lock.callsign}`
      lockTime.textContent = `${(radar.lock.ms / 1000).toFixed(1)} / ${Math.round(radar.lock.needMs / 1000)} s`
      lockFill.style.width = `${lockPercent(radar.lock.ms, radar.lock.needMs)}%`
    } else {
      lockWrap.hidden = true
      lockFill.style.width = '0%'
    }

    if (live && downMs > 0) {
      warnEl.hidden = false
      warnEl.textContent = `DERRIBADO · vuelve en ${Math.ceil(downMs / 1000)} s`
      warnEl.classList.remove('is-missile')
    } else if (live && radar.lockedBy) {
      const threat = radar.threat ?? null
      const missile = threat !== null && threat.percent >= MISSILE_PERCENT
      const where = threat?.bearingDeg != null ? ` · ${String(threat.bearingDeg).padStart(3, '0')}°` : ''
      warnEl.hidden = false
      warnEl.textContent = missile
        ? `⚠ MISIL · ${radar.lockedBy}${where} ${threat!.percent}%`
        : `⚠ TE BLOQUEAN · ${radar.lockedBy}${where}`
      warnEl.classList.toggle('is-missile', missile)
    } else {
      warnEl.hidden = true
      warnEl.classList.remove('is-missile')
    }

    if (radar.phase === 'finished') {
      // El marcador se repinta cada segundo: `settleRound` es idempotente por
      // numero de ronda, asi que una victoria no se cuenta doce veces.
      const next = settleRound(record, {
        round: radar.round ?? null,
        winner: radar.result?.winner ?? null,
        me: radar.you.callsign,
        rank: radar.result?.rank ?? null,
      })
      if (next !== record) {
        record = next
        saveRecord(storage, record)
      }
      renderResult(radar)
    } else {
      resultEl.hidden = true
    }

    renderContacts(tracks, radar.lock?.callsign ?? null)
    drawRadar(Math.max(radar.rangeKm, 0.2), tracks)
  }

  function drawRadar(range: number, tracks: TrackedContact[]) {
    if (!ctx) return
    const size = canvas.width
    const c = size / 2
    const r = c - 20

    ctx.fillStyle = '#141414'
    ctx.fillRect(0, 0, size, size)

    // anillos
    ctx.strokeStyle = '#2f4a35'
    ctx.lineWidth = 1
    for (const frac of [0.33, 0.66, 1]) {
      ctx.beginPath()
      ctx.arc(c, c, r * frac, 0, Math.PI * 2)
      ctx.stroke()
    }

    // ejes
    ctx.beginPath()
    ctx.moveTo(c, c - r)
    ctx.lineTo(c, c + r)
    ctx.moveTo(c - r, c)
    ctx.lineTo(c + r, c)
    ctx.stroke()

    // etiquetas
    ctx.fillStyle = '#6f7f72'
    ctx.font = '10px system-ui, sans-serif'
    ctx.textAlign = 'center'
    ctx.fillText(formatKm(range), c, c - r - 6)
    ctx.fillText('N', c, c - r + 2 + 10)
    ctx.fillText(formatKm(range / 2), c, c - r / 2 + 12)

    // posicion propia
    ctx.fillStyle = '#e5e5e5'
    ctx.beginPath()
    ctx.arc(c, c, 3.5, 0, Math.PI * 2)
    ctx.fill()

    // contactos: los viejos quedan en la ultima posicion conocida, atenuados
    for (const track of tracks) {
      const d = Math.min(track.distKm / range, 1) * r
      const a = ((track.bearingDeg - 90) * Math.PI) / 180
      const x = c + Math.cos(a) * d
      const y = c + Math.sin(a) * d

      ctx.fillStyle = track.stale ? '#5c6b5e' : track.kind === 'bot' ? '#8fe39a' : '#ffffff'
      ctx.beginPath()
      ctx.arc(x, y, track.stale ? 2.5 : 4, 0, Math.PI * 2)
      ctx.fill()

      ctx.fillStyle = track.stale ? '#6f7f72' : '#cfd8cf'
      ctx.font = '10px system-ui, sans-serif'
      ctx.textAlign = x < c ? 'right' : 'left'
      ctx.fillText(AIRCRAFT[track.aircraft].name, x + (x < c ? -7 : 7), y + 3)
    }
  }

  drawEmpty()

  return {
    setConn,
    setFix,
    setRadar,
    getCallsign: () => callsignEl.value.trim() || 'VIPER-1',
    getAircraft: () => aircraft,
    getServerUrl: () => serverEl.value.trim() || defaultServerUrl(),
    setConnected,
    setLink,
    setRadio,
    getRadio: () => radioOn,
  }
}
