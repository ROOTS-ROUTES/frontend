import { CloudSun, Radar, Satellite, TrendingUp, type LucideIcon } from 'lucide-react'

export interface Suggestion {
  icon: LucideIcon
  title: string
  prompt: string
}

export const SUGGESTIONS: Suggestion[] = [
  {
    icon: Satellite,
    title: 'Scene search',
    prompt: 'Find the clearest Sentinel-2 scenes over the Nile Delta in the last 10 days.',
  },
  {
    icon: Radar,
    title: 'SAR query',
    prompt: 'Which SAR acquisitions are available for Amsterdam in the past 30 days?',
  },
  {
    icon: TrendingUp,
    title: 'NDVI trend',
    prompt: 'Compare the NDVI trend for the Ganges river basin, 2026 vs 2025.',
  },
  {
    icon: CloudSun,
    title: 'Cloud cover',
    prompt: "What is the average cloud cover over Munich this month, by band?",
  },
]
