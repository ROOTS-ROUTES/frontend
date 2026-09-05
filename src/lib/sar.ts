/**
 * Simulated SAR amplitude, derived from a real optical capture's pixels.
 *
 * No public radar archive serves tiles without credentials, so the SAR product
 * is a model — bright hard edges (roofs/roads) stand in for double-bounce,
 * water is pushed near-black (specular), and Rayleigh-ish speckle is multiplied
 * on top. It is always labelled a simulation.
 */

function mulberry32(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function simulateSar(source: HTMLCanvasElement, seed = 20260826): HTMLCanvasElement {
  const width = source.width
  const height = source.height
  const read = document.createElement('canvas')
  read.width = width
  read.height = height
  const readCtx = read.getContext('2d')!
  readCtx.drawImage(source, 0, 0)
  const src = readCtx.getImageData(0, 0, width, height).data

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')!
  const out = ctx.createImageData(width, height)
  const rnd = mulberry32(seed + 4241)

  for (let i = 0; i < width * height; i++) {
    const p = i * 4
    const r = src[p]
    const g = src[p + 1]
    const b = src[p + 2]
    const luma = (0.299 * r + 0.587 * g + 0.114 * b) / 255

    // Water reads blue-dominant and dark in optical, darkest in radar amplitude.
    const wet = b > r * 1.08 && luma < 0.42
    // Grey, unsaturated, bright = roof and road — strong radar return.
    const chroma = (Math.max(r, g, b) - Math.min(r, g, b)) / 255
    const hard = chroma < 0.14 && luma > 0.34

    let amplitude = wet ? luma * 0.16 : hard ? 0.4 + luma * 0.72 : 0.22 + luma * 0.58
    const speckle = (rnd() + rnd() + rnd() + rnd()) / 2
    amplitude *= 0.55 + speckle * 0.45

    const value = Math.max(0, Math.min(255, amplitude * 255))
    out.data[p] = out.data[p + 1] = out.data[p + 2] = value
    out.data[p + 3] = 255
  }

  ctx.putImageData(out, 0, 0)
  return canvas
}
