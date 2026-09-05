import { useChat } from './hooks/useChat'
import { useTheme } from './hooks/useTheme'
import Sidebar from './components/Sidebar'
import ChatPanel from './components/ChatPanel'

export default function App() {
  const chat = useChat()
  const { theme, toggle } = useTheme()

  return (
    <>
      <div className="aurora" aria-hidden="true">
        <i />
        <i />
        <i />
      </div>
      <div className="app">
        <Sidebar
          conversations={chat.conversations}
          activeId={chat.activeId}
          isMock={chat.isMock}
          theme={theme}
          onToggleTheme={toggle}
          onNew={chat.newConversation}
          onOpen={chat.selectConversation}
          onDelete={chat.deleteConversation}
          onClearAll={chat.clearAll}
        />
        <ChatPanel
          active={chat.active}
          isStreaming={chat.isStreaming}
          streamingConvId={chat.streamingConvId}
          isMock={chat.isMock}
          onSend={chat.send}
          onStop={chat.stop}
        />
      </div>
    </>
  )
}
