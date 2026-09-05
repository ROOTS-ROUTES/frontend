import { formatLatLon, type Aoi } from '../lib/basemap'
import type { ChatMessage, ImageryConfig } from '../types'

function buildAnswer(query: string, aoi?: Aoi, imagery?: ImageryConfig): string {
  const context: string[] = []
  if (aoi) context.push(`**Area:** ${formatLatLon(aoi.lat, aoi.lon)} · zoom ${aoi.zoom} (picked on the map)`)
  if (imagery?.mode === 'bitemporal' && imagery.t1 && imagery.t2)
    context.push(`**Imagery:** bi-temporal pair ${imagery.t1.date} → ${imagery.t2.date} (Wayback releases)`)
  else if (imagery?.mode === 'sar')
    context.push(
      `**Imagery:** simulated C-band VV amplitude, ${imagery.t1 ? 'Wayback ' + imagery.t1.date + ' base' : 'current mosaic base'} (modelled from the optical capture — not a radar measurement)`,
    )
  else if (imagery?.mode === 'optical')
    context.push(
      `**Imagery:** optical, ${imagery.t1 ? 'Wayback ' + imagery.t1.date : 'current Esri World Imagery mosaic'}`,
    )

  const intro = "Here's what I found for **" + query + "**."

  const body =
    imagery?.mode === 'bitemporal'
      ? [
          '',
          '## Change analysis (T1 → T2)',
          '',
          '| Metric                | Value        |',
          '| --------------------- | ------------ |',
          '| Changed fraction      | 7.4%         |',
          '| New built-up          | +3.1%        |',
          '| Lost vegetation       | −1.8%        |',
          '| Mask stability        | 0.92 IoU     |',
          '',
          '### Highlights',
          '',
          '1. Expansion pattern along the eastern edge between the two acquisitions',
          '2. Seasonal water-body shrink in the north-west quadrant',
          '3. No detectable change under persistent cloud (T2)',
          '',
        ]
      : imagery?.mode === 'sar'
        ? [
            '',
            '## Radar analysis (C-band VV)',
            '',
            '| Metric                 | Value            |',
            '| ---------------------- | ---------------- |',
            '| Mean backscatter       | −13.2 dB         |',
            '| Built-up fraction      | 21.4%            |',
            '| Water fraction         | 4.1%             |',
            '| Speckle (post-Lee)     | 0.08             |',
            '',
            '### What the radar sees',
            '',
            '1. Urban bright targets dominate the central footprint',
            '2. Water bodies read as deep black (< −25 dB)',
            '3. Vegetated flanks show mid-level backscatter with texture',
            '',
            '> The SAR scene is a **simulation** modelled from the optical capture — no public radar archive serves tiles without credentials.',
            '',
          ]
        : imagery?.mode === 'optical'
          ? [
              '',
              '## Scene overview (optical)',
              '',
              '| Attribute      | Value                     |',
              '| -------------- | ------------------------- |',
              '| Source         | Esri World Imagery        |',
              '| Display stretch| RGB (uncalibrated)        |',
              '| Cloud fraction | est. 8%                   |',
              '| Dominant cover | built-up, then vegetation |',
              '',
              '### Land-cover read',
              '',
              '1. Built-up dominates the central footprint (~21%)',
              '2. Vegetated flanks with visible parcel structure',
              '3. Linear water feature in the north-west quadrant',
              '',
            ]
          : [
              '',
              '### Suggested next steps',
              '',
              '1. Pick an area and imager in the map box to ground the answer',
              '2. Try a bi-temporal pair for change analysis',
              '',
            ]

  return [intro, ...context.map((c) => `> ${c}`), ...body, '> **Heads up:** this reply comes from the built-in mock. Wire your RAG backend in `src/api/chat.ts` and set `VITE_USE_MOCK=false` to see real answers.', '',].join(
    '\n',
  )
}

/**
 * Simulates a streaming RAG response so the UI (streaming, stop, markdown)
 * can be exercised before a real backend exists.
 */
export function mockStream(
  history: ChatMessage[],
  onDelta: (delta: string) => void,
  signal: AbortSignal,
): Promise<void> {
  const lastUser = [...history].reverse().find((m) => m.role === 'user')
  const answer = buildAnswer(lastUser?.content ?? 'your query', lastUser?.aoi, lastUser?.imagery)
  const tokens = answer.match(/\S+\s*/g) ?? []

  return new Promise<void>((resolve) => {
    let i = 0
    let timer: number | undefined
    let settled = false

    const finish = () => {
      if (settled) return
      settled = true
      if (timer !== undefined) window.clearTimeout(timer)
      resolve()
    }

    signal.addEventListener('abort', finish, { once: true })

    const tick = () => {
      if (settled) return
      if (i >= tokens.length) return finish()
      onDelta(tokens[i])
      i += 1
      timer = window.setTimeout(tick, 12 + Math.random() * 42)
    }

    // small "thinking" delay before the first token
    timer = window.setTimeout(tick, 550)
  })
}
