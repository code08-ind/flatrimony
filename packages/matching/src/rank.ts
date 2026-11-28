/**
 * Deck ranking (spec §5.1 step 5; FR-DISC-07): the score, plus small boosts for verified members,
 * recently active members and new members who have not been shown much yet, so new people get
 * seen. A paid boost raises a card among cards with similar scores; it never bypasses a hard filter
 * (filters run before ranking, in the candidate query).
 *
 * The boost sizes are technical starting points for founder sign-off (docs/07 T4.1): small next to
 * the 0–100 score, so a much better match always ranks first.
 */
export const RANK_BOOST = {
  verified: 3,
  /** Active in the last ACTIVE_DAYS days. */
  recentlyActive: 2,
  /** Joined in the last NEW_DAYS days and shown fewer than UNDER_EXPOSED_IMPRESSIONS times. */
  underExposed: 3,
  /** A paid listing boost (FR-PAY): priority among similar scores. */
  boosted: 5,
} as const;

export const ACTIVE_DAYS = 7;
export const NEW_DAYS = 14;
export const UNDER_EXPOSED_IMPRESSIONS = 50;

const DAY_MS = 24 * 60 * 60 * 1000;

export interface RankInput {
  score: number;
  isVerified: boolean;
  lastActiveAt: Date;
  createdAt: Date;
  /** How often the card was shown in decks so far. */
  impressions: number;
  isBoosted?: boolean;
}

export function rankScore(c: RankInput, now: Date): number {
  const t = now.getTime();
  let rank = c.score;
  if (c.isVerified) rank += RANK_BOOST.verified;
  if (t - c.lastActiveAt.getTime() <= ACTIVE_DAYS * DAY_MS) rank += RANK_BOOST.recentlyActive;
  if (t - c.createdAt.getTime() <= NEW_DAYS * DAY_MS && c.impressions < UNDER_EXPOSED_IMPRESSIONS)
    rank += RANK_BOOST.underExposed;
  if (c.isBoosted) rank += RANK_BOOST.boosted;
  return rank;
}

/** Highest rank first; equal ranks keep their incoming order (the candidate query's order). */
export function rankCandidates<T extends RankInput>(candidates: readonly T[], now: Date): T[] {
  return candidates
    .map((c, i) => ({ c, i, rank: rankScore(c, now) }))
    .sort((x, y) => y.rank - x.rank || x.i - y.i)
    .map(({ c }) => c);
}
