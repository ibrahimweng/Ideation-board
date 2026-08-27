import { useEffect, useRef, useState } from 'react'
import { useObjectURL } from '../store/media'
import { holdKeys } from './modal'
import {
  DEFAULT_BASE, apiBase, apiKey, forgetApiKey, hasKey, maskKey, modelId, setApiBase, setApiKey, setModelId,
} from '../ai/key'
import { AiError, imageModels, listModels, methodFor, type AiModel } from '../ai/gemini'

/* ---------------------------------------------------------------------------
 * Asking for a picture.
 *
 * The first time, this is a place to put a key; after that it is a prompt box.
 * The settings stay one line away rather than behind a preferences window,
 * because the model is the thing you change most often after the prompt.
 *
 * Nothing here is stored on a server, and the sheet says so where it asks for
 * the key rather than in a document nobody opens.
 * ------------------------------------------------------------------------- */

const RATIOS = [
  { id: '', label: 'Auto' },
  { id: '1:1', label: 'Square' },
  { id: '3:2', label: 'Landscape' },
  { id: '2:3', label: 'Portrait' },
  { id: '16:9', label: 'Wide' },
  { id: '9:16', label: 'Tall' },
]

/* Kept between openings so that changing one word in a prompt does not mean
 * typing the other twenty again. Not stored: it belongs to this sitting. */
let lastPrompt = ''
let lastRatio = ''
let lastCount = 1
/* And the model list, so that opening the sheet a second time does not ask
 * Google for it a second time. It changes about as often as Google ships a
 * model, which is not within one sitting. */
let known: AiModel[] | null = null

/* One of the pictures being worked from, and a way to stop working from it. */
function Ref({ media, name, onDrop }: { media?: string; name: string; onDrop: () => void }) {
  const url = useObjectURL(media)
  return (
    <span className="gen-ref" title={name}>
      {url ? <img src={url} alt={name} /> : <i className="gen-ref-blank" />}
      <button aria-label={`Stop working from ${name}`} onClick={onDrop}>×</button>
    </span>
  )
}

export interface Working {
  id: string
  media?: string
  name: string
}

export interface GenerateSheetProps {
  onClose: () => void
  onDraw: (prompt: string, count: number, aspect: string, from: string[]) => void
  /* The pictures picked out on the board when this was opened. Offered rather
   * than assumed: having something selected is not the same as meaning to
   * work from it. */
  working?: Working[]
  busy?: boolean
}

export function GenerateSheet({ onClose, onDraw, working = [], busy }: GenerateSheetProps) {
  const [prompt, setPrompt] = useState(lastPrompt)
  const [ratio, setRatio] = useState(lastRatio)
  const [count, setCount] = useState(lastCount)
  const [keyed, setKeyed] = useState(hasKey)
  const [settings, setSettings] = useState(() => !hasKey())
  const [keyText, setKeyText] = useState('')
  const [model, setModel] = useState(modelId)
  const [base, setBase] = useState(apiBase)
  const [models, setModels] = useState<AiModel[] | null>(known)
  const [loading, setLoading] = useState(false)
  const [note, setNote] = useState('')
  /* Taken as they were when the sheet opened. The board carries on underneath
     and the selection can change; what is being worked from should not move
     while a prompt is being typed about it. */
  const [from, setFrom] = useState<Working[]>(working)
  const ref = useRef<HTMLTextAreaElement | null>(null)

  useEffect(holdKeys, [])
  useEffect(() => {
    if (keyed) ref.current?.focus()
  }, [keyed])

  /* With a key and no list yet, fetch it rather than making the first thing
   * you do in here be pressing a button called "List models". */
  useEffect(() => {
    if (keyed && !known) void load()
    /* Once, when the sheet opens, and never again while it is up. */
  }, [])

  const saveKey = () => {
    const k = keyText.trim()
    if (!k) return
    setApiKey(k)
    setKeyText('')
    setKeyed(true)
    setNote('')
    known = null
    void load(k)
  }

  const load = async (k = apiKey()) => {
    setLoading(true)
    setNote('')
    try {
      const all = await listModels(k, base)
      const can = imageModels(all)
      known = can
      setModels(can)
      if (!can.length) {
        setNote('That key works, but none of the models it can see make pictures.')
      } else if (!model) {
        /* Chosen for you the first time, so that a key and a prompt is enough
         * to get a picture without a decision about model names first. */
        choose(can[0])
      }
    } catch (e) {
      setModels(null)
      setNote(e instanceof AiError ? e.message : 'Could not read the model list.')
    } finally {
      setLoading(false)
    }
  }

  /* Picked from the list, so the listing's word on how to ask it is kept. */
  const choose = (m: AiModel) => {
    setModel(m.id)
    setModelId(m.id, methodFor(m, m.id))
  }

  const forget = () => {
    forgetApiKey()
    setKeyed(false)
    known = null
    setModels(null)
    setSettings(true)
    setNote('Key removed from this browser.')
  }

  const go = () => {
    const p = prompt.trim()
    if (!p || busy) return
    if (!keyed) {
      setSettings(true)
      setNote('A key first.')
      return
    }
    if (!model) {
      setSettings(true)
      setNote('Pick a model first.')
      return
    }
    lastPrompt = p
    lastRatio = ratio
    lastCount = count
    onDraw(p, count, ratio, from.map((w) => w.id))
  }

  return (
    <div className="sheet-veil" onPointerDown={onClose}>
      <div
        className="sheet gen-sheet"
        onPointerDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === 'Escape') onClose()
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
            e.preventDefault()
            go()
          }
        }}
      >
        <h3>Draw something</h3>

        {keyed ? (
          <>
            {from.length > 0 && (
              <div className="gen-working">
                <span>
                  Working from {from.length === 1 ? 'this' : `these ${from.length}`}
                </span>
                <div className="gen-refs">
                  {from.map((w) => (
                    <Ref
                      key={w.id}
                      media={w.media}
                      name={w.name}
                      onDrop={() => setFrom((list) => list.filter((x) => x.id !== w.id))}
                    />
                  ))}
                </div>
              </div>
            )}

            <textarea
              ref={ref}
              className="gen-prompt"
              rows={4}
              value={prompt}
              placeholder={
                from.length
                  ? 'The same pot, at night, lit from one side'
                  : 'A cracked terracotta pot on a windowsill, hard afternoon light'
              }
              aria-label="What to draw"
              onChange={(e) => setPrompt(e.target.value)}
            />

            <div className="gen-row" role="group" aria-label="Shape">
              <span>Shape</span>
              {RATIOS.map((r) => (
                <button key={r.id || 'auto'} data-on={ratio === r.id || undefined} onClick={() => setRatio(r.id)}>
                  {r.label}
                </button>
              ))}
            </div>

            <div className="gen-row" role="group" aria-label="How many">
              <span>How many</span>
              {[1, 2, 4].map((n) => (
                <button key={n} data-on={count === n || undefined} onClick={() => setCount(n)}>
                  {n}
                </button>
              ))}
              {count > 1 && <em className="gen-aside">held up against each other with C</em>}
            </div>
          </>
        ) : (
          <p className="gen-intro">
            This board has no server, so it has no key of its own. Paste your own Google AI Studio key and it is kept in
            this browser only — never sent anywhere but Google, never written into a board, an export or a folder.
            Pictures are billed to your key.
          </p>
        )}

        <button className="gen-more" aria-expanded={settings} onClick={() => setSettings((v) => !v)}>
          {settings ? '▾' : '▸'} Key and model
          {keyed && !settings && model ? <span className="gen-model">{model}</span> : null}
        </button>

        {settings && (
          <div className="gen-settings">
            <label>
              <span>Key</span>
              <input
                type="password"
                autoComplete="off"
                spellCheck={false}
                value={keyText}
                placeholder={keyed ? maskKey() : 'Paste your Google AI Studio key'}
                aria-label="API key"
                onChange={(e) => setKeyText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    saveKey()
                  }
                }}
              />
              {keyText.trim() ? (
                <button onClick={saveKey}>Save</button>
              ) : keyed ? (
                <button className="ghost" onClick={forget}>Forget</button>
              ) : null}
            </label>

            <label>
              <span>Model</span>
              <input
                list="gen-models"
                value={model}
                spellCheck={false}
                placeholder="gemini-…  or  imagen-…"
                aria-label="Model"
                onChange={(e) => {
                  setModel(e.target.value)
                  /* Typed by hand: nothing knows how this one wants to be
                     asked, so the name is guessed from at the moment of use. */
                  setModelId(e.target.value)
                }}
              />
              <datalist id="gen-models">
                {(models || []).map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </datalist>
              <button className="ghost" disabled={!keyed || loading} onClick={() => void load()}>
                {loading ? 'Looking…' : models ? 'Refresh' : 'List models'}
              </button>
            </label>

            {models && models.length > 0 && (
              <ul className="gen-models">
                {models.slice(0, 8).map((m) => (
                  <li key={m.id}>
                    <button
                      data-on={m.id === model || undefined}
                      onClick={() => choose(m)}
                    >
                      {m.id}
                    </button>
                  </li>
                ))}
              </ul>
            )}

            <label>
              <span>Address</span>
              <input
                value={base}
                spellCheck={false}
                aria-label="API address"
                onChange={(e) => {
                  setBase(e.target.value)
                  setApiBase(e.target.value)
                  /* A different address is a different set of models. */
                  known = null
                  setModels(null)
                }}
              />
              {base !== DEFAULT_BASE && (
                <button
                  className="ghost"
                  onClick={() => {
                    setBase(DEFAULT_BASE)
                    setApiBase(DEFAULT_BASE)
                  }}
                >
                  Reset
                </button>
              )}
            </label>

            <p className="gen-note">
              The key stays in this browser's local storage. Another machine needs it entered again, and anything with a
              debugger open on this page can read it — so use a key you can revoke.
            </p>
          </div>
        )}

        {note && <p className="gen-warn" role="status">{note}</p>}

        <div className="sheet-actions">
          <button className="ghost" onClick={onClose}>Close</button>
          <button disabled={!prompt.trim() || !keyed || busy} onClick={go}>
            {busy ? 'Drawing…' : count > 1 ? `Draw ${count}` : 'Draw'}
          </button>
        </div>
      </div>
    </div>
  )
}
