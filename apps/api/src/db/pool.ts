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
    // Release clients before Neon pooler drops idle sockets.
    idleTimeoutMillis: 20_000,
    max: 10,
    keepAlive: true,
    keepAliveInitialDelayMillis: 10_000,
  });

  // Neon closes idle connections; without this handler pg throws an unhandled
  // 'error' event and can crash the whole Node process.
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
