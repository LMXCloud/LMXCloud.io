export type SseModelState = {
  models: string[];
  lastModel: string | null;
};

export function createSseModelState(): SseModelState {
  return { models: [], lastModel: null };
}

/**
 * Record one SSE chunk's top-level `model`.
 * `lastModel` stays the latest string (the previous single-value behavior).
 * `models` keeps every distinct string in the order it first appeared.
 */
export function observeSseModel(state: SseModelState, model: unknown): void {
  if (typeof model !== "string") return;
  state.lastModel = model;
  if (!state.models.includes(model)) state.models.push(model);
}
