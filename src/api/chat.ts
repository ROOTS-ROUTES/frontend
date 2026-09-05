// ─────────────────────────────────────────────────────────────────────────────
//  RAG INTEGRATION POINT
//
//  1. Spin up your own RAG server (FastAPI, LangChain, LlamaIndex, Vercel AI
//     gateway, your vector store endpoint, ...) on http://localhost:8000
//     (or change the /api target in vite.config.ts).
//
//  2. Expected contract  —  POST /api/chat
//        request:  { model: string, messages: { role, content }[], stream: true }
//        response: one of
//          a) SSE stream of lines:  data: {"token": "..."}   ...   data: [DONE]
//          b) plain-text body (streamed chunks)
//          c) JSON: { "answer": "..." }
//
//  3. Copy .env.example to .env and set VITE_USE_MOCK=false.
//     Everything in this file below that talks to the backend lives here, so
//     this is the only file you need to touch when wiring your RAG in.
// ─────────────────────────────────────────────────────────────────────────────

import type { ChatMessage } from '../types'
import { mockStream } from './mock'

export const USE_MOCK: boolean = import.meta.env.VITE_USE_MOCK !== 'false'

export const RAG_CONFIG = {
  endpoint: '/api/chat',
  model: 'satquery-rag',
  maxTokens: 1024,
  temperature: 0.2,
}

const SSE_DONE = '[DONE]'

/**
 * Sends the conversation history to the RAG backend and invokes `onDelta`
 * for every chunk of the answer as it arrives. Resolves when the stream ends.
 * Pass an AbortSignal to support "stop generating".
 */
export async function streamChat(
  history: ChatMessage[],
  onDelta: (delta: string) => void,
  signal: AbortSignal,
): Promise<void> {
  if (USE_MOCK) {
    return mockStream(history, onDelta, signal)
  }

  const res = await fetch(RAG_CONFIG.endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: RAG_CONFIG.model,
      messages: history.map((m) => ({
        role: m.role,
        content: m.content,
        ...(m.aoi ? { aoi: m.aoi, ...(m.imagery ? { imagery: m.imagery } : {}) } : {}),
      })),
      stream: true,
      max_tokens: RAG_CONFIG.maxTokens,
      temperature: RAG_CONFIG.temperature,
    }),
    signal,
  })

  if (!res.ok) {
    throw new Error(`RAG backend error: ${res.status} ${res.statusText}`)
  }

  const contentType = res.headers.get('content-type') ?? ''

  // Non-streamed JSON answer
  if (contentType.includes('application/json') && !contentType.includes('stream')) {
    const json = (await res.json()) as { answer?: string; text?: string; content?: string }
    const answer = json.answer ?? json.text ?? json.content ?? ''
    if (answer) onDelta(answer)
    return
  }

  if (!res.body) return

  // Streamed response: SSE (data: ...) or raw text chunks
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })

    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''

    for (const rawLine of lines) {
      const line = rawLine.trim()
      if (!line) continue
      if (line === SSE_DONE || line === `data: ${SSE_DONE}`) return
      if (line.startsWith('data:')) {
        const payload = line.slice(5).trim()
        try {
          const json = JSON.parse(payload)
          const chunk: string = json.token ?? json.content ?? json.delta ?? json.text ?? ''
          if (chunk) onDelta(chunk)
        } catch {
          onDelta(payload)
        }
      } else {
        onDelta(line + '\n')
      }
    }
  }
}
