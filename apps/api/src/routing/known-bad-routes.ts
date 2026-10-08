/**
 * Provider routes we will not send.
 * Delete an entry to restore the previous behavior for that route.
 */
export interface KnownBadRoute {
  provider: string;
  model: string;
  /** Request `stream` value this entry matches. */
  stream: boolean;
  reason: string;
  /** Day the failure was confirmed (YYYY-MM-DD). */
  date: string;
}

export const KNOWN_BAD_ROUTES: readonly KnownBadRoute[] = [
  {
    provider: "akash",
    model: "qwen-3.5-35b",
    stream: true,
    reason: "Akash streaming returns chunks labeled Qwen/Qwen3.6-35B-A3B",
    date: "2026-10-08",
  },
];

export function isKnownBadRoute(provider: string, model: string, stream: boolean): boolean {
  return KNOWN_BAD_ROUTES.some(
    (entry) => entry.provider === provider && entry.model === model && entry.stream === stream,
  );
}
