import { getPool } from "../db/pool.js";
import { hasPostgres } from "./queries.js";
import { isInfraServiceId } from "./infra-spend-catalog.js";

export type InfraSpendKind = "spend" | "balance" | "note";

export type InfraSpendEntry = {
  id: string;
  service: string;
  amount: number;
  date: string;
  note: string | null;
  kind: InfraSpendKind;
  createdAt: string;
};

export type InfraSpendInsert = {
  service: string;
  amount: number;
  date: string;
  note?: string | null;
  kind?: InfraSpendKind;
};

const KINDS = new Set<InfraSpendKind>(["spend", "balance", "note"]);

function isKind(value: unknown): value is InfraSpendKind {
  return typeof value === "string" && KINDS.has(value as InfraSpendKind);
}

function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

export function parseInfraSpendInsert(
  body: unknown,
): { ok: true; value: InfraSpendInsert } | { ok: false; message: string } {
  if (!body || typeof body !== "object") {
    return { ok: false, message: "Expected a JSON object" };
  }
  const rec = body as Record<string, unknown>;
  const service = typeof rec.service === "string" ? rec.service.trim() : "";
  if (!isInfraServiceId(service)) {
    return { ok: false, message: "Unknown service" };
  }
  const amount = typeof rec.amount === "number" ? rec.amount : Number(rec.amount);
  if (!Number.isFinite(amount)) {
    return { ok: false, message: "amount must be a finite number" };
  }
  const date = typeof rec.date === "string" ? rec.date.trim() : "";
  if (!isIsoDate(date)) {
    return { ok: false, message: "date must be YYYY-MM-DD" };
  }
  const note =
    rec.note == null || rec.note === ""
      ? null
      : typeof rec.note === "string"
        ? rec.note.trim() || null
        : undefined;
  if (note === undefined) {
    return { ok: false, message: "note must be a string" };
  }
  const kind = rec.kind == null ? "spend" : rec.kind;
  if (!isKind(kind)) {
    return { ok: false, message: "kind must be spend, balance, or note" };
  }
  return { ok: true, value: { service, amount, date, note, kind } };
}

interface InfraSpendRow {
  id: string;
  service: string;
  amount: string;
  occurred_on: Date | string;
  note: string | null;
  kind: string;
  created_at: Date | string;
}

function dateOnly(value: Date | string): string {
  if (typeof value === "string") return value.slice(0, 10);
  return value.toISOString().slice(0, 10);
}

function iso(value: Date | string): string {
  if (typeof value === "string") return new Date(value).toISOString();
  return value.toISOString();
}

function mapRow(row: InfraSpendRow): InfraSpendEntry {
  return {
    id: row.id,
    service: row.service,
    amount: Number(row.amount),
    date: dateOnly(row.occurred_on),
    note: row.note,
    kind: isKind(row.kind) ? row.kind : "spend",
    createdAt: iso(row.created_at),
  };
}

export async function listInfraSpendEntries(limit = 200): Promise<InfraSpendEntry[]> {
  if (!hasPostgres()) return [];
  const result = await getPool().query<InfraSpendRow>(
    `SELECT id, service, amount, occurred_on, note, kind, created_at
     FROM infra_spend_entries
     ORDER BY occurred_on DESC, created_at DESC
     LIMIT $1`,
    [Math.max(1, Math.min(limit, 500))],
  );
  return result.rows.map(mapRow);
}

export async function insertInfraSpendEntry(
  input: InfraSpendInsert,
): Promise<InfraSpendEntry> {
  if (!hasPostgres()) {
    throw new Error("DATABASE_URL is required to log vendor spend");
  }
  const result = await getPool().query<InfraSpendRow>(
    `INSERT INTO infra_spend_entries (service, amount, occurred_on, note, kind)
     VALUES ($1, $2, $3::date, $4, $5)
     RETURNING id, service, amount, occurred_on, note, kind, created_at`,
    [
      input.service,
      input.amount,
      input.date,
      input.note ?? null,
      input.kind ?? "spend",
    ],
  );
  const row = result.rows[0];
  if (!row) throw new Error("Insert returned no row");
  return mapRow(row);
}
