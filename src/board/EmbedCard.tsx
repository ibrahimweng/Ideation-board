import { GRAIN_URL } from './grain'

/* ---------------------------------------------------------------------------
 * A YouTube or Vimeo card.
 *
 * The player runs in an iframe, which means its pixels belong to the provider
 * and nothing on this side can read them. Shaders are therefore off for these
 * cards. Tone, framing and grain are not: those are CSS, applied to the box
 * the player is painted into, so a YouTube video can still be graded, cropped
 * and rotated with the rest of the board.
 *
 * The shield is what makes the card draggable. An iframe swallows every
 * pointer event it receives, so without it a click on the picture would reach
 * the player and never the board. With it, the first click selects the card as
 * any other card would, and once selected the player takes over and can be
 * played.
 *
 * Which left the card with nowhere to be grabbed once it was selected. The
 * name plate was supposed to be that place and never could be: it is drawn
 * with pointer-events off, because it is a label rather than a control, so
 * every point on a selected player belonged to the player and the card could
 * only be moved by clicking away to deselect it first. The grip is a strip the
 * height of the plate, over the plate, which is the one part of a video nobody
 * needs to click.
 * ------------------------------------------------------------------------- */

interface Props {
  embed: string
  name: string
  selected: boolean
  filter: string
  frame: string
  grain: number
}

export function EmbedCard({ embed, name, selected, filter, frame, grain }: Props) {
  return (
    <div className="card-body" style={{ filter: filter || undefined }}>
      <div className="card-frame" style={{ transform: frame || undefined }}>
        <iframe
          className="media embed-frame"
          src={embed}
          title={name}
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          referrerPolicy="strict-origin-when-cross-origin"
          allowFullScreen
          loading="lazy"
        />
        {selected ? <div className="embed-grip" title={name} /> : <div className="embed-shield" />}
      </div>
      {grain > 0 && <div className="grain" style={{ opacity: grain / 100, backgroundImage: GRAIN_URL }} />}
    </div>
  )
}
