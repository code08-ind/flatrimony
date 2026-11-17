import { buildApp } from './app.js';
import { loadEnv } from './env.js';
import { createDatabase } from './lib/db.js';
import { pgSystemRepository } from './modules/system/pg-repository.js';
import { pgBansRepository } from './modules/auth/bans.js';
import { pgMeRepository } from './modules/me/repository.js';

const env = loadEnv();
// Without DATABASE_URL (local only, enforced by loadEnv) the API serves in-memory defaults
// and /readyz reports the database as skipped.
const db = env.DATABASE_URL ? createDatabase(env.DATABASE_URL) : undefined;
const app = await buildApp({
  env,
  ...(db
    ? {
        systemRepo: pgSystemRepository(db),
        bansRepo: pgBansRepository(db),
        meRepo: pgMeRepository(db),
      }
    : {}),
});

const shutdown = async (signal: string) => {
  app.log.info({ signal }, 'shutting down');
  await app.close();
  await db?.destroy();
  process.exit(0);
};
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

await app.listen({ host: '0.0.0.0', port: env.PORT });
