import { useCallback, useEffect, useReducer, useRef, useState } from 'react'
import { streamChat, USE_MOCK } from '../api/chat'
import { captureEvidence, setEvidence } from '../lib/evidence'
import type { Aoi, ChatMessage, Conversation, ImageryConfig } from '../types'

const STORAGE_KEY = 'satqueryai:state:v1'

interface PersistedState {
  conversations: Conversation[]
  activeId: string | null
}

const uid = () => crypto.randomUUID()

function titleFrom(text: string): string {
  const clean = text.replace(/\s+/g, ' ').trim()
  return clean.length > 42 ? clean.slice(0, 42).trimEnd() + '…' : clean
}

function loadState(): PersistedState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return { conversations: [], activeId: null }
    const parsed = JSON.parse(raw) as PersistedState
    if (!Array.isArray(parsed.conversations)) return { conversations: [], activeId: null }
    return { conversations: parsed.conversations, activeId: parsed.activeId ?? null }
  } catch {
    return { conversations: [], activeId: null }
  }
}

export function useChat() {
  const [state, setState] = useState<PersistedState>(loadState)
  const [isStreaming, setIsStreaming] = useState(false)
  const [streamingConvId, setStreamingConvId] = useState<string | null>(null)
  const [, bump] = useReducer((x: number) => x + 1, 0)
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  }, [state])

  const active = state.conversations.find((c) => c.id === state.activeId)

  const patchConv = useCallback((convId: string, fn: (c: Conversation) => Conversation) => {
    setState((prev) => ({
      ...prev,
      conversations: prev.conversations.map((c) => (c.id === convId ? fn(c) : c)),
    }))
  }, [])

  const send = useCallback(
    async (raw: string, aoi?: Aoi, imagery?: ImageryConfig) => {
      const content = raw.trim()
      if (!content || isStreaming) return

      const userMsg: ChatMessage = {
        id: uid(),
        role: 'user',
        content,
        createdAt: Date.now(),
        ...(aoi ? { aoi, ...(imagery ? { imagery } : {}) } : {}),
      }
      const asstMsg: ChatMessage = { id: uid(), role: 'assistant', content: '', createdAt: Date.now() }

      const existing = state.conversations.find((c) => c.id === state.activeId)
      const convId = existing && existing.messages.length > 0 ? existing.id : uid()
      const history = [...(existing?.messages ?? []), userMsg]

      setState((prev) => {
        let conversations = prev.conversations.map((c) =>
          c.id === convId
            ? { ...c, messages: [...c.messages, userMsg, asstMsg], updatedAt: Date.now() }
            : c,
        )
        if (!conversations.some((c) => c.id === convId)) {
          conversations = [
            {
              id: convId,
              title: titleFrom(content),
              createdAt: Date.now(),
              updatedAt: Date.now(),
              messages: [userMsg, asstMsg],
            },
            ...conversations,
          ]
        }
        return { ...prev, activeId: convId, conversations }
      })

      const controller = new AbortController()
      abortRef.current = controller
      setIsStreaming(true)
      setStreamingConvId(convId)

      // Capture the input imagery as evidence for the reply, alongside the stream.
      if (aoi && imagery) {
        captureEvidence(aoi, imagery, controller.signal)
          .then((items) => {
            if (!controller.signal.aborted) {
              setEvidence(asstMsg.id, items)
              bump()
            }
          })
          .catch(() => {
            /* evidence is best-effort — the reply stands without it */
          })
      }

      let acc = ''
      const append = (delta: string) => {
        acc += delta
        const snapshot = acc
        patchConv(convId, (c) => ({
          ...c,
          messages: c.messages.map((m) => (m.id === asstMsg.id ? { ...m, content: snapshot } : m)),
        }))
      }

      const finalize = (aborted: boolean) => {
        setIsStreaming(false)
        setStreamingConvId(null)
        abortRef.current = null
        patchConv(convId, (c) => ({
          ...c,
          updatedAt: Date.now(),
          messages: c.messages.map((m) =>
            m.id === asstMsg.id && m.content.length === 0
              ? { ...m, content: aborted ? '*Response stopped.*' : '' }
              : m,
          ),
        }))
      }

      try {
        await streamChat(history, append, controller.signal)
        finalize(controller.signal.aborted)
      } catch (err) {
        if (!controller.signal.aborted) {
          patchConv(convId, (c) => ({
            ...c,
            messages: c.messages.map((m) =>
              m.id === asstMsg.id
                ? { ...m, content: m.content || 'Something went wrong talking to the RAG backend.', error: true }
                : m,
            ),
          }))
          console.error('[SatQueryAI] stream error:', err)
        }
        finalize(true)
      }
    },
    [isStreaming, state, patchConv],
  )

  const stop = useCallback(() => {
    abortRef.current?.abort()
  }, [])

  const newConversation = useCallback(() => {
    setState((prev) => ({ ...prev, activeId: null }))
  }, [])

  const selectConversation = useCallback((id: string) => {
    setState((prev) => ({ ...prev, activeId: id }))
  }, [])

  const deleteConversation = useCallback((id: string) => {
    abortRef.current?.abort()
    setIsStreaming(false)
    setStreamingConvId(null)
    setState((prev) => {
      const conversations = prev.conversations.filter((c) => c.id !== id)
      const activeId =
        prev.activeId === id ? (conversations[0]?.id ?? null) : prev.activeId
      return { conversations, activeId }
    })
  }, [])

  const clearAll = useCallback(() => {
    abortRef.current?.abort()
    setIsStreaming(false)
    setStreamingConvId(null)
    setState({ conversations: [], activeId: null })
  }, [])

  return {
    conversations: state.conversations,
    activeId: state.activeId,
    active,
    isStreaming,
    streamingConvId,
    isMock: USE_MOCK,
    send,
    stop,
    newConversation,
    selectConversation,
    deleteConversation,
    clearAll,
  }
}

export type ChatStore = ReturnType<typeof useChat>
