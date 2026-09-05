import type { ImageryMode } from '../types'

export interface ImageryModeInfo {
  id: ImageryMode
  label: string
  blurb: string
}

/** The three imagery configurations the pipeline can answer from. */
export const IMAGERY_MODES: ImageryModeInfo[] = [
  {
    id: 'optical',
    label: 'Optical',
    blurb:
      'True-colour Esri World Imagery of the chosen footprint — the current mosaic or any dated release from the Wayback archive.',
  },
  {
    id: 'sar',
    label: 'SAR',
    blurb:
      'Radar amplitude (C-band VV, Lee-filtered) for the chosen footprint. No public radar archive serves tiles without credentials, so the scene is modelled from the optical capture at the chosen date and flagged synthetic.',
  },
  {
    id: 'bitemporal',
    label: 'Bi-Temporal Pair',
    blurb:
      'Two dated acquisitions of one footprint at different dates. Drives change description, change VQA and change maps.',
  },
]

export const imageryLabel = (id: ImageryMode): string =>
  IMAGERY_MODES.find((m) => m.id === id)?.label ?? id
