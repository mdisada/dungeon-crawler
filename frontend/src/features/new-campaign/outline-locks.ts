import type { CampaignOutline, OutlineLocks } from './types'

export function buildDefaultLocks(outline: CampaignOutline): OutlineLocks {
  return {
    chapters: outline.chapters.map((chapter) => ({
      locked: false,
      sessions: chapter.sessions.map(() => false),
    })),
  }
}
