/**
 * Data access for system endpoints. The Postgres implementation (Kysely) lands with T1.6/T1.7
 * once a database is reachable; until then the in-memory implementation serves the values
 * seeded in supabase/migrations/*_ref_tables.sql so clients can integrate against the contract.
 */
import type { PublicConfig, ReferenceData } from '@flatrimony/shared';

export interface SystemRepository {
  ping(): Promise<{ ok: boolean; skipped?: boolean; migrationVersion?: string }>;
  publicConfig(): Promise<PublicConfig>;
  referenceData(locale: 'en' | 'hi'): Promise<ReferenceData>;
}

/** Mirrors the production seed in migration 0003 (docs/04 §14). */
export const DEFAULT_PUBLIC_CONFIG: PublicConfig = {
  dailyLikeLimit: 50,
  features: { videoTours: false, houseAgreement: false },
  minSupportedAppVersion: '1.0.0',
  legalVersions: {}, // set by the founder with the published legal documents (T0.15)
};

export function inMemorySystemRepository(
  overrides: Partial<{ config: PublicConfig; reference: ReferenceData }> = {},
): SystemRepository {
  return {
    async ping() {
      return { ok: false, skipped: true };
    },
    async publicConfig() {
      return overrides.config ?? DEFAULT_PUBLIC_CONFIG;
    },
    async referenceData() {
      return (
        overrides.reference ?? { areas: [], habitTags: [], scenarioQuestions: [], products: [] }
      );
    },
  };
}
