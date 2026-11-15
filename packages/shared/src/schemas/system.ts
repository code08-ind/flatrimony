/** Health, public config, reference data and the OTP guard (docs/05 §2, §8.1). */
import { z } from 'zod';
import { LifestyleAttribute, ProductCode } from '../enums.js';
import { IndianPhone, LatLng, Paise, SemVer } from '../primitives.js';

export const HealthResponse = z.object({ status: z.literal('ok') });

export const ReadyResponse = z.object({
  status: z.enum(['ready', 'not_ready']),
  checks: z.record(z.string(), z.enum(['ok', 'fail', 'skipped'])),
  migrationVersion: z.string().optional(),
});

/** `GET /v1/config` — only `is_public` keys from ref.app_config. */
export const PublicConfig = z.object({
  dailyLikeLimit: z.number().int().positive(),
  features: z.object({ videoTours: z.boolean(), houseAgreement: z.boolean() }),
  minSupportedAppVersion: SemVer,
});
export type PublicConfig = z.infer<typeof PublicConfig>;

export const Area = z.object({
  id: z.number().int().positive(),
  slug: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/),
  name: z.string().min(1),
  city: z.enum(['delhi', 'gurugram', 'noida', 'greater_noida', 'ghaziabad', 'faridabad']),
  centroid: LatLng,
});

export const HabitTag = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  attribute: LifestyleAttribute.nullable(),
});

export const ScenarioQuestion = z.object({
  id: z.string().min(1),
  attribute: LifestyleAttribute,
  prompt: z.string().min(1),
  options: z
    .array(z.object({ id: z.string().min(1), label: z.string().min(1), value: z.number().min(0).max(1) }))
    .min(2)
    .max(5),
});

export const Product = z.object({
  code: ProductCode,
  name: z.string().min(1),
  pricePaise: Paise.positive(),
  durationDays: z.number().int().positive(),
});

/** `GET /v1/reference` — localised by Accept-Language. */
export const ReferenceData = z.object({
  areas: z.array(Area),
  habitTags: z.array(HabitTag),
  scenarioQuestions: z.array(ScenarioQuestion),
  products: z.array(Product),
});
export type ReferenceData = z.infer<typeof ReferenceData>;

/** `POST /v1/auth/otp-guard` (FR-AUTH-02, FR-AUTH-08). */
export const OtpGuardRequest = z.object({
  phone: IndianPhone,
  deviceId: z.string().min(8).max(200),
  integrityToken: z.string().min(1).max(20_000).optional(),
});
export const OtpGuardResponse = z.object({ allowed: z.literal(true) });
