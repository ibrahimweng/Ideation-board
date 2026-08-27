/* ---------------------------------------------------------------------------
 * A press that reached the board.
 *
 * While one is down, embedded players are made untargetable, so nothing that
 * begins out here can have its ending swallowed by one. An iframe is a
 * separate document and its pointer events never reach this one, so a drag
 * that crosses a player loses its own pointerup and never finishes.
 *
 * Every way of starting a drag needs this and each of them is somewhere else:
 * moving a card, resizing one, drawing a wire, panning, and pulling a marquee.
 * Three of the five were written before there were players on the board and
 * one of them returns before the others have begun, so the flag lives here
 * rather than in any of them.
 *
 * The release is hung on the window instead of being written into each path,
 * because a path that forgot would leave every player on the board dead to the
 * touch until the page was reloaded.
 * ------------------------------------------------------------------------- */

export function holdPress() {
  document.body.dataset.pressing = '1'
  const off = () => {
    delete document.body.dataset.pressing
    window.removeEventListener('pointerup', off)
    window.removeEventListener('pointercancel', off)
  }
  window.addEventListener('pointerup', off)
  window.addEventListener('pointercancel', off)
}
