import { createOpenAiCompatibleAdapter } from "./openai-compatible.js";
import { NOSANA_MODEL_MAP } from "./model-maps.js";
import { ProviderError } from "./types.js";

/** One Nosana deployment = one OpenAI-compatible /v1 endpoint. */
export interface NosanaEndpoint {
  baseUrl: string;
  /** Served model name on that deployment (defaults to catalog upstream ID). */
  upstreamId: string;
}

export interface NosanaConfig {
  apiKey: string;
  /**
   * LMX alias → deployment endpoint.
   * Only aliases present here are advertised / routable through Nosana.
   */
  endpoints: Record<string, NosanaEndpoint>;
}

/**
 * Nosana DePIN adapter — per-deployment OpenAI-compatible vLLM/LMDeploy URLs.
 * Activated when NOSANA_API_KEY + NOSANA_ENDPOINTS are set.
 *
 * Nosana does not expose a multi-model gateway: each deployed model has its own
 * https://<job-id>.node.k8s.prd.nos.ci/v1 URL. We store those after manual
 * dashboard deploys (Goal 0: cheap, no Deployments-API lifecycle management).
 */
export function createNosanaAdapter(config: NosanaConfig) {
  const aliases = Object.keys(config.endpoints);
  const healthBaseUrls = [
    ...new Set(Object.values(config.endpoints).map((ep) => ep.baseUrl)),
  ];

  return createOpenAiCompatibleAdapter({
    name: "nosana",
    tier: 3,
    costPer1kTokens: 0.00015,
    isDepin: true,
    apiKey: config.apiKey,
    healthBaseUrls,
    aliases,
    resolveBaseUrl: (model) => {
      const endpoint = lookupEndpoint(config.endpoints, model);
      if (!endpoint) {
        throw new ProviderError(
          `Model "${model}" has no Nosana deployment endpoint configured`,
          "nosana",
          400,
        );
      }
      return endpoint.baseUrl;
    },
    resolveModel: (model) => {
      const endpoint = lookupEndpoint(config.endpoints, model);
      if (!endpoint) {
        throw new ProviderError(
          `Model "${model}" has no Nosana deployment endpoint configured`,
          "nosana",
          400,
        );
      }
      return endpoint.upstreamId;
    },
  });
}

function lookupEndpoint(
  endpoints: Record<string, NosanaEndpoint>,
  model: string,
): NosanaEndpoint | undefined {
  if (endpoints[model]) return endpoints[model];

  // Allow callers to pass the catalog upstream ID when the alias is configured.
  for (const [alias, endpoint] of Object.entries(endpoints)) {
    const catalogUpstream = NOSANA_MODEL_MAP[alias];
    if (catalogUpstream === model || endpoint.upstreamId === model) {
      return endpoint;
    }
  }

  return undefined;
}
