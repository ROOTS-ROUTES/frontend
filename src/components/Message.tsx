import { useEffect, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Orbit } from 'lucide-react'
import type { ChatMessage } from '../types'
import { getEvidence, evFootprint, type EvidenceItem } from '../lib/evidence'

interface Props {
  msg: ChatMessage
  streaming?: boolean
  showAvatar?: boolean
}

function fmtTime(ts: number): string {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function Lightbox({ item, onClose }: { item: EvidenceItem; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="lightbox" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <figure>
        <img src={item.src} alt={item.label} />
        <figcaption>
          {item.label} — {item.sub} · {(item.gsd * 1000).toFixed(1)} cm/px · {evFootprint(item.gsd)} footprint
        </figcaption>
      </figure>
    </div>
  )
}

function Evidence({ items }: { items: EvidenceItem[] }) {
  const [zoom, setZoom] = useState<EvidenceItem | null>(null)

  return (
    <div className="evidence">
      <p className="evidence-cap">Input evidence — captured from the map API</p>
      <div className="evidence-row">
        {items.map((item) => (
          <button
            key={item.label}
            type="button"
            className="evidence-item"
            onClick={() => setZoom(item)}
            title="Enlarge"
          >
            <img src={item.src} alt={item.label} draggable={false} />
            <span className="evidence-label">{item.label}</span>
            <span className="evidence-sub">
              {item.sub} · {(item.gsd * 1000).toFixed(1)} cm/px
            </span>
          </button>
        ))}
      </div>
      {zoom && <Lightbox item={zoom} onClose={() => setZoom(null)} />}
    </div>
  )
}

export default function Message({ msg, streaming = false, showAvatar = true }: Props) {
  if (msg.role === 'user') {
    return (
      <div className="msg user">
        <div className="bubble user-bubble">{msg.content}</div>
      </div>
    )
  }

  const evidence = getEvidence(msg.id)

  return (
    <div className="msg ai">
      <div className="avatar">{showAvatar ? <Orbit size={17} strokeWidth={2.2} /> : null}</div>
      <div className="ai-body">
        <div className="ai-meta">
          <span className="ai-name">SatQueryAI</span>
          <span className="ai-time">{fmtTime(msg.createdAt)}</span>
        </div>

        {msg.error ? (
          <div className="bubble error-bubble">{msg.content}</div>
        ) : (
          <>
            {evidence && !streaming && <Evidence items={evidence} />}
            {msg.content.length > 0 ? (
              <div className={'bubble ai-bubble md' + (streaming ? ' streaming' : '')}>
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{msg.content}</ReactMarkdown>
              </div>
            ) : streaming ? (
              <div className="bubble ai-bubble">
                <span className="typing">
                  <i />
                  <i />
                  <i />
                </span>
              </div>
            ) : null}
          </>
        )}
      </div>
    </div>
  )
}
