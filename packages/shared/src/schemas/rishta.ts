/** Rishta report: the match breakdown (docs/05 §7, FR-DISC-03, FR-DISC-05). */
import { z } from 'zod';
import { LifestyleAttribute } from '../enums.js';

export const RishtaReport = z.object({
  score: z.number().int().min(0).max(100),
  agreements: z.array(z.object({ attribute: LifestyleAttribute, label: z.string() })).max(3),
  biggestGap: z
    .object({ attribute: LifestyleAttribute, label: z.string(), you: z.string(), them: z.string() })
    .optional(),
  perAttribute: z.partialRecord(LifestyleAttribute, z.number().min(0).max(1)),
});
export type RishtaReport = z.infer<typeof RishtaReport>;
