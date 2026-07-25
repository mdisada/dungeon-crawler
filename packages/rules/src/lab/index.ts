// Adventure Lab explainer: raw event_log -> plain-English per-turn cards + an anomaly list, for
// catching narrative and mechanical bugs without knowing the event vocabulary. Pure + tested;
// the lab endpoint supplies events + naming context, the frontend renders the result.
export { explainEvent } from './explain.ts'
export type { ExplainContext, LaymanRow, PlayEvent, RowSeverity } from './explain.ts'
export { buildPlaythrough } from './build.ts'
export type { Issue, Playthrough, Turn } from './build.ts'
export { annotateNarration } from './narration.ts'
export type { NarrationFlag, NarrationLine, RawLine } from './narration.ts'
export { buildGuideView } from './guide.ts'
export type { GuideInput, GuideView } from './guide.ts'
