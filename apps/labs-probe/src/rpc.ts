import { fallback, http, type Transport } from "viem";

/** Tried after LMX_LABS_RPC_URL, in this order. */
export const PUBLIC_BASE_RPCS = [
  "https://base-rpc.publicnode.com",
  "https://1rpc.io/base",
  "https://mainnet.base.org",
] as const;

export const RPC_READ_ATTEMPTS = 3;

/**
 * LMX_LABS_RPC_URL first when it is set, then the public Base endpoints.
 * Duplicates are dropped.
 */
export function baseRpcUrls(configured?: string | null): string[] {
  const urls: string[] = [];
  const first = configured?.trim();
  if (first) urls.push(first);
  for (const url of PUBLIC_BASE_RPCS) {
    if (!urls.includes(url)) urls.push(url);
  }
  return urls;
}

/** Fallback transport. Reads fail over in list order. viem's own retries are off. */
export function baseTransport(configured?: string | null): Transport {
  return fallback(
    baseRpcUrls(configured).map((url) => http(url, { retryCount: 0, timeout: 10_000 })),
    { rank: false, retryCount: 0 },
  ) as Transport;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/**
 * Retry a chain read. Attempt 1 is immediate; later attempts wait 500ms, then 1000ms.
 * This does not wrap paid HTTP calls.
 */
export async function retryRead<T>(
  read: () => Promise<T>,
  wait: (ms: number) => Promise<void> = delay,
): Promise<T> {
  let last: unknown;
  for (let attempt = 1; attempt <= RPC_READ_ATTEMPTS; attempt += 1) {
    try {
      return await read();
    } catch (error) {
      last = error;
      if (attempt === RPC_READ_ATTEMPTS) break;
      await wait(500 * attempt);
    }
  }
  throw last instanceof Error ? last : new Error(String(last));
}
