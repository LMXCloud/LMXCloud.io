export type RoutingStrategy = "cheapest" | "fastest" | "depin-only" | "default";

export interface RoutingPreference {
  strategy: RoutingStrategy;
  preferredProvider?: string;
}

const PROVIDER_PREFIX = "provider:";

export function parseRoutingPreference(header: string | undefined): RoutingPreference {
  if (!header) {
    return { strategy: "default" };
  }

  const value = header.trim().toLowerCase();

  if (value === "cheapest") return { strategy: "cheapest" };
  if (value === "fastest") return { strategy: "fastest" };
  if (value === "depin-only") return { strategy: "depin-only" };

  if (value.startsWith(PROVIDER_PREFIX)) {
    return {
      strategy: "default",
      preferredProvider: value.slice(PROVIDER_PREFIX.length),
    };
  }

  return { strategy: "default" };
}
