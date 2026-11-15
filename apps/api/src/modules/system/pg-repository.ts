/**
 * Postgres-backed system repository: health, public remote config (ref.app_config where
 * is_public) and localised reference data (docs/05 §8.1). Reads only `ref` and the
 * migration history; never touches user data.
 */
import { sql } from 'kysely';
import {
  PublicConfig,
  ReferenceData,
  type ReferenceData as ReferenceDataT,
} from '@flatrimony/shared';
import type { Database } from '../../lib/db.js';
import type { SystemRepository } from './repository.js';

interface ScenarioOptionRow {
  id: string;
  label_en: string;
  label_hi: string;
  value: number;
}

export function pgSystemRepository(db: Database): SystemRepository {
  return {
    async ping() {
      try {
        const row = await db
          .selectFrom('supabase_migrations.schema_migrations')
          .select('version')
          .orderBy('version', 'desc')
          .limit(1)
          .executeTakeFirst();
        return { ok: true, ...(row?.version ? { migrationVersion: row.version } : {}) };
      } catch {
        return { ok: false };
      }
    },

    async publicConfig() {
      const rows = await db
        .selectFrom('ref.app_config')
        .select(['key', 'value'])
        .where('is_public', '=', true)
        .execute();
      const v = new Map(rows.map((r) => [r.key, r.value as unknown]));
      // Parse, so a bad value in the table fails loudly instead of reaching clients.
      return PublicConfig.parse({
        dailyLikeLimit: v.get('daily_like_limit'),
        features: {
          videoTours: v.get('feature.video_tours') ?? false,
          houseAgreement: v.get('feature.house_agreement') ?? false,
        },
        minSupportedAppVersion: v.get('min_supported_app_version'),
      });
    },

    async referenceData(locale): Promise<ReferenceDataT> {
      const hi = locale === 'hi';
      const [areas, habitTags, scenarios, products] = await Promise.all([
        db
          .selectFrom('ref.areas')
          .select([
            'id',
            'slug',
            'name_en',
            'name_hi',
            'city',
            sql<number>`extensions.st_y(centroid::extensions.geometry)`.as('lat'),
            sql<number>`extensions.st_x(centroid::extensions.geometry)`.as('lng'),
          ])
          .where('is_active', '=', true)
          .orderBy('city')
          .orderBy('name_en')
          .execute(),
        db
          .selectFrom('ref.habit_tags')
          .select(['id', 'label_en', 'label_hi', 'attribute'])
          .where('is_active', '=', true)
          .orderBy('sort_order')
          .execute(),
        db
          .selectFrom('ref.scenario_questions')
          .select(['id', 'attribute', 'prompt_en', 'prompt_hi', 'options'])
          .where('is_active', '=', true)
          .orderBy('sort_order')
          .execute(),
        db
          .selectFrom('ref.products')
          .select(['code', 'name_en', 'name_hi', 'price_paise', 'duration_days'])
          .where('is_active', '=', true)
          .orderBy('code')
          .execute(),
      ]);

      return ReferenceData.parse({
        areas: areas.map((a) => ({
          id: a.id,
          slug: a.slug,
          name: hi ? a.name_hi : a.name_en,
          city: a.city,
          centroid: { lat: Number(a.lat), lng: Number(a.lng) },
        })),
        habitTags: habitTags.map((t) => ({
          id: t.id,
          label: hi ? t.label_hi : t.label_en,
          attribute: t.attribute,
        })),
        scenarioQuestions: scenarios.map((q) => ({
          id: q.id,
          attribute: q.attribute,
          prompt: hi ? q.prompt_hi : q.prompt_en,
          options: (q.options as unknown as ScenarioOptionRow[]).map((o) => ({
            id: o.id,
            label: hi ? o.label_hi : o.label_en,
            value: o.value,
          })),
        })),
        products: products.map((p) => ({
          code: p.code,
          name: hi ? p.name_hi : p.name_en,
          pricePaise: Number(p.price_paise),
          durationDays: p.duration_days,
        })),
      });
    },
  };
}
