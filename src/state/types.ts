import type { FxState } from '../engine/types'

export type Kind = 'image' | 'video' | 'audio' | 'note' | 'link' | 'file' | 'label' | 'section'

export interface Item {
  id: string
  kind: Kind
  x: number
  y: number
  w: number
  h: number
  z: number
  /* Media identity: the key under which the blob is stored and the GPU
   * texture is cached. Stable for the life of the item. */
  media?: string
  name?: string
  mime?: string
  /* Object URL for the current session. Not persisted. */
  src?: string
  poster?: string
  text?: string
  url?: string
  color?: string
  tag?: string | null
  fx: FxState
  /* Natural pixel size, when known. */
  nw?: number
  nh?: number
}

export interface Board {
  id: string
  name: string
  items: Item[]
  view: { x: number; y: number; z: number }
  updated: number
}

export const TYPE_LABEL: Record<Kind, string> = {
  image: 'IMG', video: 'VID', audio: 'AUD', note: 'TXT',
  link: 'URL', file: 'DOC', label: 'LBL', section: 'SEC',
}

export const TAGS = [
  { id: 'red', c: '#E5484D' },
  { id: 'amber', c: '#EFA31D' },
  { id: 'green', c: '#3F8F63' },
  { id: 'blue', c: '#2F6FEB' },
  { id: 'violet', c: '#7A5AF8' },
]

export const SWATCH = ['#111114', '#F5F2EA', '#E5484D', '#F2C14E', '#3F8F63', '#2F6FEB', '#6B2BC9', '#3BE0D0']
