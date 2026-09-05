import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import {
  AOI_PIXELS,
  ATTRIBUTION,
  CURRENT_IMAGERY,
  MAX_ZOOM,
  MIN_ZOOM,
  TILE_PIXELS,
  clampLat,
  formatLatLon,
  geocode,
  loadTile,
  loadWaybackReleases,
  lonLatToTile,
  metresPerPixel,
  peekTile,
  tileToLonLat,
  waybackDatesForTile,
  waybackImagery,
  wrapLon,
  type Aoi,
  type GeoHit,
  type ImageryProvider,
} from '../lib/basemap'
import { IMAGERY_MODES } from '../data/imageryModes'
import { captureEvidence } from '../lib/evidence'
import type { ImageryConfig, ImageryMode } from '../types'

/** A configured capture: the footprint plus the imagery it comes from. */
export interface PickedArea {
  aoi: Aoi
  imagery: ImageryConfig
}

/**
 * Where the operator chooses the ground to analyse — and which imagery feeds
 * the question: one current scene, an optical + simulated SAR pair, or two
 * dated Wayback acquisitions for change analysis.
 *
 * Hand-rolled on a canvas rather than wrapping a map library: the preview draws
 * through the very same `loadTile` path a capture would, so the square on screen
 * is literally the footprint that gets attached to the next question.
 *
 * The AOI is centre-anchored, which is why zoom keeps the centre fixed instead
 * of pointing at the cursor: the centre is the one part of the view guaranteed
 * to stay inside the capture.
 */

const PAN_STEP = 96
const CLOSE_MS = 200

const fitScale = (width: number, height: number) =>
  Math.max(0.4, Math.min(1, (Math.min(width, height) - 56) / AOI_PIXELS))

interface WaybackDistinct {
  release: number
  date: string
}

interface PanelProps {
  aoi: Aoi
  initialImagery: ImageryConfig
  onConfirm: (picked: PickedArea) => void
  onClose: () => void
}

function PickerPanel({ aoi, initialImagery, onConfirm, onClose }: PanelProps) {
  const [view, setView] = useState<Aoi>(() => ({ ...aoi }))
  const [box, setBox] = useState({ width: 0, height: 0 })
  const [term, setTerm] = useState('')
  const [results, setResults] = useState<GeoHit[]>([])
  const [searching, setSearching] = useState(false)
  const [searchError, setSearchError] = useState<string | null>(null)

  const [mode, setMode] = useState<ImageryMode>(initialImagery.mode)
  const [dates, setDates] = useState<WaybackDistinct[] | null>(null)
  const [probing, setProbing] = useState(false)
  const [allReleases, setAllReleases] = useState<WaybackDistinct[] | null>(null)
  const [t1Release, setT1Release] = useState<number | null>(initialImagery.t1?.release ?? null)
  const [t2Release, setT2Release] = useState<number | null>(initialImagery.t2?.release ?? null)
  const [sarRelease, setSarRelease] = useState<number | null>(initialImagery.t1?.release ?? null)
  const [opticalRelease, setOpticalRelease] = useState<number | null>(initialImagery.t1?.release ?? null)
  const [previewItems, setPreviewItems] = useState<{ label: string; src: string }[] | null>(null)
  const [previewing, setPreviewing] = useState(false)
  const [era, setEra] = useState<1 | 2>(2)
  const [eraReady, setEraReady] = useState(true)

  const frameRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const dragRef = useRef<{ x: number; y: number } | null>(null)
  const wheelRef = useRef(0)
  const failedRef = useRef(new Set<string>())
  const pendingRef = useRef(new Set<string>())
  const mountedRef = useRef(true)
  const probeKeyRef = useRef<string | null>(null)
  const [tick, redraw] = useState(0)

  const scale = fitScale(box.width, box.height)
  const gsd = metresPerPixel(view.lat, view.zoom)
  const footprint = gsd * AOI_PIXELS

  const centre = lonLatToTile(view.lon, view.lat, view.zoom)
  const tileKey = `${view.zoom}/${Math.floor(centre.x)}/${Math.floor(centre.y)}`

  /* The dates offered in every select: the full archive list from the map
     API. While it loads (or if it is unreachable), the per-tile distinct list
     is a usable stand-in. */
  const options = allReleases ?? (dates && dates.length > 0 ? dates : null)
  const distinct = new Set(dates?.map((d) => d.release))

  /* Selected T1/T2. A release carried over from a previous footprint may not
     exist here, so fall back to the distinct ends rather than failing. */
  const t1 = options?.find((o) => o.release === t1Release) ?? dates?.[0] ?? options?.[0] ?? null
  const t2 = options?.find((o) => o.release === t2Release) ?? dates?.at(-1) ?? options?.at(-1) ?? null

  /* Which timeline the main canvas currently shows: for a pair, either T1 or
     T2 via the era pills over the map; for a single-scene mode, the dated
     release if one was picked. Null means the current mosaic. */
  const eraPick =
    mode === 'bitemporal'
      ? era === 1
        ? t1
        : t2
      : mode === 'optical'
        ? opticalRelease != null
          ? options?.find((o) => o.release === opticalRelease) ?? null
          : null
        : sarRelease != null
          ? options?.find((o) => o.release === sarRelease) ?? null
          : null

  const eraReleaseKey = eraPick?.release ?? null
  const eraProvider = useMemo<ImageryProvider>(() => {
    if (eraPick) return waybackImagery(eraPick.release, eraPick.date)
    return CURRENT_IMAGERY
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eraReleaseKey])
  const eraIsWayback = eraReleaseKey != null
  const isSAR = mode === 'sar'

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  /* The full archive date list from the map API — every dated release, oldest
     first. The per-tile probe below only tells us which of them actually
     differ over this footprint. */
  useEffect(() => {
    let cancelled = false
    loadWaybackReleases()
      .then((list) => {
        if (!cancelled) setAllReleases(list)
      })
      .catch(() => {
        /* fall back to the per-tile distinct list if the config is unreachable */
      })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    const frame = frameRef.current
    if (!frame) return undefined
    const measure = (rect: DOMRectReadOnly) =>
      setBox({ width: Math.round(rect.width), height: Math.round(rect.height) })
    measure(frame.getBoundingClientRect())
    const observer = new ResizeObserver(([entry]) => measure(entry.contentRect))
    observer.observe(frame)
    return () => observer.disconnect()
  }, [])

  /* Probe the Wayback releases that actually differ over this footprint for
     every mode: any of them can be anchored to a dated acquisition. Nominal
     dates run to ~196 and almost all carry the previous image forward
     untouched, so the probe keeps only the ones that genuinely differ. A short
     debounce keeps a pan from firing a burst of probes. */
  useEffect(() => {
    const controller = new AbortController()
    const timer = window.setTimeout(() => {
      if (probeKeyRef.current === tileKey) return
      probeKeyRef.current = tileKey
      setProbing(true)
      setDates(null)
      waybackDatesForTile({ lon: view.lon, lat: view.lat, zoom: view.zoom, signal: controller.signal })
        .then((found) => {
          if (!controller.signal.aborted && mountedRef.current) {
            setDates(found)
            setProbing(false)
          }
        })
        .catch(() => {
          if (!controller.signal.aborted && mountedRef.current) {
            setDates([])
            setProbing(false)
          }
        })
    }, 300)
    return () => {
      window.clearTimeout(timer)
      controller.abort()
    }
    // view is read through the tileKey the probe is keyed on
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tileKey])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !box.width || !box.height) return undefined

    const ctx = canvas.getContext('2d')
    if (!ctx) return undefined
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    canvas.width = box.width * dpr
    canvas.height = box.height * dpr
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.fillStyle = '#0a0716'
    ctx.fillRect(0, 0, box.width, box.height)

    const span = TILE_PIXELS * scale
    const c = lonLatToTile(view.lon, view.lat, view.zoom)
    const originX = box.width / 2 - c.x * span
    const originY = box.height / 2 - c.y * span
    const wrap = 2 ** view.zoom

    /* SAR mode renders the base scene as a radar frame: desaturated, pushed
       contrast — the same treatment the simulated capture gets. */
    if (isSAR) ctx.filter = 'grayscale(1) contrast(1.18) brightness(1.06)'

    for (let ty = Math.floor(-originY / span); ty <= Math.floor((box.height - originY) / span); ty++) {
      if (ty < 0 || ty >= wrap) continue
      for (let tx = Math.floor(-originX / span); tx <= Math.floor((box.width - originX) / span); tx++) {
        const url = eraProvider.tile({ z: view.zoom, x: ((tx % wrap) + wrap) % wrap, y: ty })
        const img = peekTile(url)
        if (img) {
          ctx.drawImage(img, originX + tx * span, originY + ty * span, span + 1, span + 1)
          continue
        }
        if (failedRef.current.has(url) || pendingRef.current.has(url)) continue
        pendingRef.current.add(url)
        loadTile(url).then(
          () => {
            pendingRef.current.delete(url)
            if (mountedRef.current) redraw((n) => n + 1)
          },
          () => {
            pendingRef.current.delete(url)
            failedRef.current.add(url)
          },
        )
      }
    }

    ctx.filter = 'none'

    /* While a dated timeline is selected, watch the centre tile so the era
       pill can report when the chosen era is actually on screen. */
    if (eraIsWayback) {
      const centreUrl = eraProvider.tile({ z: view.zoom, x: Math.floor(c.x), y: Math.floor(c.y) })
      const ready = !!peekTile(centreUrl)
      setEraReady((prev) => (prev === ready ? prev : ready))
    }

    // Dim everything outside the footprint so the capture window reads clearly.
    const side = AOI_PIXELS * scale
    const left = (box.width - side) / 2
    const top = (box.height - side) / 2
    ctx.fillStyle = 'rgba(7, 5, 16, 0.58)'
    ctx.fillRect(0, 0, box.width, top)
    ctx.fillRect(0, top + side, box.width, box.height - top - side)
    ctx.fillRect(0, top, left, side)
    ctx.fillRect(left + side, top, box.width - left - side, side)

    ctx.strokeStyle = '#a78bfa'
    ctx.lineWidth = 1.5
    ctx.strokeRect(left + 0.75, top + 0.75, side - 1.5, side - 1.5)

    // Corner ticks, so the square still reads over bright ground.
    ctx.lineWidth = 2.5
    const arm = Math.min(22, side / 6)
    for (const [cx, sx] of [
      [left, 1],
      [left + side, -1],
    ] as const) {
      for (const [cy, sy] of [
        [top, 1],
        [top + side, -1],
      ] as const) {
        ctx.beginPath()
        ctx.moveTo(cx + sx * arm, cy)
        ctx.lineTo(cx, cy)
        ctx.lineTo(cx, cy + sy * arm)
        ctx.stroke()
      }
    }
  }, [view, box, scale, tick, eraProvider, eraIsWayback, isSAR])

  const zoomBy = (delta: number) =>
    setView((v) => ({ ...v, zoom: Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, v.zoom + delta)) }))

  const panByPixels = (dx: number, dy: number) =>
    setView((v) => {
      const tile = lonLatToTile(v.lon, v.lat, v.zoom)
      const step = TILE_PIXELS * scale
      const next = tileToLonLat(tile.x + dx / step, tile.y + dy / step, v.zoom)
      return { ...v, lon: wrapLon(next.lon), lat: clampLat(next.lat) }
    })

  /* React attaches `wheel` passively at the root, so `onWheel` cannot call
     preventDefault — a native listener is required to stop the page panning. */
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return undefined
    const onWheel = (event: WheelEvent) => {
      event.preventDefault()
      wheelRef.current += event.deltaY
      if (Math.abs(wheelRef.current) < 42) return
      const step = wheelRef.current > 0 ? -1 : 1
      wheelRef.current = 0
      setView((v) => ({ ...v, zoom: Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, v.zoom + step)) }))
    }
    canvas.addEventListener('wheel', onWheel, { passive: false })
    return () => canvas.removeEventListener('wheel', onWheel)
  }, [])

  const onPointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    dragRef.current = { x: event.clientX, y: event.clientY }
    event.currentTarget.setPointerCapture?.(event.pointerId)
  }

  const onPointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const drag = dragRef.current
    if (!drag) return
    const dx = event.clientX - drag.x
    const dy = event.clientY - drag.y
    if (!dx && !dy) return
    dragRef.current = { x: event.clientX, y: event.clientY }
    panByPixels(-dx, -dy)
  }

  const endDrag = (event: React.PointerEvent<HTMLCanvasElement>) => {
    dragRef.current = null
    event.currentTarget.releasePointerCapture?.(event.pointerId)
  }

  const onKeyDown = (event: React.KeyboardEvent<HTMLCanvasElement>) => {
    const moves: Record<string, [number, number]> = {
      ArrowLeft: [-PAN_STEP, 0],
      ArrowRight: [PAN_STEP, 0],
      ArrowUp: [0, -PAN_STEP],
      ArrowDown: [0, PAN_STEP],
    }
    if (moves[event.key]) {
      event.preventDefault()
      panByPixels(...moves[event.key])
    } else if (event.key === '+' || event.key === '=') {
      event.preventDefault()
      zoomBy(1)
    } else if (event.key === '-' || event.key === '_') {
      event.preventDefault()
      zoomBy(-1)
    }
  }

  const search = async (event: React.FormEvent) => {
    event.preventDefault()
    const query = term.trim()
    if (!query) return
    setSearching(true)
    setSearchError(null)
    try {
      const found = await geocode(query)
      setResults(found)
      if (!found.length) setSearchError('No match for that place.')
      else setView((v) => ({ ...v, lon: found[0].lon, lat: found[0].lat, zoom: Math.max(v.zoom, 16) }))
    } catch {
      setSearchError('The geocoder could not be reached.')
    } finally {
      setSearching(false)
    }
  }

  const confirm = () => {
    const pickedAoi: Aoi = { lon: wrapLon(view.lon), lat: view.lat, zoom: view.zoom }
    const findRelease = (release: number | null) =>
      release == null ? undefined : options?.find((d) => d.release === release)

    if (mode === 'bitemporal' && t1 && t2) {
      onConfirm({
        aoi: pickedAoi,
        imagery: {
          mode,
          t1: { release: t1.release, date: t1.date },
          t2: { release: t2.release, date: t2.date },
        },
      })
      return
    }
    if (mode === 'optical') {
      const rel = findRelease(opticalRelease)
      onConfirm({
        aoi: pickedAoi,
        imagery: rel ? { mode, t1: { release: rel.release, date: rel.date } } : { mode },
      })
      return
    }
    if (mode === 'sar') {
      const rel = findRelease(sarRelease)
      onConfirm({
        aoi: pickedAoi,
        imagery: rel ? { mode, t1: { release: rel.release, date: rel.date } } : { mode },
      })
      return
    }
    onConfirm({ aoi: pickedAoi, imagery: { mode } })
  }

  const activeInfo = IMAGERY_MODES.find((m) => m.id === mode)

  /* On-the-spot preview of the real input frames: when the timelines change,
     capture what the analysis layer would actually receive (both dated frames
     for a pair, the dated optical scene, the simulated radar frame for SAR).
     Debounced and abortable. */
  useEffect(() => {
    if (!options) return undefined
    if (mode === 'bitemporal' && (!t1 || !t2 || t1.release === t2.release)) {
      setPreviewItems(null)
      setPreviewing(false)
      return undefined
    }

    const controller = new AbortController()
    setPreviewing(true)
    const timer = window.setTimeout(() => {
      const singleRelease =
        mode === 'sar' ? sarRelease : mode === 'optical' ? opticalRelease : null
      const imagery: ImageryConfig =
        mode === 'bitemporal'
          ? {
              mode,
              t1: { release: t1!.release, date: t1!.date },
              t2: { release: t2!.release, date: t2!.date },
            }
          : {
              mode,
              ...(singleRelease
                ? {
                    t1: {
                      release: singleRelease,
                      date: options.find((o) => o.release === singleRelease)?.date ?? '',
                    },
                  }
                : {}),
            }
      captureEvidence(view, imagery, controller.signal)
        .then((items) => {
          if (!controller.signal.aborted && mountedRef.current) {
            setPreviewItems(items.map((it) => ({ label: it.label, src: it.src })))
            setPreviewing(false)
          }
        })
        .catch(() => {
          if (!controller.signal.aborted && mountedRef.current) setPreviewing(false)
        })
    }, 450)
    return () => {
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [options, mode, t1, t2, sarRelease, opticalRelease, view])

  return (
    <div className="map-panel">
      {/* header: title, place search, close */}
      <div className="map-head">
        <div className="map-head-text">
          <p className="map-kicker">Choose area</p>
          <p>Pan and zoom to the ground you want analysed</p>
        </div>

        <form onSubmit={search} className="map-search">
          <input
            value={term}
            onChange={(e) => setTerm(e.target.value)}
            placeholder="Search a place…"
            aria-label="Search for a place"
            spellCheck={false}
          />
          <button type="submit" disabled={searching}>
            {searching ? 'finding…' : 'find'}
          </button>
        </form>

        <button
          type="button"
          onClick={onClose}
          aria-label="Close area picker"
          className="map-close"
        >
          <span />
          <span />
        </button>
      </div>

      {/* alternate geocoder candidates — the first is applied automatically */}
      {(results.length > 1 || searchError) && (
        <div className="map-results">
          {searchError && <span className="map-results-error">! {searchError}</span>}
          {results.slice(0, 5).map((hit) => (
            <button
              key={`${hit.label}-${hit.lon}-${hit.lat}`}
              type="button"
              onClick={() =>
                setView((v) => ({ ...v, lon: hit.lon, lat: hit.lat, zoom: Math.max(v.zoom, 16) }))
              }
            >
              {hit.label}
            </button>
          ))}
        </div>
      )}

      {/* imagery mode */}
      <div className="map-modes">
        <span className="map-modes-label">Imagery</span>
        <div className="map-modes-group">
          {IMAGERY_MODES.map((option) => (
            <button
              key={option.id}
              type="button"
              aria-pressed={mode === option.id}
              className={'map-mode-btn' + (mode === option.id ? ' active' : '')}
              onClick={() => setMode(option.id)}
            >
              {option.label}
            </button>
          ))}
        </div>
        <p className="map-blurb">{activeInfo?.blurb}</p>
      </div>

      {/* optical: anchor the scene to a dated archive release or the current mosaic */}
      {mode === 'optical' && (
        <div className="map-acq">
          <span className="map-acq-label">Acquisition</span>
          {options ? (
            <>
              <label className="map-release">
                T0
                <select
                  value={opticalRelease ?? 'current'}
                  onChange={(e) => {
                    const v = e.target.value
                    setOpticalRelease(v === 'current' ? null : Number(v))
                  }}
                >
                  <option value="current">Current (latest mosaic)</option>
                  {options.map((option) => (
                    <option key={option.release} value={option.release}>
                      {option.date}
                      {distinct.has(option.release) ? ' *' : ''}
                    </option>
                  ))}
                </select>
              </label>
              <span className="map-acq-count">
                {options.length} archive dates · back to {options[0].date}
                {probing
                  ? ' · probing new-imagery dates…'
                  : dates
                    ? ` · ${dates.length} marked * are new over this footprint`
                    : ''}
              </span>
            </>
          ) : (
            <span className="map-acq-wait">loading archive dates…</span>
          )}
        </div>
      )}

      {/* SAR: anchor the radar scene to a dated archive release or the current mosaic */}
      {mode === 'sar' && (
        <div className="map-acq">
          <span className="map-acq-label">Acquisition</span>
          {options ? (
            <>
              <label className="map-release">
                T0
                <select
                  value={sarRelease ?? 'current'}
                  onChange={(e) => {
                    const v = e.target.value
                    setSarRelease(v === 'current' ? null : Number(v))
                  }}
                >
                  <option value="current">Current (latest mosaic)</option>
                  {options.map((option) => (
                    <option key={option.release} value={option.release}>
                      {option.date}
                      {distinct.has(option.release) ? ' *' : ''}
                    </option>
                  ))}
                </select>
              </label>
              <span className="map-acq-count">
                {options.length} archive dates · back to {options[0].date}
                {probing
                  ? ' · probing new-imagery dates…'
                  : dates
                    ? ` · ${dates.length} marked * are new over this footprint`
                    : ''}
              </span>
            </>
          ) : (
            <span className="map-acq-wait">loading archive dates…</span>
          )}
        </div>
      )}

      {/* bi-temporal: pick any two archive dates — * marks ones that actually
          re-photographed this footprint */}
      {mode === 'bitemporal' && (
        <div className="map-acq">
          <span className="map-acq-label">Acquisitions</span>
          {options ? (
            <>
              <label className="map-release">
                T1
                <select value={t1?.release ?? ''} onChange={(e) => setT1Release(Number(e.target.value))}>
                  {options.map((option) => (
                    <option key={option.release} value={option.release}>
                      {option.date}
                      {distinct.has(option.release) ? ' *' : ''}
                    </option>
                  ))}
                </select>
              </label>
              <span className="map-acq-arrow">→</span>
              <label className="map-release">
                T2
                <select value={t2?.release ?? ''} onChange={(e) => setT2Release(Number(e.target.value))}>
                  {options.map((option) => (
                    <option key={option.release} value={option.release}>
                      {option.date}
                      {distinct.has(option.release) ? ' *' : ''}
                    </option>
                  ))}
                </select>
              </label>
              {probing ? (
                <span className="map-acq-wait">probing new-imagery dates…</span>
              ) : dates && dates.length < 2 ? (
                <span className="map-acq-wait warn">
                  No re-photography detected over this footprint — an unmarked date may show the same
                  imagery.
                </span>
              ) : (
                <span className="map-acq-count">
                  {dates?.length} marked * are new over this footprint · {options.length} archive dates
                </span>
              )}
            </>
          ) : (
            <span className="map-acq-wait">loading archive dates…</span>
          )}
        </div>
      )}

      {/* live preview of the exact input frames for the chosen timelines */}
      {(previewing || previewItems) && (
        <div className="map-preview">
          {previewItems ? (
            previewItems.map((it, i) => (
              <Fragment key={it.label}>
                {i > 0 && <span className="map-acq-arrow">→</span>}
                <span className="map-prev-item">
                  <img src={it.src} alt={it.label} />
                  <span>{it.label}</span>
                </span>
              </Fragment>
            ))
          ) : (
            <span className="map-acq-wait">capturing preview…</span>
          )}
          {previewing && previewItems && <span className="map-acq-wait">updating…</span>}
        </div>
      )}

      {/* the map */}
      <div ref={frameRef} className="map-frame">
        <canvas
          ref={canvasRef}
          tabIndex={0}
          role="application"
          aria-label="Satellite map. Drag or use the arrow keys to pan, plus and minus to zoom."
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          onKeyDown={onKeyDown}
          className="map-canvas"
        />

        <div className="map-readout">
          <p className="map-readout-main">{formatLatLon(view.lat, view.lon)}</p>
          <p>
            zoom {view.zoom} · {gsd.toFixed(3)} m/px
          </p>
          <p>
            footprint {footprint < 1000 ? `${Math.round(footprint)} m` : `${(footprint / 1000).toFixed(2)} km`} ·{' '}
            {AOI_PIXELS}² px
          </p>
        </div>

        <div className="map-zoom">
          <button
            type="button"
            onClick={() => zoomBy(1)}
            disabled={view.zoom >= MAX_ZOOM}
            aria-label="Zoom in"
          >
            +
          </button>
          <button
            type="button"
            onClick={() => zoomBy(-1)}
            disabled={view.zoom <= MIN_ZOOM}
            aria-label="Zoom out"
          >
            −
          </button>
        </div>

        {/* which timeline the canvas is showing — tap to flip the era */}
        {(eraIsWayback || (mode === 'bitemporal' && t1 && t2)) && (
          <div className="map-era">
            {mode === 'bitemporal' ? (
              <>
                <button
                  type="button"
                  className={'map-era-btn' + (era === 1 ? ' active' : '')}
                  onClick={() => setEra(1)}
                >
                  T1 · {t1?.date ?? '…'}
                  {era === 1 && !eraReady && <span className="map-era-dot" />}
                </button>
                <button
                  type="button"
                  className={'map-era-btn' + (era === 2 ? ' active' : '')}
                  onClick={() => setEra(2)}
                >
                  T2 · {t2?.date ?? '…'}
                  {era === 2 && !eraReady && <span className="map-era-dot" />}
                </button>
              </>
            ) : (
              <span className="map-era-btn">
                {!eraReady && <span className="map-era-dot" />}
                {eraPick?.date}
              </span>
            )}
          </div>
        )}

        <p className="map-attribution">{ATTRIBUTION}</p>
      </div>

      {/* footer */}
      <div className="map-foot">
        <p>
          The framed square is exactly what gets attached — {AOI_PIXELS}×{AOI_PIXELS} px at{' '}
          {gsd.toFixed(3)} m/px. Zoom {MAX_ZOOM} is the sharpest imagery this service publishes.
        </p>
        <div className="map-foot-actions">
          <button type="button" onClick={onClose} className="map-btn ghost">
            Cancel
          </button>
          <button type="button" onClick={confirm} className="map-btn solid">
            Use this area
          </button>
        </div>
      </div>
    </div>
  )
}

interface Props {
  open: boolean
  aoi: Aoi
  initialImagery: ImageryConfig
  onConfirm: (picked: PickedArea) => void
  onClose: () => void
}

export default function AreaPicker({ open, aoi, initialImagery, onConfirm, onClose }: Props) {
  const [render, setRender] = useState(open)
  const [leaving, setLeaving] = useState(false)

  useEffect(() => {
    if (open) {
      setRender(true)
      setLeaving(false)
      return undefined
    }
    if (!render) return undefined
    setLeaving(true)
    const t = window.setTimeout(() => {
      setRender(false)
      setLeaving(false)
    }, CLOSE_MS)
    return () => window.clearTimeout(t)
  }, [open, render])

  useEffect(() => {
    if (!open) return undefined
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!render) return null

  return (
    <div
      className={'map-overlay' + (leaving ? ' leaving' : ' entering')}
      onPointerDown={(event) => event.target === event.currentTarget && onClose()}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Choose the area to analyse"
        className="map-dialog"
      >
        {open && (
          <PickerPanel aoi={aoi} initialImagery={initialImagery} onConfirm={onConfirm} onClose={onClose} />
        )}
      </div>
    </div>
  )
}
