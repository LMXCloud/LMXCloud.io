import { buildServer } from "./server.js";

async function main() {
  const { app, config } = await buildServer();

  try {
    await app.listen({ port: config.port, host: config.host });
    app.log.info(`LMX Cloud API listening on http://${config.host}:${config.port}`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

main();
