import { useEffect, useState } from 'react'
import { holdKeys } from './modal'
import {
  DEFAULT_URL, connect, disconnect, relayThere, relayToken, relayUrl, setRelayToken, setRelayUrl, useRelay,
} from '../mcp/bridge'

/* ---------------------------------------------------------------------------
 * Letting Claude at the board.
 *
 * The board has no server, so an agent cannot be handed a database to read.
 * What it can be handed is this tab. A small relay runs on your own machine,
 * Claude talks to it, and it asks the tab — which is the only thing that has
 * ever known what is on your board.
 *
 * The sheet's job is to make the one piece of setup unmissable: the relay has
 * to be running, and it has to have been told about this address. Both of
 * those are commands, so both are here, with this page's own origin already
 * filled in rather than left as something to work out.
 * ------------------------------------------------------------------------- */

export function RelaySheet({ onClose }: { onClose: () => void }) {
  const { status } = useRelay()
  const [url, setUrl] = useState(relayUrl)
  const [token, setToken] = useState(relayToken)
  const [found, setFound] = useState<'asking' | 'yes' | 'no' | 'shut-out'>('asking')
  const [more, setMore] = useState(false)

  useEffect(holdKeys, [])

  const look = async (at = url) => {
    setFound('asking')
    const r = await relayThere(at)
    setFound(!r.up ? 'no' : r.allowed === false ? 'shut-out' : 'yes')
    if (r.up && r.needsToken && !token) setMore(true)
  }

  useEffect(() => {
    void look()
    /* Once, when the sheet opens. */
  }, [])

  const here = window.location.origin
  const loopback = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(here)
  const cmd = `claude mcp add ideation -- node <this repo>/mcp/server.mjs${loopback ? '' : ` --origin ${here}`}`

  const said =
    status === 'on' ? 'Claude is attached to this board.'
      : status === 'joining' ? 'Attaching…'
        : status === 'lost' ? 'The relay stopped answering. Trying again.'
          : 'Not attached.'

  return (
    <div className="sheet-veil" onPointerDown={onClose}>
      <div
        className="sheet gen-sheet"
        onPointerDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === 'Escape') onClose()
        }}
      >
        <h3>Connect to Claude</h3>

        <p className="gen-intro">
          Claude can read this board and work on it — put notes down, arrange things, join them up, decide what
          is in and what is out, and draw pictures with your key. It goes through a small relay on your own
          machine: nothing about your board is uploaded, and the relay only answers pages you have named.
        </p>

        <div className="relay-state" data-on={status === 'on' || undefined} data-warn={status === 'lost' || undefined}>
          <span className="relay-dot" />
          <span>{said}</span>
        </div>

        {found === 'no' && (
          <div className="relay-how">
            <p>No relay is answering on {url}. Start one — it needs nothing installed:</p>
            <code>{cmd}</code>
            {!loopback && (
              <p className="gen-note">
                The <b>--origin</b> is this address. Without it the relay refuses this page, which is the point
                of it: anything you visit can reach your own machine, so only what you name is let through.
              </p>
            )}
            <p className="gen-note">Then restart Claude Code so it picks the relay up, and press Look again.</p>
          </div>
        )}

        {found === 'shut-out' && (
          <div className="relay-how">
            <p>
              A relay is running, and it has not been told about this page. That is it doing its job — it only
              answers addresses you have named. Start it again with this one:
            </p>
            <code>{`node <this repo>/mcp/server.mjs --origin ${here}`}</code>
            <p className="gen-note">Then press Look again.</p>
          </div>
        )}

        <button className="gen-more" aria-expanded={more} onClick={() => setMore((v) => !v)}>
          {more ? '▾' : '▸'} Where the relay is
        </button>

        {more && (
          <div className="gen-settings">
            <label>
              <span>Address</span>
              <input
                value={url}
                spellCheck={false}
                aria-label="Relay address"
                onChange={(e) => {
                  setUrl(e.target.value)
                  setRelayUrl(e.target.value)
                }}
              />
              {url !== DEFAULT_URL && (
                <button
                  className="ghost"
                  onClick={() => {
                    setUrl(DEFAULT_URL)
                    setRelayUrl(DEFAULT_URL)
                  }}
                >
                  Reset
                </button>
              )}
            </label>
            <label>
              <span>Token</span>
              <input
                value={token}
                spellCheck={false}
                placeholder="Only if the relay was started with --token"
                aria-label="Relay token"
                onChange={(e) => {
                  setToken(e.target.value)
                  setRelayToken(e.target.value)
                }}
              />
            </label>
            <p className="gen-note">
              A token is optional hardening. What actually keeps other sites out is the relay checking which
              page is asking, which it does whether or not there is a token.
            </p>
          </div>
        )}

        <div className="sheet-actions">
          <button className="ghost" onClick={onClose}>Close</button>
          <button className="ghost" onClick={() => void look()}>{found === 'asking' ? 'Looking…' : 'Look again'}</button>
          {status === 'on' || status === 'joining' ? (
            <button onClick={() => disconnect()}>Disconnect</button>
          ) : (
            <button disabled={found !== 'yes'} onClick={() => connect()}>Connect</button>
          )}
        </div>
      </div>
    </div>
  )
}
