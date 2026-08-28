import type { Params } from './types'

/* Messages between the board and the render worker. Deliberately flat and
 * transferable-friendly: nothing here needs structured-clone of anything big
 * except the ImageBitmaps, which are transferred rather than copied. */

export interface PutSourceMsg {
  t: 'put'
  /* Cache identity. Stable per media item, so a source uploads to the GPU once. */
  key: string
  bitmap: ImageBitmap
}

export interface DropSourceMsg {
  t: 'drop'
  key: string
}

export interface RenderMsg {
  t: 'render'
  /* Correlates the reply with the requesting card. */
  id: string
  jobId: number
  key: string
  effectId: string
  /* Effects after the first, in order. Absent for the ordinary card. */
  stack?: { effectId: string; params: Params | null }[]
  params: Params | null
  width: number
  height: number
  seed: number
}

/* A live video frame: the bitmap is transferred, used once, and closed. */
export interface RenderLiveMsg {
  t: 'live'
  id: string
  jobId: number
  bitmap: ImageBitmap
  effectId: string
  /* Effects after the first, in order. Absent for the ordinary card. */
  stack?: { effectId: string; params: Params | null }[]
  params: Params | null
  width: number
  height: number
  seed: number
}

export interface WarmMsg {
  t: 'warm'
  ids: string[]
}

export interface StatsMsg {
  t: 'stats'
}

export type ToWorker = PutSourceMsg | DropSourceMsg | RenderMsg | RenderLiveMsg | WarmMsg | StatsMsg

export interface DoneMsg {
  t: 'done'
  id: string
  jobId: number
  bitmap: ImageBitmap
  width: number
  height: number
}

export interface FailMsg {
  t: 'fail'
  id: string
  jobId: number
  reason: string
}

export interface ReadyMsg {
  t: 'ready'
  ok: boolean
}

export interface StatsReplyMsg {
  t: 'stats'
  textures: number
  textureBytes: number
  programs: number
}

export type FromWorker = DoneMsg | FailMsg | ReadyMsg | StatsReplyMsg
