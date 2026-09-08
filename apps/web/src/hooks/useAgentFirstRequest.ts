import { useEffect, useRef, useState } from "react";
import { fetchKeys, fetchPayments } from "../api";
import { isAgentConnected } from "../lib/agent-status";

const POLL_MS = 4_000;

export type AgentFirstRequestWatch =
  | { mode: "key"; keyId: string }
  | { mode: "wallet"; wallet: string };

interface UseAgentFirstRequestOptions {
  sessionToken: string | null;
  watch: AgentFirstRequestWatch | null;
  /** Ignore last_used_at / payments from before the user started waiting. */
  startedAt: number;
}

export function useAgentFirstRequest({
  sessionToken,
  watch,
  startedAt,
}: UseAgentFirstRequestOptions): {
  connected: boolean;
  lastUsedAt: string | null;
  polling: boolean;
  error: string | null;
} {
  const [connected, setConnected] = useState(false);
  const [lastUsedAt, setLastUsedAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const enabled = Boolean(sessionToken && watch && startedAt > 0);
  const watchKey =
    watch?.mode === "key"
      ? `key:${watch.keyId}`
      : watch?.mode === "wallet"
        ? `wallet:${watch.wallet.toLowerCase()}`
        : null;
  const watchRef = useRef(watch);
  watchRef.current = watch;

  useEffect(() => {
    setConnected(false);
    setLastUsedAt(null);
    setError(null);

    if (!enabled || !watchKey) {
      return;
    }

    let cancelled = false;
    let timer: number | undefined;

    async function tick() {
      const current = watchRef.current;
      if (!sessionToken || !current) return;
      try {
        if (current.mode === "key") {
          const keysRes = await fetchKeys(sessionToken);
          if (cancelled) return;
          const key = keysRes.data.find((item) => item.id === current.keyId);
          const usedAt = key?.last_used_at ?? null;
          if (isAgentConnected(usedAt, startedAt - 2_000)) {
            setLastUsedAt(usedAt);
            setConnected(true);
            setError(null);
            return;
          }
          setLastUsedAt(usedAt);
        } else {
          const wallet = current.wallet.toLowerCase();
          const [keysRes, paymentsRes] = await Promise.all([
            fetchKeys(sessionToken),
            fetchPayments(sessionToken, { limit: 25, days: 1 }).catch(() => null),
          ]);
          if (cancelled) return;

          const matchingKey = keysRes.data.find((item) => {
            if (item.is_current) return false;
            if (item.wallet?.toLowerCase() !== wallet) return false;
            return isAgentConnected(item.last_used_at, startedAt - 2_000);
          });

          const matchingPayment = paymentsRes?.data.find((payment) => {
            if (payment.payer_wallet.toLowerCase() !== wallet) return false;
            if (
              payment.status !== "completed" &&
              payment.status !== "settled" &&
              payment.status !== "fulfilling" &&
              payment.status !== "verified"
            ) {
              return false;
            }
            const at = new Date(payment.created_at).getTime();
            return Number.isFinite(at) && at >= startedAt - 2_000;
          });

          if (matchingKey || matchingPayment) {
            setLastUsedAt(
              matchingKey?.last_used_at ?? matchingPayment?.created_at ?? null,
            );
            setConnected(true);
            setError(null);
            return;
          }
        }
        setError(null);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to check agent status");
        }
      }

      if (!cancelled) {
        timer = window.setTimeout(() => {
          void tick();
        }, POLL_MS);
      }
    }

    void tick();

    return () => {
      cancelled = true;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [enabled, sessionToken, watchKey, startedAt]);

  return {
    connected,
    lastUsedAt,
    polling: enabled && !connected,
    error,
  };
}
