import { createPool, migrate } from "@grids/database";
import { createApp } from "./app.js";
import { readConfig } from "./config.js";

const config = readConfig(process.env);
const pool = createPool(config.databaseUrl);
pool.on("error", () => console.error("An idle database connection failed."));
await migrate(pool);
const server = createApp(config, pool).listen(config.port, () => {
  console.log(`Gridz API listening on port ${config.port}.`);
});
const cleanup = setInterval(() => {
  void pool.query("DELETE FROM oauth_states WHERE expires_at <= now()")
    .then(() => pool.query("DELETE FROM sessions WHERE expires_at <= now()"))
    .catch(() => console.error("Expired authentication record cleanup failed."));
}, 60000);
cleanup.unref();
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    clearInterval(cleanup);
    server.close(() => { void pool.end(); });
  });
}
