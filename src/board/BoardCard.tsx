import { useEffect, useState } from 'react'
import { loadSummary, onSummary, peekSummary } from '../state/boards'
import type { Summary } from '../state/boards'
import { urlForKey } from '../store/media'

/* ---------------------------------------------------------------------------
 * A card that opens another board.
 *
 * What it shows is read from the stored record rather than from anything
 * loaded: a count and the first few pictures inside. The record is read once
 * and cached, and the cache is dropped whenever that board is written, so a
 * card is up to date the moment you come back out of it without either board
 * knowing about the other.
 * ------------------------------------------------------------------------- */

function useSummary(boardId: string): Summary | null {
  const [s, setS] = useState<Summary | null>(() => peekSummary(boardId) || null)
  useEffect(() => {
    let live = true
    setS(peekSummary(boardId) || null)
    void loadSummary(boardId).then((v) => live && setS(v))
    const off = onSummary((id) => {
      if (!live || id !== boardId) return
      void loadSummary(boardId).then((v) => live && setS(v))
    })
    return () => {
      live = false
      off()
    }
  }, [boardId])
  return s
}

function useThumbUrls(keys: string[]): string[] {
  const sig = keys.join('|')
  const [urls, setUrls] = useState<string[]>([])
  useEffect(() => {
    let live = true
    if (!sig) {
      setUrls([])
      return
    }
    void Promise.all(sig.split('|').map((k) => urlForKey(k))).then((list) => {
      if (live) setUrls(list.filter(Boolean) as string[])
    })
    return () => {
      live = false
    }
  }, [sig])
  return urls
}

export function BoardCard({ boardId }: { boardId: string }) {
  const summary = useSummary(boardId)
  const thumbs = useThumbUrls(summary?.thumbs || [])
  const n = summary?.count ?? 0

  return (
    <div className="card-body board-body">
      {thumbs.length ? (
        <div className="board-thumbs" data-n={Math.min(thumbs.length, 4)}>
          {thumbs.slice(0, 4).map((u, i) => (
            <img key={i} src={u} alt="" draggable={false} />
          ))}
        </div>
      ) : (
        <div className="board-thumbs board-thumbs-empty" />
      )}
      <div className="board-meta">
        {summary ? (n === 1 ? '1 item' : `${n} items`) : ' '}
        <span>Double click to open</span>
      </div>
    </div>
  )
}
