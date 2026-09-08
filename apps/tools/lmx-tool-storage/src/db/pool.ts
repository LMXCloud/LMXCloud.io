import pg from "pg";

let pool: pg.Pool | null = null;

export function getPool(): pg.Pool {
  if (pool) return pool;

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is required for Postgres storage");
  }

  pool = new pg.Pool({
    connectionString,
    ssl: connectionString.includes("localhost") ? undefined : { rejectUnauthorized: false },
    connectionTimeoutMillis: 10_000,
    idleTimeoutMillis: 20_000,
    max: 10,
    keepAlive: true,
    keepAliveInitialDelayMillis: 10_000,
  });

  pool.on("error", (err) => {
    console.error("[db] idle client error (pool will reconnect):", err.message);
  });

  return pool;
}

export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}
