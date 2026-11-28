/**
 * The compatibility score (spec §5.1 steps 2–4; FR-DISC-03):
 *
 *   match = 100 × Σ wᵢ·sᵢ / Σ wᵢ   (rounded)
 *
 * sᵢ is the similarity of attribute i: the self-ratings' similarity, blended 50/50 with the
 * similarity of the two members' scenario answers when both answered scenarios for it. wᵢ comes
 * from both members' importance: matters = 2, don't care = 0.5, and the higher one wins when they
 * disagree. A missing importance is "matters" (FR-BIO-05); a deal-breaker weighs as "matters" and
 * also filters (dealbreakerConflicts).
 */
import type { Importance, ImportanceMap, Lifestyle, LifestyleAttribute } from '@flatrimony/shared';
import { attributeSimilarity } from './similarity.js';

/** Every attribute, in the order the Flat Biodata shows them (also the tie-break order). */
export const ATTRIBUTES: readonly LifestyleAttribute[] = [
  'bedtime',
  'wake_time',
  'cleaning',
  'smoking',
  'pets',
  'food',
  'cooks_at_home',
  'drinking',
  'guests',
  'parties',
  'work_mode',
];

/** Spec §5.1 step 3; a deal-breaker weighs as "matters" (it also filters). */
export const IMPORTANCE_WEIGHT: Record<Importance, number> = {
  dealbreaker: 2,
  matters: 2,
  dont_care: 0.5,
};

/** FR-DISC-03: self-ratings and scenario answers count half each when both exist. */
export const SCENARIO_SHARE = 0.5;

/**
 * Below this similarity, an attribute a member marked as a deal-breaker removes the pair (FR-DISC-02:
 * "any dealbreaker attribute conflict"). A technical starting point for founder sign-off.
 */
export const DEALBREAKER_MIN_SIMILARITY = 0.5;

/** One scenario answer: the attribute it speaks to and its option's value on that scale (0..1). */
export interface ScenarioValue {
  attribute: LifestyleAttribute;
  value: number;
}

export interface MatchProfile {
  lifestyle: Lifestyle;
  importance: ImportanceMap;
  scenarios?: readonly ScenarioValue[];
}

export interface AttributeMatch {
  attribute: LifestyleAttribute;
  /** 0..1 */
  similarity: number;
  weight: number;
}

export interface Compatibility {
  /** 0..100. The six required habits are always compared, so there is always a score. */
  score: number;
  /** The attributes that counted, in ATTRIBUTES order. */
  attributes: AttributeMatch[];
}

export const importanceOf = (p: MatchProfile, attribute: LifestyleAttribute): Importance =>
  p.importance[attribute] ?? 'matters';

/** Spec §5.1 step 3: each member's weight from their importance; the higher one wins. */
export function weightFor(a: MatchProfile, b: MatchProfile, attribute: LifestyleAttribute): number {
  return Math.max(
    IMPORTANCE_WEIGHT[importanceOf(a, attribute)],
    IMPORTANCE_WEIGHT[importanceOf(b, attribute)],
  );
}

/** A member's scenario value for an attribute (the mean when several questions speak to it). */
export function scenarioValue(p: MatchProfile, attribute: LifestyleAttribute): number | null {
  const values = (p.scenarios ?? []).filter((s) => s.attribute === attribute).map((s) => s.value);
  if (values.length === 0) return null;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

/** The blended similarity of one attribute, or null when it cannot be compared. */
export function blendedSimilarity(
  a: MatchProfile,
  b: MatchProfile,
  attribute: LifestyleAttribute,
): number | null {
  const self = attributeSimilarity(attribute, a.lifestyle, b.lifestyle);
  if (self === null) return null;
  const va = scenarioValue(a, attribute);
  const vb = scenarioValue(b, attribute);
  if (va === null || vb === null) return self;
  const scenario = 1 - Math.abs(va - vb);
  return (1 - SCENARIO_SHARE) * self + SCENARIO_SHARE * scenario;
}

/** The score of a pair; symmetric (compatibility(a, b) equals compatibility(b, a)). */
export function compatibility(a: MatchProfile, b: MatchProfile): Compatibility {
  const attributes: AttributeMatch[] = [];
  for (const attribute of ATTRIBUTES) {
    const similarity = blendedSimilarity(a, b, attribute);
    if (similarity === null) continue;
    attributes.push({ attribute, similarity, weight: weightFor(a, b, attribute) });
  }
  const total = attributes.reduce((sum, m) => sum + m.weight, 0);
  const weighted = attributes.reduce((sum, m) => sum + m.weight * m.similarity, 0);
  return { score: Math.round((100 * weighted) / total), attributes };
}

/**
 * The attributes on which a deal-breaker of either member is not met (FR-DISC-02). Any entry removes
 * the pair before scoring.
 */
export function dealbreakerConflicts(a: MatchProfile, b: MatchProfile): LifestyleAttribute[] {
  return ATTRIBUTES.filter((attribute) => {
    if (
      importanceOf(a, attribute) !== 'dealbreaker' &&
      importanceOf(b, attribute) !== 'dealbreaker'
    )
      return false;
    const similarity = blendedSimilarity(a, b, attribute);
    return similarity !== null && similarity < DEALBREAKER_MIN_SIMILARITY;
  });
}
