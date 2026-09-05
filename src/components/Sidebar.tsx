import { MessageSquare, Moon, Plus, Sun, Trash2, X } from 'lucide-react'
import type { Conversation } from '../types'
import type { Theme } from '../hooks/useTheme'

interface Props {
  conversations: Conversation[]
  activeId: string | null
  isMock: boolean
  theme: Theme
  onToggleTheme: () => void
  onNew: () => void
  onOpen: (id: string) => void
  onDelete: (id: string) => void
  onClearAll: () => void
}

export default function Sidebar({
  conversations,
  activeId,
  isMock,
  theme,
  onToggleTheme,
  onNew,
  onOpen,
  onDelete,
  onClearAll,
}: Props) {
  return (
    <aside className="sidebar">
      <div className="brand">
        <div className="brand-mark">
          <img src="/logo.png" alt="SatQueryAI logo" />
          <img src="/logo-name-white.png" className="logo-ink-dark" alt="" aria-hidden="true" />
        </div>
        <div className="brand-text">
          <span>SatQuery</span>
          <span className="grad">AI</span>
        </div>
        <span className="brand-sub">v0.1</span>
      </div>

      <button className="new-chat" onClick={onNew}>
        <Plus size={16} strokeWidth={2.4} />
        New chat
      </button>

      <nav className="conv-list">
        {conversations.length === 0 ? (
          <div className="conv-empty">
            <p>No conversations yet</p>
            <span>Ask SatQueryAI something to begin.</span>
          </div>
        ) : (
          conversations.map((c) => (
            <div
              key={c.id}
              className={'conv-item' + (c.id === activeId ? ' active' : '')}
              onClick={() => onOpen(c.id)}
            >
              <MessageSquare size={14} className="conv-ico" />
              <span className="conv-title">{c.title}</span>
              <button
                className="conv-del"
                title="Delete conversation"
                onClick={(e) => {
                  e.stopPropagation()
                  onDelete(c.id)
                }}
              >
                <X size={13} />
              </button>
            </div>
          ))
        )}
      </nav>

      <div className="sidebar-foot">
        <button className="theme-toggle" onClick={onToggleTheme}>
          {theme === 'dark' ? <Sun size={14} /> : <Moon size={14} />}
          {theme === 'dark' ? 'Light mode' : 'Dark mode'}
        </button>
        <div className="status-card">
          <span className={'status-dot' + (isMock ? ' warn' : ' ok')} />
          <div className="status-text">
            <strong>RAG engine</strong>
            <small>{isMock ? 'Mock — plug in your backend' : 'Connected'}</small>
          </div>
        </div>
        {conversations.length > 0 && (
          <button className="clear-all" onClick={onClearAll}>
            <Trash2 size={13} />
            Clear all chats
          </button>
        )}
      </div>
    </aside>
  )
}
