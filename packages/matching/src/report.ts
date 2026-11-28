/**
 * The Rishta report's facts (spec §5.1 step 4; FR-DISC-03, FR-DISC-05): the score, the top 3
 * agreements and the biggest gap, from the viewer's side ("you" and "them"). Labels and the
 * neutral wording ("Different on pets — you're OK with pets, Meera loves dogs") are added by the
 * API from the copy (docs/06 §8.6); this module only decides which attributes and values.
 */
import type { Lifestyle, LifestyleAttribute } from '@flatrimony/shared';
import { compatibility, type AttributeMatch, type MatchProfile } from './score.js';

/** An attribute counts as an agreement from this similarity on. */
export const AGREEMENT_MIN_SIMILARITY = 0.75;
/** At most this many agreements are shown (spec §5.1 step 4). */
export const MAX_AGREEMENTS = 3;

/** The self-rated value of an attribute as the copy names it ("23:00", "daily", "yes"). */
export function lifestyleValue(lifestyle: Lifestyle, attribute: LifestyleAttribute): string | null {
  switch (attribute) {
    case 'bedtime':
      return lifestyle.bedtime;
    case 'wake_time':
      return lifestyle.wakeTime;
    case 'cleaning':
      return lifestyle.cleaning;
    case 'smoking':
      return lifestyle.smoking;
    case 'pets':
      return lifestyle.pets;
    case 'food':
      return lifestyle.food;
    case 'cooks_at_home':
      return lifestyle.cooksAtHome === undefined ? null : lifestyle.cooksAtHome ? 'yes' : 'no';
    case 'drinking':
      return lifestyle.drinking ?? null;
    case 'guests':
      return lifestyle.guests ?? null;
    case 'parties':
      return lifestyle.parties ?? null;
    case 'work_mode':
      return lifestyle.workMode ?? null;
  }
}

export interface RishtaFacts {
  score: number;
  /** Strongest first: weight × similarity, then the Flat Biodata order. */
  agreements: { attribute: LifestyleAttribute; similarity: number }[];
  /** The weakest attribute below the agreement line (the heavier one on a tie), if any. */
  biggestGap?: { attribute: LifestyleAttribute; similarity: number; you: string; them: string };
  perAttribute: Partial<Record<LifestyleAttribute, number>>;
}

const strength = (m: AttributeMatch) => m.weight * m.similarity;

export function rishtaFacts(viewer: MatchProfile, other: MatchProfile): RishtaFacts {
  const { score, attributes } = compatibility(viewer, other);
  const perAttribute: RishtaFacts['perAttribute'] = {};
  for (const m of attributes) perAttribute[m.attribute] = Math.round(m.similarity * 100) / 100;

  // Array.prototype.sort is stable: equal strengths keep the Flat Biodata order.
  const agreements = attributes
    .filter((m) => m.similarity >= AGREEMENT_MIN_SIMILARITY)
    .sort((x, y) => strength(y) - strength(x))
    .slice(0, MAX_AGREEMENTS)
    .map(({ attribute, similarity }) => ({ attribute, similarity }));

  const gap = attributes
    .filter((m) => m.similarity < AGREEMENT_MIN_SIMILARITY)
    .sort((x, y) => x.similarity - y.similarity || y.weight - x.weight)[0];

  return {
    score,
    agreements,
    ...(gap
      ? {
          biggestGap: {
            attribute: gap.attribute,
            similarity: gap.similarity,
            // Compared attributes have values on both sides.
            you: lifestyleValue(viewer.lifestyle, gap.attribute)!,
            them: lifestyleValue(other.lifestyle, gap.attribute)!,
          },
        }
      : {}),
    perAttribute,
  };
}
