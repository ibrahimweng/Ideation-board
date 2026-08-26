import { useEffect, useState } from 'react'
import { runTool } from './tools'

/* ---------------------------------------------------------------------------
 * The wire between this tab and the relay Claude is talking to.
 *
 * Requests arrive on an event stream and answers go back as ordinary posts.
 * Not a socket, which would have meant a dependency at both ends and a hand
 * written handshake here; an event stream is two browser primitives and it
 * only ever has to carry one direction, because the tab never speaks first.
 *
 * The relay is on the loopback address, which every page in the browser can
 * reach — so the relay checks the Origin of whoever opens the stream and
 * refuses anyone it was not told about. That check is on its side, not this
 * one: a page cannot be trusted to vouch for itself.
 * ------------------------------------------------------------------------- */

const URL_KEY = 'ideation.mcp.url'
const ON_KEY = 'ideation.mcp.on'
const TOKEN_KEY = 'ideation.mcp.token'

export const DEFAULT_URL = 'http://127.0.0.1:4319'

function read(k: string) {
  try {
    return localStorage.getItem(k) || ''
  } catch {
    return ''
  }
}

function write(k: string, v: string) {
  try {
    if (v) localStorage.setItem(k, v)
    else localStorage.removeItem(k)
  } catch {
    /* Storage is blocked. The connection still works for this sitting. */
  }
}

export const relayUrl = () => read(URL_KEY) || DEFAULT_URL
export const setRelayUrl = (u: string) => write(URL_KEY, u.trim() === DEFAULT_URL ? '' : u.trim())
export const relayToken = () => read(TOKEN_KEY)
export const setRelayToken = (t: string) => write(TOKEN_KEY, t.trim())
/* Whether the person asked to be connected. Remembered so a reload does not
 * quietly drop the connection out from under a conversation in progress. */
export const wantsRelay = () => read(ON_KEY) === '1'

export type Status = 'off' | 'joining' | 'on' | 'lost'

let status: Status = 'off'
let source: EventSource | null = null
let retry = 0
let retryTimer = 0
let patience = 0
/* What the relay last asked for, so the interface can say what is happening
 * rather than only that something is. */
let lastCall = ''
const watchers = new Set<() => void>()

function tell() {
  for (const fn of [...watchers]) fn()
}

export const relayStatus = () => status
export const lastRelayCall = () => lastCall

function set(s: Status) {
  if (status === s) return
  status = s
  tell()
}

async function answer(id: number, tool: string, args: Record<string, unknown>) {
  lastCall = tool
  tell()
  const out = await runTool(tool, args)
  try {
    await fetch(`${relayUrl()}/reply${query()}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id, ...out }),
    })
  } catch {
    /* The relay went away mid-answer. It will have timed out its own side,
     * and the stream closing will bring us back round to reconnecting. */
  }
}

const query = () => (relayToken() ? `?token=${encodeURIComponent(relayToken())}` : '')

export function connect() {
  disconnect(true)
  write(ON_KEY, '1')
  set('joining')
  let es: EventSource
  try {
    es = new EventSource(`${relayUrl()}/events${query()}`)
  } catch {
    set('lost')
    return
  }
  source = es

  es.onopen = () => {
    window.clearTimeout(patience)
    retry = 0
    set('on')
  }

  /* A relay that is not running looks like a refused connection, and the
   * browser answers a refused connection by quietly trying again for ever —
   * readyState never reaches CLOSED, so nothing here would ever call it a
   * failure and the corner would sit on "attaching" looking like it was about
   * to work. Given long enough to be wrong about, it is called what it is, and
   * the browser's own loop is stopped in favour of one that backs off. */
  window.clearTimeout(patience)
  patience = window.setTimeout(() => {
    if (status === 'on') return
    try {
      es.close()
    } catch {
      /* Already closed. */
    }
    giveUp()
  }, 8000)

  es.onmessage = (e) => {
    let msg: { id: number; tool: string; args: Record<string, unknown> }
    try {
      msg = JSON.parse(e.data)
    } catch {
      return
    }
    if (typeof msg?.id !== 'number' || typeof msg?.tool !== 'string') return
    void answer(msg.id, msg.tool, msg.args || {})
  }

  /* EventSource reconnects on its own, but not from a refused connection —
   * which is what a relay that is not running looks like — so the state is
   * tracked here and the retry is ours. Backing off to half a minute, because
   * the commonest reason to be here is that the relay was never started. */
  es.onerror = () => {
    /* CLOSED is the browser giving up — a refusal it will not retry. Anything
     * else is it still trying, which is left alone until the patience above
     * runs out. */
    if (es.readyState === EventSource.CLOSED) giveUp()
    else if (status !== 'on') set('joining')
  }
}

/* Not attached, and going to try again on a widening interval — because the
 * commonest reason to be here is a relay that has not been started yet, and
 * starting it should be enough without coming back to this sheet. */
function giveUp() {
  set('lost')
  if (!wantsRelay()) return
  const wait = Math.min(30_000, 1000 * 2 ** retry++)
  window.clearTimeout(retryTimer)
  retryTimer = window.setTimeout(() => {
    if (wantsRelay()) connect()
  }, wait)
}

export function disconnect(keepWanting = false) {
  window.clearTimeout(retryTimer)
  window.clearTimeout(patience)
  if (!keepWanting) {
    write(ON_KEY, '')
    retry = 0
  }
  try {
    source?.close()
  } catch {
    /* Already closed. */
  }
  source = null
  if (!keepWanting) set('off')
}

export interface Found {
  up: boolean
  /* Running, but it has not been told about this page. A different problem
   * from a relay that is not there, and the fix is a different command. */
  allowed?: boolean
  connected?: boolean
  needsToken?: boolean
}

/* Is anything listening on the other end? Asked before offering to connect, so
 * that what is wrong can be said once rather than discovered as a connection
 * that silently never opens. */
export async function relayThere(url = relayUrl()): Promise<Found> {
  try {
    const res = await fetch(`${url}/health`, { signal: AbortSignal.timeout(2500) })
    const j = await res.json().catch(() => ({}))
    if (res.status === 403) return { up: true, allowed: false }
    if (!res.ok) return { up: false }
    return { up: true, allowed: true, connected: !!j?.connected, needsToken: !!j?.needsToken }
  } catch {
    /* Refused, or blocked before it left. Either way there is nothing there. */
    return { up: false }
  }
}

/* Picked up again on load, so a reload in the middle of a conversation does
 * not leave Claude talking to a board that is no longer listening. */
export function resumeRelay() {
  if (wantsRelay()) connect()
}

export function useRelay(): { status: Status; call: string } {
  const [, bump] = useState(0)
  useEffect(() => {
    const fn = () => bump((n) => n + 1)
    watchers.add(fn)
    return () => {
      watchers.delete(fn)
    }
  }, [])
  return { status, call: lastCall }
}
