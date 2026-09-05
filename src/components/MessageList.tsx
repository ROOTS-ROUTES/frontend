import { useEffect, useRef, useState } from 'react'
import { ArrowDown } from 'lucide-react'
import type { ChatMessage } from '../types'
import Message from './Message'

interface Props {
  messages: ChatMessage[]
  streaming: boolean
  streamingAsstId: string | null
}

export default function MessageList({ messages, streaming, streamingAsstId }: Props) {
  const scrollerRef = useRef<HTMLDivElement>(null)
  const [pinned, setPinned] = useState(true)

  const lastMessage = messages[messages.length - 1]
  const lastChanged = lastMessage ? lastMessage.content.length : 0

  useEffect(() => {
    const el = scrollerRef.current
    if (el && pinned) el.scrollTop = el.scrollHeight
  }, [messages, lastChanged, pinned])

  const onScroll = () => {
    const el = scrollerRef.current
    if (!el) return
    setPinned(el.scrollHeight - el.scrollTop - el.clientHeight < 70)
  }

  const jumpToBottom = () => {
    const el = scrollerRef.current
    if (!el) return
    el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
    setPinned(true)
  }

  return (
    <div className="msg-scroller" ref={scrollerRef} onScroll={onScroll}>
      <div className="msg-stack">
        {messages.map((m, i) => (
          <Message
            key={m.id}
            msg={m}
            streaming={
              i === messages.length - 1 &&
              streaming &&
              m.role === 'assistant' &&
              m.id === streamingAsstId
            }
            showAvatar={i === 0 || messages[i - 1].role !== 'assistant'}
          />
        ))}
      </div>
      {!pinned && (
        <button className="jump-btn" onClick={jumpToBottom} title="Jump to latest">
          <ArrowDown size={16} />
        </button>
      )}
    </div>
  )
}
