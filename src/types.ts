import type { Aoi } from './lib/basemap'

export type ImageryMode = 'optical' | 'sar' | 'bitemporal'

export interface ImageryRelease {
  release: number
  date: string
}

export interface ImageryConfig {
  mode: ImageryMode
  /** Optical / SAR: the dated archive release the scene comes from (undefined = current mosaic).
   *  Bi-temporal: T1 (earlier) and T2 (later) dated acquisitions. */
  t1?: ImageryRelease
  t2?: ImageryRelease
}

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  createdAt: number
  error?: boolean
  /** Map area picked via the AreaPicker; sent to the RAG backend with the message. */
  aoi?: Aoi
  /** Imagery configuration chosen in the map picker (single / cross-modal / bi-temporal). */
  imagery?: ImageryConfig
}

export interface Conversation {
  id: string
  title: string
  createdAt: number
  updatedAt: number
  messages: ChatMessage[]
}

export type { Aoi }
