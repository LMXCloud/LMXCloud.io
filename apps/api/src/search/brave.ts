/**
 * Brave Search API client (passthrough — not a DePIN ProviderAdapter).
 *
 * Endpoint: GET https://api.search.brave.com/res/v1/web/search
 * Auth: X-Subscription-Token
 * Wholesale: ~$5 / 1k requests on the Search plan (flat per-call).
 */
export interface BraveSearchConfig {
  apiKey: string;
  baseUrl: string;
}

export interface WebSearchResult {
  title: string;
  url: string;
  snippet: string;
}

export interface BraveWebSearchResponse {
  results: WebSearchResult[];
  rawQuery: string;
  latencyMs: number;
}

export class BraveSearchError extends Error {
  constructor(
    message: string,
    readonly statusCode?: number,
  ) {
    super(message);
    this.name = "BraveSearchError";
  }
}

interface BraveWebHit {
  title?: string;
  url?: string;
  description?: string;
}

interface BraveApiPayload {
  query?: { original?: string };
  web?: { results?: BraveWebHit[] };
}

export async function braveWebSearch(
  config: BraveSearchConfig,
  options: { query: string; count: number },
): Promise<BraveWebSearchResponse> {
  const started = Date.now();
  const base = config.baseUrl.replace(/\/$/, "");
  const url = new URL(`${base}/web/search`);
  url.searchParams.set("q", options.query);
  url.searchParams.set("count", String(options.count));

  let response: Response;
  try {
    response = await fetch(url, {
      method: "GET",
      headers: {
        Accept: "application/json",
        "Accept-Encoding": "gzip",
        "X-Subscription-Token": config.apiKey,
      },
    });
  } catch (err) {
    throw new BraveSearchError(
      `Brave Search request failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  const text = await response.text();
  if (!response.ok) {
    throw new BraveSearchError(
      `Brave Search returned ${response.status}: ${text.slice(0, 300)}`,
      response.status,
    );
  }

  let payload: BraveApiPayload;
  try {
    payload = JSON.parse(text) as BraveApiPayload;
  } catch {
    throw new BraveSearchError("Brave Search returned invalid JSON");
  }

  const results = (payload.web?.results ?? [])
    .filter((hit) => typeof hit.url === "string" && hit.url.length > 0)
    .map((hit) => ({
      title: hit.title?.trim() || hit.url!,
      url: hit.url!,
      snippet: hit.description?.trim() || "",
    }));

  return {
    results,
    rawQuery: payload.query?.original ?? options.query,
    latencyMs: Date.now() - started,
  };
}
