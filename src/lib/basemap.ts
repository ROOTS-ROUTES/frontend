/**
 * Live satellite imagery, fetched for a user-chosen area of interest.
 *
 * Two Esri services do the work, both keyless and both serving
 * `Access-Control-Allow-Origin: *`:
 *   - World Imagery: the current mosaic, sharp to zoom 19 (~0.27 m/px)
 *   - World Imagery Wayback: dated releases back to 2014
 *
 * Every tile loads with `crossOrigin = 'anonymous'` so captured canvases stay
 * readable; a provider without the CORS header cannot be used here.
 */

export interface Aoi {
  lon: number
  lat: number
  zoom: number
}

export interface TileCoords {
  z: number
  x: number
  y: number
}

export interface ImageryProvider {
  id: string
  label: string
  sensor: string
  attribution: string
  release?: number
  date?: string | null
  tile: (c: TileCoords) => string
}

export interface GeoHit {
  label: string
  lon: number
  lat: number
  score: number
}

export interface AoiCapture {
  canvas: HTMLCanvasElement
  width: number
  height: number
  lon: number
  lat: number
  zoom: number
  provider: ImageryProvider
  gsd: number
  tiePoint: number[]
  bbox: number[]
  tiles: number
  missing: string[]
}

const TILE_PX = 256
const EARTH_CIRCUMFERENCE = 40075016.685578488
const ORIGIN_SHIFT = EARTH_CIRCUMFERENCE / 2

/** The window every capture takes, matching the 512² grid the pipeline expects. */
export const AOI_PIXELS = 512

/** Side of one Web Mercator tile. The map and the capture share this geometry. */
export const TILE_PIXELS = TILE_PX

export const MIN_ZOOM = 3
export const MAX_ZOOM = 19

/** Web Mercator diverges at the poles, so the projection stops just short of them. */
export const clampLat = (lat: number): number => Math.max(-85.05112878, Math.min(85.05112878, lat))

/** Longitude wraps rather than clamps — panning past the antimeridian should continue. */
export const wrapLon = (lon: number): number => ((((lon + 180) % 360) + 360) % 360) - 180

/**
 * Fractional tile coordinate: the whole part indexes the tile, the fraction
 * locates the pixel inside it. Everything else here is built on this.
 */
export function lonLatToTile(lon: number, lat: number, zoom: number): { x: number; y: number } {
  const n = 2 ** zoom
  const s = Math.sin((clampLat(lat) * Math.PI) / 180)
  return {
    x: ((wrapLon(lon) + 180) / 360) * n,
    y: (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * n,
  }
}

export function tileToLonLat(x: number, y: number, zoom: number): { lon: number; lat: number } {
  const n = 2 ** zoom
  const k = Math.PI - (2 * Math.PI * y) / n
  return {
    lon: (x / n) * 360 - 180,
    lat: (180 / Math.PI) * Math.atan(0.5 * (Math.exp(k) - Math.exp(-k))),
  }
}

export function tileToMercator(x: number, y: number, zoom: number): { mx: number; my: number } {
  const span = EARTH_CIRCUMFERENCE / 2 ** zoom
  return { mx: -ORIGIN_SHIFT + x * span, my: ORIGIN_SHIFT - y * span }
}

/** A capture's real ground sampling distance: metres per pixel at this latitude and zoom. */
export const metresPerPixel = (lat: number, zoom: number): number =>
  (EARTH_CIRCUMFERENCE * Math.cos((clampLat(lat) * Math.PI) / 180)) / (TILE_PX * 2 ** zoom)

/** Shared readout format, so the picker and the composer chip never disagree. */
export const formatLatLon = (lat: number, lon: number): string =>
  `${Math.abs(lat).toFixed(4)}° ${lat >= 0 ? 'N' : 'S'} ${Math.abs(wrapLon(lon)).toFixed(4)}° ${lon >= 0 ? 'E' : 'W'}`

// ── providers ──────────────────────────────────────────────────────────────

export const ATTRIBUTION = 'Esri, Maxar, Earthstar Geographics and the GIS User Community'

export const CURRENT_IMAGERY: ImageryProvider = {
  id: 'esri-world-imagery',
  label: 'Esri World Imagery',
  sensor: 'Esri World Imagery (Maxar / Vexcel / partner mosaic)',
  attribution: ATTRIBUTION,
  /* Esri orders the path /{level}/{row}/{col}, i.e. y before x. */
  tile: ({ z, x, y }) =>
    `https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}`,
}

export function waybackImagery(release: number, date: string): ImageryProvider {
  return {
    id: `esri-wayback-${release}`,
    label: `Wayback ${date}`,
    sensor: `Esri World Imagery — Wayback release ${date}`,
    attribution: ATTRIBUTION,
    release,
    date,
    tile: ({ z, x, y }) =>
      `https://wayback.maptiles.arcgis.com/arcgis/rest/services/World_Imagery/WMTS/1.0.0/default028mm/MapServer/tile/${release}/${z}/${y}/${x}`,
  }
}

// ── tile loading ───────────────────────────────────────────────────────────

const tileCache = new Map<string, Promise<HTMLImageElement> & { image?: HTMLImageElement }>()

/**
 * `crossOrigin` has to be assigned before `src`: set it afterwards and the
 * request has already gone out without the CORS handshake, leaving an image
 * that taints every canvas it is drawn into.
 */
export function loadTile(url: string): Promise<HTMLImageElement> {
  const cached = tileCache.get(url)
  if (cached) return cached

  const pending = new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error(`tile unavailable: ${url}`))
    img.src = url
  }) as Promise<HTMLImageElement> & { image?: HTMLImageElement }

  pending.then(
    (img) => {
      pending.image = img
    },
    () => tileCache.delete(url),
  )
  tileCache.set(url, pending)
  return pending
}

/** The decoded tile if it has already arrived, else null. */
export const peekTile = (url: string): HTMLImageElement | null => tileCache.get(url)?.image ?? null

// ── capture ────────────────────────────────────────────────────────────────

export interface FetchAoiOptions extends Aoi {
  size?: number
  provider?: ImageryProvider
  signal?: AbortSignal
}

export async function fetchAoi({
  lon,
  lat,
  zoom,
  size = AOI_PIXELS,
  provider = CURRENT_IMAGERY,
  signal,
}: FetchAoiOptions): Promise<AoiCapture> {
  const centre = lonLatToTile(lon, lat, zoom)
  const left = centre.x * TILE_PX - size / 2
  const top = centre.y * TILE_PX - size / 2
  const wrap = 2 ** zoom

  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = size
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = '#0a0c0b'
  ctx.fillRect(0, 0, size, size)

  const wanted: { tx: number; ty: number }[] = []
  for (let ty = Math.floor(top / TILE_PX); ty <= Math.floor((top + size - 1) / TILE_PX); ty++) {
    if (ty < 0 || ty >= wrap) continue
    for (let tx = Math.floor(left / TILE_PX); tx <= Math.floor((left + size - 1) / TILE_PX); tx++) {
      wanted.push({ tx, ty })
    }
  }

  const missing: string[] = []
  await Promise.all(
    wanted.map(async ({ tx, ty }) => {
      const url = provider.tile({ z: zoom, x: ((tx % wrap) + wrap) % wrap, y: ty })
      try {
        const img = await loadTile(url)
        if (signal?.aborted) return
        ctx.drawImage(img, tx * TILE_PX - left, ty * TILE_PX - top, TILE_PX, TILE_PX)
      } catch {
        missing.push(`${zoom}/${tx}/${ty}`)
      }
    }),
  )

  if (signal?.aborted) throw new DOMException('capture aborted', 'AbortError')

  const origin = tileToMercator(left / TILE_PX, top / TILE_PX, zoom)
  const nw = tileToLonLat(left / TILE_PX, top / TILE_PX, zoom)
  const se = tileToLonLat((left + size) / TILE_PX, (top + size) / TILE_PX, zoom)

  return {
    canvas,
    width: size,
    height: size,
    lon: wrapLon(lon),
    lat,
    zoom,
    provider,
    gsd: metresPerPixel(lat, zoom),
    tiePoint: [0, 0, 0, origin.mx, origin.my, 0],
    bbox: [nw.lon, se.lat, se.lon, nw.lat],
    tiles: wanted.length,
    missing,
  }
}

// ── Wayback: which dates actually differ ───────────────────────────────────

const WAYBACK_CONFIG = 'https://s3-us-west-2.amazonaws.com/config.maptiles.arcgis.com/waybackconfig.json'
const WAYBACK_TILEMAP =
  'https://wayback.maptiles.arcgis.com/arcgis/rest/services/world_imagery/wayback/MapServer/tilemap'

let releasesPromise: Promise<{ release: number; date: string }[]> | null = null

export function loadWaybackReleases(): Promise<{ release: number; date: string }[]> {
  releasesPromise ??= fetch(WAYBACK_CONFIG)
    .then(async (res) => {
      if (!res.ok) throw new Error(`Wayback config responded ${res.status}`)
      return (await res.json()) as unknown as Record<string, { itemTitle?: string }>
    })
    .then((config) =>
      Object.entries(config)
        .map(([release, entry]) => ({
          release: Number(release),
          date: /(\d{4}-\d{2}-\d{2})/.exec(entry?.itemTitle ?? '')?.[1] ?? null,
        }))
        .filter((entry): entry is { release: number; date: string } => !!entry.date)
        .sort((a, b) => a.date.localeCompare(b.date)),
    )
    .catch((error: unknown) => {
      releasesPromise = null
      throw error
    })
  return releasesPromise
}

async function tileBytes(release: number, zoom: number, row: number, col: number, signal?: AbortSignal): Promise<number | null> {
  try {
    const res = await fetch(`${WAYBACK_TILEMAP}/${release}/${zoom}/${row}/${col}`, { signal })
    if (!res.ok) return null
    const body = (await res.json()) as { valid?: boolean; size?: number[] }
    return body?.valid && Array.isArray(body.size) ? body.size[0] : null
  } catch {
    return null
  }
}

interface WaybackDistinct {
  release: number
  date: string
  bytes: number
}

const distinctCache = new Map<string, WaybackDistinct[]>()

export async function waybackDatesForTile(
  { lon, lat, zoom, signal, concurrency = 8 }: Aoi & { signal?: AbortSignal; concurrency?: number },
): Promise<WaybackDistinct[]> {
  const tile = lonLatToTile(lon, lat, zoom)
  const col = Math.floor(tile.x)
  const row = Math.floor(tile.y)
  const key = `${zoom}/${col}/${row}`
  const cached = distinctCache.get(key)
  if (cached) return cached

  const releases = await loadWaybackReleases()
  const sizes: (number | null)[] = new Array(releases.length).fill(null)

  let cursor = 0
  await Promise.all(
    Array.from({ length: Math.min(concurrency, releases.length) }, async () => {
      while (cursor < releases.length && !signal?.aborted) {
        const index = cursor++
        sizes[index] = await tileBytes(releases[index].release, zoom, row, col, signal)
      }
    }),
  )
  if (signal?.aborted) throw new DOMException('release probe aborted', 'AbortError')

  const distinct: WaybackDistinct[] = []
  let previous: number | null = null
  releases.forEach((release, index) => {
    const bytes = sizes[index]
    if (bytes == null || bytes === previous) return
    previous = bytes
    distinct.push({ ...release, bytes })
  })

  distinctCache.set(key, distinct)
  return distinct
}

// ── place search ───────────────────────────────────────────────────────────

const GEOCODER = 'https://geocode.arcgis.com/arcgis/rest/services/World/GeocodeServer/findAddressCandidates'

export async function geocode(query: string, { signal, limit = 5 }: { signal?: AbortSignal; limit?: number } = {}): Promise<GeoHit[]> {
  const url = `${GEOCODER}?f=json&maxLocations=${limit}&singleLine=${encodeURIComponent(query)}`
  const res = await fetch(url, { signal })
  if (!res.ok) throw new Error(`Geocoder responded ${res.status}`)
  const body = (await res.json()) as {
    candidates?: { address: string; location: { x: number; y: number }; score: number }[]
  }
  return (body?.candidates ?? [])
    .filter((candidate) => candidate?.location)
    .map((candidate) => ({
      label: candidate.address,
      lon: candidate.location.x,
      lat: candidate.location.y,
      score: candidate.score,
    }))
}
