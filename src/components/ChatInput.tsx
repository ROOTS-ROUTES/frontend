import { useRef, useState } from 'react'
import { MapPin, SendHorizontal, Square, X } from 'lucide-react'
import AreaPicker, { type PickedArea } from './AreaPicker'
import { formatLatLon, type Aoi } from '../lib/basemap'
import { imageryLabel } from '../data/imageryModes'
import type { ImageryConfig } from '../types'

interface Props {
  onSend: (text: string, aoi?: Aoi, imagery?: ImageryConfig) => void
  onStop: () => void
  isStreaming: boolean
}

const MAX_HEIGHT = 180
const DEFAULT_AOI: Aoi = { lon: 72.5714, lat: 23.0225, zoom: 17 }
const DEFAULT_IMAGERY: ImageryConfig = { mode: 'optical' }

function imagerySummary(c: ImageryConfig): string {
  if (c.mode === 'bitemporal' && c.t1 && c.t2) return `Bi-Temporal · ${c.t1.date} → ${c.t2.date}`
  if (c.mode === 'sar')
    return c.t1 ? `SAR · ${c.t1.date} (simulated C-band VV)` : 'SAR (current, simulated C-band VV)'
  if (c.mode === 'optical') return c.t1 ? `Optical · ${c.t1.date}` : 'Optical (current mosaic)'
  return imageryLabel(c.mode)
}

export default function ChatInput({ onSend, onStop, isStreaming }: Props) {
  const [value, setValue] = useState('')
  const [aoi, setAoi] = useState<Aoi | null>(null)
  const [imagery, setImagery] = useState<ImageryConfig | null>(null)
  const [pickerOpen, setPickerOpen] = useState(false)
  const taRef = useRef<HTMLTextAreaElement>(null)

  const resize = () => {
    const el = taRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = Math.min(el.scrollHeight, MAX_HEIGHT) + 'px'
  }

  /* The explicit map button is the only thing that pops the picker, so the
     box itself stays a plain, always-focusable text field. */
  const openPicker = () => {
    setPickerOpen(true)
  }

  const closePicker = () => {
    setPickerOpen(false)
    requestAnimationFrame(() => taRef.current?.focus())
  }

  const confirmPick = (picked: PickedArea) => {
    setAoi(picked.aoi)
    setImagery(picked.imagery)
    closePicker()
  }

  const submit = () => {
    const text = value.trim()
    if (!text) return
    onSend(text, aoi ?? undefined, imagery ?? undefined)
    setValue('')
    setAoi(null)
    setImagery(null)
    requestAnimationFrame(() => {
      if (taRef.current) taRef.current.style.height = 'auto'
    })
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault()
      submit()
    }
  }

  const canSend = value.trim().length > 0

  return (
    <div className="composer">
      <div className="composer-inner">
        <button
          type="button"
          className="map-pick-btn"
          onClick={openPicker}
          aria-label="Open the map to pick an area and imagery"
          title="Open the map — attach an area + imagery to your question"
        >
          <MapPin size={17} />
        </button>
        <textarea
          ref={taRef}
          rows={1}
          placeholder="Ask SatQueryAI about your satellite data..."
          value={value}
          onChange={(e) => {
            setValue(e.target.value)
            resize()
          }}
          onKeyDown={onKeyDown}
          aria-label="Message SatQueryAI"
        />
        <button
          className="send-btn"
          onClick={isStreaming ? onStop : submit}
          disabled={!isStreaming && !canSend}
          title={isStreaming ? 'Stop generating' : 'Send (Enter)'}
        >
          {isStreaming ? <Square size={15} fill="currentColor" /> : <SendHorizontal size={17} />}
        </button>
      </div>
      {aoi && (
        <div className="aoi-row">
          <div className="aoi-chip">
            <MapPin size={13} />
            <span>
              {formatLatLon(aoi.lat, aoi.lon)} · zoom {aoi.zoom}
            </span>
            {imagery && <span className="aoi-chip-sep">· {imagerySummary(imagery)}</span>}
            <button
              type="button"
              onClick={() => {
                setAoi(null)
                setImagery(null)
              }}
              aria-label="Remove selected area and imagery"
              title="Remove selected area and imagery"
            >
              <X size={12} />
            </button>
          </div>
        </div>
      )}
      <div className="composer-hint">
        <span>
          Type your question directly, or use the <MapPin size={11} /> map pin to attach an area +
          imagery · <kbd>Enter</kbd> to send · <kbd>Shift</kbd>+<kbd>Enter</kbd> for a new line
        </span>
      </div>

      <AreaPicker
        open={pickerOpen}
        aoi={aoi ?? DEFAULT_AOI}
        initialImagery={imagery ?? DEFAULT_IMAGERY}
        onConfirm={confirmPick}
        onClose={closePicker}
      />
    </div>
  )
}
