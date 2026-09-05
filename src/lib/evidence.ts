import {
  AOI_PIXELS,
  fetchAoi,
  formatLatLon,
  CURRENT_IMAGERY,
  waybackImagery,
  type Aoi,
} from './basemap'
import { simulateSar } from './sar'
import type { ImageryConfig, ImageryRelease } from '../types'

/** One input-imagery frame shown as evidence with the reply. */
export interface EvidenceItem {
  label: string
  sub: string
  src: string
  gsd: number
}

const jpeg = (canvas: HTMLCanvasElement): string => canvas.toDataURL('image/jpeg', 0.82)

/** Deterministic per-footprint seed, so the same area always models the same radar texture. */
const sarSeed = (aoi: Aoi) =>
  Math.abs(Math.round(aoi.lat * 1e4) + Math.round(aoi.lon * 1e4) + aoi.zoom)

const releaseLabel = (rel?: ImageryRelease) => (rel ? rel.date : 'current mosaic')

/**
 * Capture the input imagery of a configured question as displayable frames:
 *   - optical: the true-colour capture at the chosen date (or the current mosaic)
 *   - SAR: simulated C-band VV from the optical capture at the chosen date
 *   - bi-temporal: the two dated Wayback acquisitions themselves
 * The frames are what the analysis layer would have received.
 */
export async function captureEvidence(
  aoi: Aoi,
  imagery: ImageryConfig,
  signal?: AbortSignal,
): Promise<EvidenceItem[]> {
  const where = `${formatLatLon(aoi.lat, aoi.lon)} · z${aoi.zoom}`

  if (imagery.mode === 'bitemporal' && imagery.t1 && imagery.t2) {
    const [t1, t2] = await Promise.all([
      fetchAoi({ ...aoi, provider: waybackImagery(imagery.t1.release, imagery.t1.date), signal }),
      fetchAoi({ ...aoi, provider: waybackImagery(imagery.t2.release, imagery.t2.date), signal }),
    ])
    return [
      { label: `T1 · ${t1.provider.date}`, sub: t1.missing.length ? `Wayback ${where} · ${t1.missing.length} tiles missing` : `Wayback · ${where}`, src: jpeg(t1.canvas), gsd: t1.gsd },
      { label: `T2 · ${t2.provider.date}`, sub: t2.missing.length ? `Wayback ${where} · ${t2.missing.length} tiles missing` : `Wayback · ${where}`, src: jpeg(t2.canvas), gsd: t2.gsd },
    ]
  }

  const provider = imagery.t1 ? waybackImagery(imagery.t1.release, imagery.t1.date) : CURRENT_IMAGERY
  const capture = await fetchAoi({ ...aoi, provider, signal })
  const missing = capture.missing.length
    ? ` · ${capture.missing.length} tiles missing`
    : ''

  if (imagery.mode === 'sar') {
    const sar = simulateSar(capture.canvas, sarSeed(aoi))
    return [
      {
        label: `SAR · ${releaseLabel(imagery.t1)}`,
        sub: `Simulated C-band VV · ${where} (modelled from the optical capture)${missing}`,
        src: jpeg(sar),
        gsd: capture.gsd,
      },
    ]
  }

  // optical
  return [
    {
      label: `Optical · ${releaseLabel(imagery.t1)}`,
      sub: `${imagery.t1 ? 'Wayback' : 'Esri World Imagery (current mosaic)'} · ${where}${missing}`,
      src: jpeg(capture.canvas),
      gsd: capture.gsd,
    },
  ]
}

/**
 * In-memory only: evidence frames are too heavy for localStorage, so they live
 * for the session and re-capture on demand. Keyed by message id.
 */
const store = new Map<string, EvidenceItem[]>()

export const setEvidence = (messageId: string, items: EvidenceItem[]) => {
  store.set(messageId, items)
}

export const getEvidence = (messageId: string): EvidenceItem[] | undefined => store.get(messageId)

export const evFootprint = (gsd: number) => `${(gsd * AOI_PIXELS / 1000).toFixed(2)} km`
