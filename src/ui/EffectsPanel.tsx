import { memo, useId, useMemo, useRef, useState } from 'react'
import { store, useSelection, useItem } from '../state/store'
import { EFFECTS, GROUPS, BY_ID, PRESETS, defaults } from '../engine/effects'
import { ADJUST_0, BLENDS, REPEATS, blendOf, isColor, isEnum } from '../engine/types'
import type { Control, Layer, Params, FxState } from '../engine/types'
import { FxCanvas } from '../board/FxCanvas'
import { useSourceReady } from '../board/sources'
import { useFeeder } from '../state/feeds'
import { LooksTab } from './LooksTab'
import { canShade, isGradeable, pixelKey } from '../state/kinds'
import { DIST, PITCH, stageOf, takeOffSkin, turnTo, wearSkin } from '../state/staging'
import {
  addSoundLayer, chainOf, clearSound, dropSoundLayer, isSound, setSoundEffect, setSoundParam, treating,
} from '../state/sounds'
import { MAX_CHAIN, SOUND_BY_ID, soundDefaults, soundGroups } from '../store/sound'
import { STAGE_0 } from '../store/model'
import type { Part, Stage } from '../store/model'
import type { Item } from '../state/types'
import { holdOriginal, releaseOriginal, useComparing } from '../board/original'
import { KEYS, nameFor, titleFor } from './shortcuts'
import { IconEffects, IconEye, IconSearch } from './icons'

/* Every layer past the first is another full pass over the card, so this is a
 * real cost and not a taste. Four is past what anybody has wanted and still
 * cheap enough not to have to think about. */
const MAX_LAYERS = 4

/* ---------------------------------------------------------------------------
 * Effects panel.
 *
 * The previous version built its preview strip by rendering five effects per
 * animation frame and calling toDataURL('image/jpeg') on each — a synchronous
 * CPU encode plus a fresh canvas allocation — then setState on every frame,
 * which re-rendered the entire board.
 *
 * Each preview here is just another FxCanvas at 132px. It goes through the
 * same worker, the same resident texture and the same zero-copy delivery as a
 * full card, so the strip costs a handful of small draw calls and no encoding.
 * ------------------------------------------------------------------------- */

export type PanelTab = 'effect' | 'adjust' | 'looks'

interface Props {
  tab: PanelTab
  onTab: (t: PanelTab) => void
  say: (msg: string) => void
}

export function EffectsPanel({ tab, onTab, say }: Props) {
  const selection = useSelection()
  const [find, setFind] = useState('')
  const comparing = useComparing()
  /* Which of a card's effects the grid and the sliders are working on. Held
     here rather than on the card: it is where you are looking, not something
     about the board. */
  const [layer, setLayer] = useState(0)
  const found = useMemo(() => {
    const q = find.trim().toLowerCase()
    if (!q) return GROUPS
    return GROUPS.map((g) => ({ ...g, items: g.items.filter((e) => e.name.toLowerCase().includes(q)) })).filter(
      (g) => g.items.length
    )
  }, [find])
  /* Controls edit the first selected media item and apply to all of them. */
  const targets = useMemo(
    () =>
      selection
        .map((id) => store.getItem(id))
        .filter(isGradeable),
    [selection]
  )
  const primaryId = targets[0]?.id
  const primary = useItem(primaryId || '')
  /* Whether a card is wired into the one being worked on, for the effects that
     read two pictures. */
  const fed = useFeeder(primaryId || '')

  /* Sounds, which this panel treats as its own thing rather than as a picture
     with no pixels. Nothing above applies to them — there is no shader, no
     tone and no crop — and nothing below does either, so they get a panel of
     their own and this one stands aside. */
  const sounds = useMemo(() => selection.map((id) => store.getItem(id)).filter(isSound), [selection])
  const heardId = sounds[0]?.id

  if (!primary && heardId) return <SoundPanel ids={sounds.map((s) => s.id)} id={heardId} say={say} />

  /* Open, with nothing to work on. A full width column of one sentence takes
   * three hundred and twenty pixels off the board to say nothing; a rail says
   * the same thing and gives them back. */
  if (!primary) {
    return (
      <aside className="panel panel-rail" title="Select a picture, a video or a sound to work on it">
        <IconEffects />
      </aside>
    )
  }

  const fx = primary.fx
  const ids = targets.map((t) => t!.id)

  /* A card's effects, as a list. The first has always lived on the card itself
   * and the rest in `more`, so that every board ever saved reads back as it
   * was; here they are one thing, because to work on them they are one thing. */
  const layers: Layer[] = [{ fxid: fx.fxid, ep: fx.ep, n: fx.n }, ...(fx.more || [])]
  const at = Math.min(layer, layers.length - 1)
  const spec = BY_ID[layers[at].fxid] || BY_ID.none

  /* Shaders need the picture's pixels. An embedded player never gives them up,
   * and neither does a video whose host refused cross-origin access. Tone,
   * framing and grain are CSS and work on both, so the Adjust tab stays. */
  const shadeable =
    canShade(primary)
  const why =
    primary.kind === 'embed'
      ? `A ${primary.name || 'player'} embed runs in its own frame, so nothing outside it can read the picture. Tone, framing and grain still apply.`
      : 'This video is served from a host that does not allow its pixels to be read, so shaders cannot run on it. Tone, framing and grain still apply.'

  /* A video card previews its effects on the still it was opened with, and a
   * document on the page it is showing; a remote video has no still to use, so
   * its thumbnails stay blank. */
  const previewKey = pixelKey(primary)

  /* `discrete` for a control that is pressed rather than swept. The window
   * below is right for a slider, which has no beginning, and wrong for a
   * button: without it, choosing a blend mode half a second after typing an
   * opacity made the two of them one step, and undoing the mode took the
   * opacity with it. */
  const patchFx = (patch: Partial<FxState>, discrete = false) => {
    /* A slider sweep is one undo step rather than none. */
    store.beginGesture(discrete ? 0 : 600)
    for (const id of ids) {
      const cur = store.getItem(id)
      if (!cur) continue
      store.update(id, { fx: { ...cur.fx, ...patch } }, false)
    }
  }

  /* Back into the shape a card keeps: the first effect on the card, the rest
   * in `more`, and no `more` at all when there is only one — so a card with a
   * single effect is byte for byte what it was before stacking existed. */
  const pack = (list: Layer[]): Partial<FxState> => ({
    fxid: list[0]?.fxid || 'none',
    ep: list[0]?.ep ?? null,
    n: list[0]?.n,
    more: list.length > 1 ? list.slice(1) : undefined,
  })

  /* Each card is edited from its own layers, not from the one whose panel is
   * on screen: several cards can be selected with different stacks, and
   * writing this card's list onto all of them would quietly flatten them. */
  const editLayers = (fn: (list: Layer[]) => Layer[]) => {
    store.beginGesture(600)
    for (const id of ids) {
      const cur = store.getItem(id)
      if (!cur) continue
      const mine: Layer[] = [{ fxid: cur.fx.fxid, ep: cur.fx.ep, n: cur.fx.n }, ...(cur.fx.more || [])]
      store.update(id, { fx: { ...cur.fx, ...pack(fn(mine)) } }, false)
    }
  }

  const setEffect = (fxid: string) =>
    editLayers((list) => {
      const next = [...list]
      const i = Math.min(at, next.length - 1)
      next[i] = { fxid, ep: fxid === 'none' ? null : (defaults(fxid) as Params) }
      /* Setting the only layer to nothing is taking the effect off, which is
       * what it has always meant. Setting a later one to nothing is asking for
       * a pass that does nothing, so it goes instead. */
      return i > 0 && fxid === 'none' ? next.filter((_, n) => n !== i) : next
    })

  const addLayer = () => {
    if (layers.length >= MAX_LAYERS) return
    editLayers((list) => [...list, { fxid: 'none', ep: null }])
    setLayer(layers.length)
  }

  const dropLayer = (i: number) => {
    editLayers((list) => (list.length <= 1 ? [{ fxid: 'none', ep: null }] : list.filter((_, n) => n !== i)))
    setLayer(Math.max(0, i - 1))
  }

  const setParam = (k: string, v: number | string) => {
    editLayers((list) => {
      const next = [...list]
      const i = Math.min(at, next.length - 1)
      next[i] = { ...next[i], ep: { ...(next[i].ep || (defaults(next[i].fxid) as Params)), [k]: v } }
      return next
    })
  }

  return (
    <aside className="panel">
      <div className="panel-tabs">
        <button data-on={tab === 'effect' || undefined} onClick={() => onTab('effect')}>
          Effect
        </button>
        <button data-on={tab === 'adjust' || undefined} onClick={() => onTab('adjust')}>
          Adjust
        </button>
        <button data-on={tab === 'looks' || undefined} onClick={() => onTab('looks')}>
          Looks
        </button>
      </div>

      {/* Held rather than pressed, so it cannot be left switched on: a mode
          that hides your work is the worst kind of mode to be in by accident.
          Under the tabs rather than inside one, because the question it
          answers — is this better than nothing — is the same question whether
          you are choosing an effect or moving a slider. */}
      {tab !== 'looks' && (
        <div className="panel-compare">
          <button
            data-on={comparing || undefined}
            title={titleFor('original')}
            aria-label={nameFor('original')}
            aria-pressed={comparing}
            onPointerDown={(e) => { e.preventDefault(); holdOriginal() }}
            onPointerUp={releaseOriginal}
            onPointerLeave={releaseOriginal}
            onPointerCancel={releaseOriginal}
            /* A keyboard cannot hold a button down, so for one this is a
               toggle — and it says which it is doing through aria-pressed. */
            onKeyDown={(e) => {
              if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); holdOriginal() }
            }}
            onKeyUp={(e) => {
              if (e.key === ' ' || e.key === 'Enter') releaseOriginal()
            }}
            onBlur={releaseOriginal}
          >
            <IconEye />
            <span>{comparing ? 'Showing the original' : 'Hold to see the original'}</span>
            <em>{KEYS.original.hint}</em>
          </button>
        </div>
      )}

      {tab === 'looks' && (
        <LooksTab
          ids={ids}
          fx={fx}
          previewKey={previewKey}
          onApplied={(n) => n > 0 && say(n === 1 ? 'Look applied' : `Look applied to ${n} cards`)}
        />
      )}

      {tab === 'effect' && !shadeable && (
        <div className="panel-scroll">
          <section className="fx-controls">
            <h4>Effects unavailable</h4>
            <p className="panel-note">{why}</p>
            <button className="ghost" onClick={() => onTab('adjust')}>
              Open Adjust
            </button>
          </section>
        </div>
      )}

      {tab === 'effect' && shadeable && (
        <div className="panel-scroll">
          {/* Sixty four of them in a three across grid is more than anyone can
              scan, and knowing the name is faster than finding the picture. */}
          <div className="fx-find">
            <IconSearch />
            <input
              value={find}
              placeholder="Find an effect"
              spellCheck={false}
              onChange={(e) => setFind(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') setFind('')
                e.stopPropagation()
              }}
            />
            {!!find && (
              <button className="fx-find-clear" onClick={() => setFind('')} title="Clear">
                ×
              </button>
            )}
          </div>

          {/* A card's effects, in the order they are applied. One at a time is
              what the grid and the sliders below work on, so which one that is
              has to be something you can see and point at. Hidden entirely
              until there is more than one, because a board where nobody has
              stacked anything should look exactly as it did. */}
          {(layers.length > 1 || shadeable) && (
            <div className="fx-stack" role="group" aria-label="Effects on this card">
              {layers.map((l, i) => (
                <span key={i} className="fx-layer" data-on={i === at || undefined}>
                  <button onClick={() => setLayer(i)} title={`Work on ${(BY_ID[l.fxid] || BY_ID.none).name}`}>
                    <i>{i + 1}</i>
                    {(BY_ID[l.fxid] || BY_ID.none).name}
                  </button>
                  {/* How many times this one runs, each pass reading what the
                      pass before it drew. One is an effect; more is feedback,
                      and it is where a kaleidoscope starts recursing and a
                      warp starts spiralling. Shown as a count rather than as a
                      running loop because these are still pictures: a card has
                      to look the same next time it is opened. */}
                  {l.fxid !== 'none' && (
                    <button
                      className="fx-layer-n"
                      title={`Run ${(BY_ID[l.fxid] || BY_ID.none).name} again on what it drew`}
                      aria-label={`${(BY_ID[l.fxid] || BY_ID.none).name} runs ${l.n || 1} time${(l.n || 1) === 1 ? '' : 's'}. Click to run it once more.`}
                      onClick={() =>
                        editLayers((list) =>
                          list.map((x, k) =>
                            k === i ? { ...x, n: ((x.n || 1) % REPEATS) + 1 } : x
                          )
                        )
                      }
                    >
                      ×{l.n || 1}
                    </button>
                  )}
                  {layers.length > 1 && (
                    <button
                      className="fx-layer-off"
                      aria-label={`Take off ${(BY_ID[l.fxid] || BY_ID.none).name}`}
                      onClick={() => dropLayer(i)}
                    >
                      ×
                    </button>
                  )}
                </span>
              ))}
              {layers.length < MAX_LAYERS && layers[0].fxid !== 'none' && (
                <button className="fx-layer-add" onClick={addLayer} title="Put another effect on top">
                  + Add
                </button>
              )}
            </div>
          )}

          {found.map((g) => (
            <section key={g.name} className="fx-group">
              <h4>{g.name}</h4>
              <div className="fx-grid">
                {g.items.map((e) => (
                  <FxThumb
                    key={e.id}
                    effectId={e.id}
                    name={e.name}
                    mediaKey={previewKey}
                    active={layers[at].fxid === e.id}
                    onPick={() => setEffect(e.id)}
                  />
                ))}
              </div>
            </section>
          ))}
          {!found.length && <p className="panel-note">No effect is called that.</p>}

          {!!spec.controls.length && (
            <section className="fx-controls">
              <h4>{spec.name}</h4>
              {/* An effect that reads two pictures, with only one to read.
                  It still does something — it reads the card's own pixels —
                  but what it is for is invisible until the wire is there, so
                  the panel says so rather than leaving you to guess why it
                  looks like a weaker version of an effect you already have. */}
              {spec.group === 'Pair' && (
                <p className="fx-hint">
                  {fed
                    ? 'Reading the card wired into this one. Draw another wire to read a different card.'
                    : 'Reads a second picture: drag from this card\u2019s edge to another one, and it will read that. On its own it reads itself.'}
                </p>
              )}
              {spec.controls.map((c) => (
                <ControlRow
                  key={c.k}
                  control={c}
                  value={(layers[at].ep || (defaults(layers[at].fxid) as Params))[c.k]}
                  onChange={(v) => setParam(c.k, v)}
                />
              ))}
              <button
                className="ghost"
                onClick={() =>
                  editLayers((list) => {
                    const next = [...list]
                    const i = Math.min(at, next.length - 1)
                    next[i] = { ...next[i], ep: defaults(next[i].fxid) as Params }
                    return next
                  })
                }
              >
                Reset {spec.name}
              </button>
            </section>
          )}
        </div>
      )}

      {tab === 'adjust' && (
        <div className="panel-scroll">
          {/* First, on a card that has one, because it is the thing the card
              is: everything below adjusts a picture, and this decides which
              picture there is to adjust. */}
          {primary.kind === 'model' && <ModelSection it={primary} fed={fed} />}

          <section className="fx-controls">
            <h4>Presets</h4>
            <div className="preset-row">
              {PRESETS.map((p) => (
                <button key={p.id} data-on={fx.preset === p.id || undefined} onClick={() => patchFx({ ...resetTone(), ...p.vals, preset: p.id })}>
                  {p.name}
                </button>
              ))}
            </div>
          </section>

          <section className="fx-controls">
            <h4>Tone</h4>
            <Slider label="Exposure" def={ADJUST_0.exp} min={-100} max={100} step={1} value={fx.exp} onChange={(v) => patchFx({ exp: v, preset: 'custom' })} />
            <Slider label="Contrast" def={ADJUST_0.con} min={-100} max={100} step={1} value={fx.con} onChange={(v) => patchFx({ con: v, preset: 'custom' })} />
            <Slider label="Saturation" def={ADJUST_0.sat} min={0} max={200} step={1} value={fx.sat} onChange={(v) => patchFx({ sat: v, preset: 'custom' })} />
            <Slider label="Warmth" def={ADJUST_0.warm} min={-100} max={100} step={1} value={fx.warm} onChange={(v) => patchFx({ warm: v, preset: 'custom' })} />
            <Slider label="Blur" def={ADJUST_0.blur} min={0} max={100} step={1} value={fx.blur} onChange={(v) => patchFx({ blur: v, preset: 'custom' })} />
            <Slider label="Grain" def={ADJUST_0.grain} min={0} max={100} step={1} value={fx.grain} onChange={(v) => patchFx({ grain: v, preset: 'custom' })} />
          </section>

          <section className="fx-controls">
            <h4>Frame</h4>
            {/* Nobody frames a photograph by typing coordinates into two
                boxes, and the gesture that does it properly is a modifier
                drag, which announces itself to nobody. So it is said here,
                next to the two numbers it writes. */}
            <p className="fx-hint">Alt-drag the picture to move it in its card, Alt-scroll to scale it.</p>
            <Slider label="Zoom" def={ADJUST_0.zoom} min={1} max={3} step={0.01} value={fx.zoom} onChange={(v) => patchFx({ zoom: v })} />
            <Slider label="Offset X" def={ADJUST_0.ox} min={-50} max={50} step={1} value={fx.ox} onChange={(v) => patchFx({ ox: v })} />
            <Slider label="Offset Y" def={ADJUST_0.oy} min={-50} max={50} step={1} value={fx.oy} onChange={(v) => patchFx({ oy: v })} />
            <Slider label="Rotate" def={ADJUST_0.rot} min={-180} max={180} step={1} value={fx.rot} onChange={(v) => patchFx({ rot: v })} />
            <div className="flip-row">
              <button data-on={fx.fh || undefined} onClick={() => patchFx({ fh: !fx.fh })}>
                Flip H
              </button>
              <button data-on={fx.fv || undefined} onClick={() => patchFx({ fv: !fx.fv })}>
                Flip V
              </button>
            </div>
          </section>

          {/* How this card sits with the ones under it, which is the one part
              of the panel that is about two pictures rather than one — and
              most of what a moodboard is for. A texture over a photograph, a
              wordmark knocked out of a colour field, a scan held at a quarter
              strength over the thing it is being compared with. */}
          <section className="fx-controls">
            <h4>Layer</h4>
            <p className="fx-hint">How this card mixes with whatever is underneath it.</p>
            <Slider label="Opacity" def={ADJUST_0.op} min={0} max={100} step={1} unit="%" value={fx.op ?? 100} onChange={(v) => patchFx({ op: v })} />
            {/* Drawn like the presets above and named apart from them: a
                preset is a starting point you move on from, and a blend mode
                is a choice that stays chosen. */}
            <div className="blend-row">
              {BLENDS.map((b) => (
                <button
                  key={b.id}
                  data-on={blendOf(fx.mix) === b.id || undefined}
                  onClick={() => patchFx({ mix: b.id }, true)}
                >
                  {b.name}
                </button>
              ))}
            </div>
          </section>

          <button className="ghost" onClick={() => patchFx({ ...resetTone(), preset: 'none' })}>
            Reset adjustments
          </button>
        </div>
      )}
    </aside>
  )
}

/* ---------------------------------------------------------------------------
 * A model, on its stand.
 *
 * Two things, and they are different in kind. The first is where the camera
 * is, which is a picture decision and belongs with the other picture
 * decisions. The second is the list of materials the file declares — and that
 * is not a control at all, it is the model telling you what it is made of.
 *
 * Nothing here is guessed. A glTF says which materials it has, which texture
 * slots each one fills and which UV set those textures read; this is that
 * list, read off the file and shown. What it is for is the button at the end
 * of each row: a card wired into this one can be handed to one material, and
 * the model comes back wearing it — the label on the tin, the print on the
 * fabric, the sticker on the case. A moodboard where the reference lands on
 * the thing being designed, instead of beside it.
 * ------------------------------------------------------------------------- */

/* ---------------------------------------------------------------------------
 * A sound, being worked on.
 *
 * The same panel the pictures get, for the one medium on this board that had
 * nothing: a chain of effects in the order they are applied, the controls for
 * whichever one you are looking at, and a way off again.
 *
 * It is a separate component rather than a fourth tab because almost nothing
 * carries over. A sound has no shader, no tone, no crop and no blend mode, and
 * a panel that showed those greyed out would be a panel mostly about what this
 * card cannot do.
 *
 * There is no preview strip. Twelve thumbnails is how you choose between
 * pictures and there is no such thing for a sound — you have to hear it — so
 * the list is names and the card plays.
 * ------------------------------------------------------------------------- */

function SoundPanel({ ids, id, say }: { ids: string[]; id: string; say: (msg: string) => void }) {
  const it = useItem(id)
  const [at, setAt] = useState(0)
  const [busy, setBusy] = useState(false)
  const chain = chainOf(it)
  const here = Math.min(at, Math.max(0, chain.length - 1))
  const layer = chain[here]
  const spec = layer ? SOUND_BY_ID[layer.fxid] : undefined

  if (!it) return null

  /* Every one of these renders the whole chain, so they are awaited and the
     panel says it is working. A sound is not a shader: it is decoded, run
     through a graph and written back, which is a moment rather than a
     frame. */
  const run = async (fn: () => Promise<void>) => {
    setBusy(true)
    try { await fn() } finally { setBusy(false) }
  }

  return (
    <aside className="panel">
      <div className="panel-tabs">
        <button data-on>Sound</button>
      </div>

      <div className="panel-scroll">
        <section className="fx-controls">
          <h4>{it.name || 'Sound'}</h4>
          <p className="fx-hint">
            {chain.length
              ? 'Rendered and saved, so the card plays the treatment and draws it. The file you dropped is still underneath.'
              : 'Put something on it. The file you dropped is never written over, so taking it all off puts the original back.'}
          </p>

          {!!chain.length && (
            <div className="fx-stack" role="group" aria-label="Effects on this sound">
              {chain.map((l, i) => (
                <span key={i} className="fx-layer" data-on={i === here || undefined}>
                  <button onClick={() => setAt(i)} title={`Work on ${(SOUND_BY_ID[l.fxid] || { name: 'Nothing' }).name}`}>
                    <i>{i + 1}</i>
                    {(SOUND_BY_ID[l.fxid] || { name: 'Nothing' }).name}
                  </button>
                  <button
                    className="fx-layer-off"
                    aria-label={`Take off ${(SOUND_BY_ID[l.fxid] || { name: 'that' }).name}`}
                    onClick={() => void run(async () => { await dropSoundLayer(ids, i); setAt(Math.max(0, i - 1)) })}
                  >
                    ×
                  </button>
                </span>
              ))}
              {chain.length < MAX_CHAIN && (
                <button
                  className="fx-layer-add"
                  onClick={() => void run(async () => { await addSoundLayer(ids); setAt(chain.length) })}
                >
                  + Add
                </button>
              )}
            </div>
          )}
          {(busy || treating(id)) && <p className="fx-hint">Rendering\u2026</p>}
        </section>

        {soundGroups().map((g) => (
          <section key={g.name} className="fx-group">
            <h4>{g.name}</h4>
            <div className="snd-grid">
              {g.items.map((e) => (
                <button
                  key={e.id}
                  className="snd-pick"
                  data-on={layer?.fxid === e.id || undefined}
                  title={e.about}
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      await setSoundEffect(ids, chain.length ? here : 0, e.id)
                      say(ids.length > 1 ? `${e.name} on ${ids.length} sounds` : e.name)
                    })
                  }
                >
                  <b>{e.name}</b>
                  <em>{e.about}</em>
                </button>
              ))}
            </div>
          </section>
        ))}

        {!!spec && (
          <section className="fx-controls">
            <h4>{spec.name}</h4>
            {spec.controls.map((c) => (
              <ControlRow
                key={c.k}
                control={c}
                value={(layer!.ep || soundDefaults(layer!.fxid))[c.k]}
                onChange={(v) => void run(() => setSoundParam(ids, here, c.k, v))}
              />
            ))}
          </section>
        )}

        {!!chain.length && (
          <button className="ghost" disabled={busy} onClick={() => void run(async () => { await clearSound(ids); setAt(0) })}>
            Back to the original
          </button>
        )}
      </div>
    </aside>
  )
}

const DEG = '\u00b0'

/* What the file says this material is. */
const partWhat = (p: Part): string => {
  const maps = p.maps.length ? p.maps.join(', ') : 'no textures'
  /* -1 means the mesh was never unwrapped, so there is nowhere on it for a
     picture to sit — which is a different answer from "not textured yet" and
     the only one that stops the button below being worth pressing. */
  const uv = p.uv.includes(-1) ? 'not unwrapped' : 'UV ' + p.uv.join(' and ')
  return `${maps} \u00b7 ${uv}`
}

function ModelSection({ it, fed }: { it: Item; fed?: string }) {
  const stage = stageOf(it)
  /* A sweep of the slider is one step of undo, like every other sweep in this
     panel — and unlike them it is one card, because where a camera stands is
     about the particular thing it is pointed at. */
  const set = (patch: Partial<Stage>) => {
    store.beginGesture(600)
    void turnTo(it.id, { ...stage, ...patch })
  }
  const parts = it.parts || []
  return (
    <>
      <section className="fx-controls">
        <h4>View</h4>
        <p className="fx-hint">Alt-drag the model to turn it, Alt-scroll to move in and out.</p>
        <Slider label="Turn" def={STAGE_0.yaw} min={-180} max={180} step={1} unit={DEG} value={stage.yaw} onChange={(v) => set({ yaw: v })} />
        <Slider label="Tilt" def={STAGE_0.pitch} min={-PITCH} max={PITCH} step={1} unit={DEG} value={stage.pitch} onChange={(v) => set({ pitch: v })} />
        <Slider label="Distance" def={STAGE_0.dist} min={DIST.min} max={DIST.max} step={0.05} value={stage.dist} onChange={(v) => set({ dist: v })} />
      </section>

      {!!parts.length && (
        <section className="fx-controls">
          <h4>Materials</h4>
          <p className="fx-hint">
            {fed
              ? 'Hand the card wired into this one to a material and the model wears it \u2014 as it looks now, effects and all. Press Wear again after changing it.'
              : 'Drag a wire from another card to this one, and you can hand its picture to any of these.'}
          </p>
          <ul className="part-list">
            {parts.map((p) => {
              const worn = it.skins?.[p.name]
              const unwrapped = !p.uv.includes(-1)
              return (
                <li key={p.name} className="part" data-worn={worn ? '' : undefined}>
                  <i className="part-tint" style={{ background: p.tint }} aria-hidden="true" />
                  <span className="part-of">
                    <b>{p.name}</b>
                    <em>{partWhat(p)}</em>
                  </span>
                  {/* Wear stays there once something is worn, because pressing
                      it again is how a material catches up with a card that
                      has been worked on since. */}
                  <span className="part-do">
                    <button
                      className="ghost"
                      disabled={!fed || !unwrapped}
                      title={
                        !unwrapped
                          ? `${p.name} has no UVs, so a picture has nowhere to sit on it.`
                          : !fed
                            ? 'Wire a card into this one first.'
                            : worn
                              ? `Put the wired card on ${p.name} again, as it looks now`
                              : `Put the wired card on ${p.name}, as it looks now`
                      }
                      onClick={() => void wearSkin(it.id, p.name)}
                    >
                      {worn ? 'Again' : 'Wear'}
                    </button>
                    {!!worn && (
                      <button className="ghost" onClick={() => void takeOffSkin(it.id, p.name)}>
                        Take off
                      </button>
                    )}
                  </span>
                </li>
              )
            })}
          </ul>
        </section>
      )}
    </>
  )
}

/* Everything the Adjust tab writes, back to nothing. Spread from the defaults
 * rather than typed out again, since a copy of a list is a copy that gets left
 * behind: this one had already lost the two the panel learned last. */
const resetTone = () => ({ ...ADJUST_0 })

/* A preview is a real render of the selected image through that effect, at
 * thumbnail size, scheduled behind the visible cards. */
const FxThumb = memo(function FxThumb({
  effectId,
  name,
  mediaKey,
  active,
  onPick,
}: {
  effectId: string
  name: string
  mediaKey?: string
  active: boolean
  onPick: () => void
}) {
  const ready = useSourceReady(mediaKey)
  const params = useMemo(() => defaults(effectId) as Params, [effectId])
  return (
    <button className="fx-thumb" data-on={active || undefined} onClick={onPick} title={name}>
      <span className="fx-thumb-img">
        {ready && mediaKey ? (
          <FxCanvas
            id={`thumb:${effectId}:${mediaKey}`}
            mediaKey={mediaKey}
            effectId={effectId}
            params={params}
            seed={7}
            w={132}
            h={99}
            /* Large distance keeps previews behind on-board cards in the queue. */
            distance={1e6}
          />
        ) : (
          <span className="fx-thumb-blank" />
        )}
      </span>
      <span className="fx-thumb-name">{name}</span>
    </button>
  )
})

function ControlRow({ control, value, onChange }: { control: Control; value: number | string | undefined; onChange: (v: number | string) => void }) {
  if (isColor(control)) {
    return (
      <label className="ctl ctl-color">
        <span>{control.label}</span>
        <input type="color" value={(value as string) || control.def} onChange={(e) => onChange(e.target.value)} />
      </label>
    )
  }
  if (isEnum(control)) {
    const v = typeof value === 'number' ? value : control.def
    return (
      <div className="ctl ctl-enum">
        <span>{control.label}</span>
        <div className="seg">
          {control.options.map((o, i) => (
            <button key={o} data-on={Math.round(v) === i || undefined} onClick={() => onChange(i)}>
              {o}
            </button>
          ))}
        </div>
      </div>
    )
  }
  return (
    <Slider
      label={control.label}
      min={control.min}
      max={control.max}
      step={control.step}
      unit={control.unit}
      def={control.def}
      value={typeof value === 'number' ? value : control.def}
      onChange={onChange}
    />
  )
}

/* A slider whose number can be typed into.
 *
 * Every control in this panel was a bare range input with a read-only figure
 * beside it, which meant a setting could not be entered exactly, could not be
 * copied, and could not be matched across two cards by hand. A setting you
 * cannot enter is a setting you cannot repeat, and repeating a treatment is
 * most of what this panel is for.
 *
 * Three ways in now: drag it, type it, or double-click to put it back where it
 * started. Shift with an arrow key moves in tens, because a range of two
 * hundred in steps of one is forty presses from end to end otherwise. */
function Slider({
  label, min, max, step, value, unit, def, onChange,
}: {
  label: string
  min: number
  max: number
  step: number
  value: number
  unit?: string
  /* What double-clicking puts it back to. */
  def?: number
  onChange: (v: number) => void
}) {
  const id = useId()
  /* What is in the box while it is being typed in, which is not a number yet:
     halfway through "-1" is "-", and turning that into a number every
     keystroke would fight whoever is typing it. */
  const [typing, setTyping] = useState<string | null>(null)
  /* Escape blurs the box, and a blur is the other way a figure is committed.
     Without this the escape would put the box back and then the blur would
     immediately commit what it was put back from. */
  const abandoned = useRef(false)
  const shown = step < 1 ? value.toFixed(2) : String(Math.round(value))

  const commit = (raw: string) => {
    setTyping(null)
    const n = parseFloat(raw)
    if (!Number.isFinite(n)) return
    const clamped = Math.min(max, Math.max(min, n))
    if (clamped !== value) onChange(clamped)
  }

  const nudge = (by: number) => onChange(Math.min(max, Math.max(min, value + by)))

  return (
    <div className="ctl">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        onDoubleClick={() => def !== undefined && onChange(def)}
        onKeyDown={(e) => {
          if (!e.shiftKey) return
          if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') { e.preventDefault(); nudge(-step * 10) }
          else if (e.key === 'ArrowRight' || e.key === 'ArrowUp') { e.preventDefault(); nudge(step * 10) }
        }}
      />
      <input
        className="ctl-num"
        type="text"
        inputMode="decimal"
        aria-label={`${label}${unit ? ` in ${unit}` : ''}`}
        value={typing ?? `${shown}${unit || ''}`}
        /* Selected, so typing replaces it, but not copied into state: a write
           on focus is a write racing whatever put the focus there, and the
           value on show is already the right thing to be editing. The unit
           comes with it and parses away again. */
        onFocus={(e) => e.currentTarget.select()}
        onChange={(e) => setTyping(e.target.value)}
        onBlur={(e) => {
          if (abandoned.current) { abandoned.current = false; setTyping(null); return }
          commit(e.target.value)
        }}
        onKeyDown={(e) => {
          /* The board listens for keys on the window and already stands down
             for an input, but the panel is inside a sheet on a narrow window
             and this is cheaper than finding out. */
          e.stopPropagation()
          if (e.key === 'Enter') { commit(e.currentTarget.value); e.currentTarget.blur() }
          else if (e.key === 'Escape') { abandoned.current = true; setTyping(null); e.currentTarget.blur() }
        }}
      />
    </div>
  )
}

export { EFFECTS }
