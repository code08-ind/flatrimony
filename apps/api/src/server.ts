import { buildApp } from './app.js';
import { loadEnv } from './env.js';
import { createDatabase } from './lib/db.js';
import { pgSystemRepository } from './modules/system/pg-repository.js';
import { pgBansRepository } from './modules/auth/bans.js';
import { cachedSessionLookup, pgSessionLookup } from './modules/auth/sessions.js';
import { pgMeRepository } from './modules/me/repository.js';
import { pgVerificationRepository } from './modules/verification/repository.js';
import { supabasePhotoStorage } from './lib/photo-storage.js';
import { restrictImageDecoders } from './lib/image.js';

const env = loadEnv();
// Only JPEG and WebP decoders may read uploaded bytes (review T2.10).
restrictImageDecoders();
// Without DATABASE_URL (local only, enforced by loadEnv) the API serves in-memory defaults
// and /readyz reports the database as skipped.
const db = env.DATABASE_URL ? createDatabase(env.DATABASE_URL) : undefined;
const app = await buildApp({
  env,
  ...(db
    ? {
        systemRepo: pgSystemRepository(db),
        bansRepo: pgBansRepository(db),
        // A signed-out or revoked session's token stops working (docs/05 §2).
        sessionLookup: cachedSessionLookup(pgSessionLookup(db)),
        meRepo: pgMeRepository(db),
        verificationRepo: (deps) => pgVerificationRepository(db, deps),
      }
    : {}),
  ...(env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY
    ? { photoStorage: supabasePhotoStorage(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY) }
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
