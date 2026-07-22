import { notifyFirstApiUsage } from "../notify/events.js";
import { RESOURCE_TYPE_CHAT } from "./types.js";
import type { RecordUsageInput, UsageStore } from "../usage/store.js";

export type RecordSuccessInput = Omit<
  RecordUsageInput,
  "success" | "errorCode" | "resourceType"
> & {
  resourceType?: string;
};

export type RecordFailureInput = Omit<
  RecordUsageInput,
  "success" | "promptTokens" | "completionTokens" | "cost" | "resourceType"
> & {
  resourceType?: string;
  errorCode: string;
};

/**
 * Shared success recorder for any resource type.
 * Routes call this after final tokens/cost are known; the router records failures
 * for ProviderAdapter paths. Non-router tools (e.g. web_search) must also call
 * recordProviderFailure themselves.
 */
export async function recordProviderSuccess(
  usageStore: UsageStore,
  input: RecordSuccessInput,
): Promise<string | null> {
  const usageEventId = await usageStore.recordUsage({
    ...input,
    resourceType: input.resourceType ?? RESOURCE_TYPE_CHAT,
    success: true,
    errorCode: null,
    unitPrice: input.unitPrice ?? null,
  });

  if (input.apiKeyId) {
    notifyFirstApiUsage(usageStore, {
      apiKeyId: input.apiKeyId,
      provider: input.provider,
      model: input.model,
      resourceType: input.resourceType ?? RESOURCE_TYPE_CHAT,
    });
  }

  return usageEventId;
}

/** In-route failure recorder for non-InferenceRouter dependencies. */
export async function recordProviderFailure(
  usageStore: UsageStore,
  input: RecordFailureInput,
): Promise<void> {
  try {
    await usageStore.recordUsage({
      ...input,
      resourceType: input.resourceType ?? RESOURCE_TYPE_CHAT,
      promptTokens: 0,
      completionTokens: 0,
      cost: 0,
      success: false,
      errorCode: input.errorCode,
      unitPrice: input.unitPrice ?? null,
    });
  } catch {
    // Telemetry must never fail the request path.
  }
}
