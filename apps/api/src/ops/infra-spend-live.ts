export type LiveSpendPoint = {
  service: string;
  amountUsd: number;
  month: string;
  amountKind: string;
  checkUrl: string;
  asOf: string;
};

export type LivePullResult =
  | { status: "skipped"; reason: string }
  | { status: "error"; error: string; checkUrl?: string }
  | { status: "ok"; points: LiveSpendPoint[] };

const RAILWAY_GRAPHQL = "https://backboard.railway.com/graphql/v2";
const NEON_CONSUMPTION =
  "https://console.neon.tech/api/v2/consumption_history/v2/projects";
const DEFAULT_NEON_CU_HOUR_USD = 0.106;

function monthKey(iso: string | Date): string {
  const d = typeof iso === "string" ? new Date(iso) : iso;
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

function currentMonth(now = new Date()): string {
  return monthKey(now);
}

function moneyToUsd(raw: unknown, unit: "cents" | "usd"): number | null {
  if (typeof raw !== "number" || !Number.isFinite(raw)) return null;
  return unit === "cents" ? raw / 100 : raw;
}

type GraphqlBody = {
  data?: {
    workspace?: {
      id?: string;
      customer?: {
        subscriptions?: Array<{ nextInvoiceCurrentTotal?: number | null }>;
      };
    };
    me?: {
      workspaces?: { edges?: Array<{ node?: { id?: string } }> };
    };
  };
  errors?: Array<{ message?: string }>;
};

async function railwayGraphql(
  token: string,
  query: string,
  variables: Record<string, unknown>,
): Promise<GraphqlBody> {
  const response = await fetch(RAILWAY_GRAPHQL, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ query, variables }),
    signal: AbortSignal.timeout(12_000),
  });
  if (!response.ok) {
    throw new Error(`Railway GraphQL HTTP ${response.status}`);
  }
  return (await response.json()) as GraphqlBody;
}

export async function pullRailwaySpend(
  env: NodeJS.ProcessEnv = process.env,
): Promise<LivePullResult> {
  const token = env.RAILWAY_TOKEN?.trim();
  if (!token) {
    return {
      status: "skipped",
      reason:
        "Railway GraphQL needs RAILWAY_TOKEN (account token). Current-cycle cost is dashboard-only until then.",
    };
  }

  const unit = env.RAILWAY_BILLING_UNIT?.trim() === "usd" ? "usd" : "cents";
  const checkUrl = "https://railway.com/dashboard";

  try {
    let workspaceId = env.RAILWAY_WORKSPACE_ID?.trim() ?? "";
    if (!workspaceId) {
      const me = await railwayGraphql(
        token,
        `query { me { workspaces { edges { node { id } } } } }`,
        {},
      );
      workspaceId = me.data?.me?.workspaces?.edges?.[0]?.node?.id ?? "";
    }
    if (!workspaceId) {
      return {
        status: "error",
        error: "Set RAILWAY_WORKSPACE_ID — could not infer a workspace from the token.",
        checkUrl,
      };
    }

    const body = await railwayGraphql(
      token,
      `query CurrentCycle($workspaceId: String!) {
        workspace(workspaceId: $workspaceId) {
          customer {
            subscriptions {
              nextInvoiceCurrentTotal
            }
          }
        }
      }`,
      { workspaceId },
    );

    if (body.errors?.length) {
      return {
        status: "error",
        error: body.errors.map((e) => e.message ?? "GraphQL error").join("; "),
        checkUrl,
      };
    }

    const total =
      body.data?.workspace?.customer?.subscriptions?.[0]?.nextInvoiceCurrentTotal ??
      null;
    const amountUsd = moneyToUsd(total, unit);
    if (amountUsd == null) {
      return {
        status: "error",
        error: "Railway returned no nextInvoiceCurrentTotal for this workspace.",
        checkUrl,
      };
    }

    return {
      status: "ok",
      points: [
        {
          service: "railway",
          amountUsd,
          month: currentMonth(),
          amountKind: "current billing cycle (Railway GraphQL)",
          checkUrl,
          asOf: new Date().toISOString(),
        },
      ],
    };
  } catch (err) {
    return {
      status: "error",
      error: err instanceof Error ? err.message : "Railway GraphQL request failed",
      checkUrl,
    };
  }
}

type NeonMetric = { metric_name?: string; value?: number };
type NeonConsumption = {
  compute_unit_seconds?: number;
  metrics?: NeonMetric[];
  timeframe_start?: string;
};
type NeonResponse = {
  projects?: Array<{
    periods?: Array<{ consumption?: NeonConsumption[] }>;
  }>;
};

export function cuSecondsFromConsumption(row: NeonConsumption): number {
  if (typeof row.compute_unit_seconds === "number") return row.compute_unit_seconds;
  const metric = row.metrics?.find((m) => m.metric_name === "compute_unit_seconds");
  return typeof metric?.value === "number" ? metric.value : 0;
}

export function neonCuHourRateUsd(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.NEON_CU_HOUR_USD?.trim();
  if (!raw) return DEFAULT_NEON_CU_HOUR_USD;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : DEFAULT_NEON_CU_HOUR_USD;
}

export async function pullNeonSpend(
  env: NodeJS.ProcessEnv = process.env,
  now = new Date(),
): Promise<LivePullResult> {
  const apiKey = env.NEON_API_KEY?.trim();
  const orgId = env.NEON_ORG_ID?.trim();
  const checkUrl = "https://console.neon.tech";
  if (!apiKey || !orgId) {
    return {
      status: "skipped",
      reason:
        "Neon consumption API needs NEON_API_KEY and NEON_ORG_ID. Launch plan is usage-based ($0.106/CU-hr) — log invoices until those are set.",
    };
  }

  const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const to = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  const rate = neonCuHourRateUsd(env);
  const url = new URL(NEON_CONSUMPTION);
  url.searchParams.set("org_id", orgId);
  url.searchParams.set("from", from.toISOString());
  url.searchParams.set("to", to.toISOString());
  url.searchParams.set("granularity", "monthly");
  url.searchParams.set("metrics", "compute_unit_seconds");

  try {
    const response = await fetch(url, {
      headers: { authorization: `Bearer ${apiKey}`, accept: "application/json" },
      signal: AbortSignal.timeout(12_000),
    });
    if (!response.ok) {
      return {
        status: "error",
        error: `Neon consumption HTTP ${response.status}`,
        checkUrl,
      };
    }
    const body = (await response.json()) as NeonResponse;
    let cuSeconds = 0;
    for (const project of body.projects ?? []) {
      for (const period of project.periods ?? []) {
        for (const row of period.consumption ?? []) {
          cuSeconds += cuSecondsFromConsumption(row);
        }
      }
    }
    const amountUsd = (cuSeconds / 3600) * rate;
    return {
      status: "ok",
      points: [
        {
          service: "neon",
          amountUsd,
          month: currentMonth(now),
          amountKind: `estimated CU-hour cost @ $${rate.toFixed(3)}/CU-hr`,
          checkUrl,
          asOf: now.toISOString(),
        },
      ],
    };
  } catch (err) {
    return {
      status: "error",
      error: err instanceof Error ? err.message : "Neon consumption request failed",
      checkUrl,
    };
  }
}

export async function pullLiveSpend(env: NodeJS.ProcessEnv = process.env): Promise<{
  points: LiveSpendPoint[];
  byService: Record<string, LivePullResult>;
}> {
  const [railway, neon] = await Promise.all([
    pullRailwaySpend(env),
    pullNeonSpend(env),
  ]);
  const byService: Record<string, LivePullResult> = {
    railway,
    neon,
  };
  const points: LiveSpendPoint[] = [];
  if (railway.status === "ok") points.push(...railway.points);
  if (neon.status === "ok") points.push(...neon.points);
  return { points, byService };
}
