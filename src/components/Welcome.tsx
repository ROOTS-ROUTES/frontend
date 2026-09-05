import { Sparkles } from 'lucide-react'
import { SUGGESTIONS } from '../data/suggestions'

interface Props {
  onPick: (prompt: string) => void
}

export default function Welcome({ onPick }: Props) {
  return (
    <div className="welcome">
      <div className="welcome-mark">
        <img src="/logo.png" alt="SatQueryAI logo" />
        <img src="/logo-name-white.png" className="logo-ink-dark" alt="" aria-hidden="true" />
      </div>
      <p className="welcome-sub">
        <Sparkles size={14} />
        Answers grounded in your satellite knowledge base. Ask anything.
      </p>

      <div className="suggestions">
        {SUGGESTIONS.map((s) => {
          const Icon = s.icon
          return (
            <button key={s.title} className="suggestion" onClick={() => onPick(s.prompt)}>
              <Icon size={16} className="sug-ico" />
              <span className="sug-body">
                <strong>{s.title}</strong>
                <small>{s.prompt}</small>
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
