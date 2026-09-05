import { Cpu, SatelliteDish } from 'lucide-react'
import type { Conversation } from '../types'
import MessageList from './MessageList'
import ChatInput from './ChatInput'
import Welcome from './Welcome'

interface Props {
  active: Conversation | undefined
  isStreaming: boolean
  streamingConvId: string | null
  isMock: boolean
  onSend: (text: string) => void
  onStop: () => void
}

export default function ChatPanel({
  active,
  isStreaming,
  streamingConvId,
  isMock,
  onSend,
  onStop,
}: Props) {
  const hasMessages = !!active && active.messages.length > 0

  return (
    <main className="chat">
      <header className="chat-header">
        <div className="chat-title">
          <SatelliteDish size={17} className="title-ico" />
          <span>{active ? active.title : 'New chat'}</span>
        </div>
        <div className={'chat-badge' + (isMock ? ' mock' : ' live')}>
          <Cpu size={13} strokeWidth={2.4} />
          {isMock ? 'Mock RAG' : 'RAG connected'}
        </div>
      </header>

      <div className="chat-scroll">
        <div className="chat-inner">
          {hasMessages ? (
            <MessageList
              messages={active!.messages}
              streaming={isStreaming && streamingConvId === active!.id}
              streamingAsstId={
                isStreaming && streamingConvId === active!.id
                  ? (active!.messages[active!.messages.length - 1]?.id ?? null)
                  : null
              }
            />
          ) : (
            <Welcome onPick={(p) => onSend(p)} />
          )}
        </div>
      </div>

      <ChatInput onSend={onSend} onStop={onStop} isStreaming={isStreaming} />
    </main>
  )
}
