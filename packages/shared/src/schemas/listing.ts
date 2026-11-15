/** Listing rules and true monthly cost (docs/05 §7, FR-LST-02..04). */
import { z } from 'zod';
import { FoodRule, GenderPreference, GuestsRule } from '../enums.js';
import { Inr } from '../primitives.js';

export const ListingRules = z.object({
  bachelorsAllowed: z.boolean(),
  foodRule: FoodRule,
  guestsRule: GuestsRule,
  petsAllowed: z.boolean(),
  smokingAllowed: z.boolean(),
  genderRule: GenderPreference,
});
export type ListingRules = z.infer<typeof ListingRules>;

const BROKERAGE = /brok(er|era)|dalal|दलाल/i;

export const OneTimeCost = z.object({
  label: z.string().trim().min(1).max(60),
  amountInr: Inr,
});

/** Brokerage must be 0 (FR-LST-03): no landlords or brokers on the platform. */
export const ListingCosts = z
  .object({
    maintenanceInr: Inr,
    electricityEstimateInr: Inr,
    wifiInr: Inr,
    helpInr: Inr,
    otherRecurringInr: Inr,
    oneTimeCosts: z.array(OneTimeCost).max(10),
  })
  .superRefine((costs, ctx) => {
    costs.oneTimeCosts.forEach((c, i) => {
      if (BROKERAGE.test(c.label) && c.amountInr !== 0) {
        ctx.addIssue({
          code: 'custom',
          path: ['oneTimeCosts', i, 'amountInr'],
          message: 'Brokerage is not allowed',
          params: { errorCode: 'listing.brokerage_not_allowed' },
        });
      }
    });
  });
export type ListingCosts = z.infer<typeof ListingCosts>;

/** Per-person monthly total shown on cards: rent + recurring costs (FR-LST-03). */
export function trueMonthlyPerPersonInr(
  rentPerPersonInr: number,
  costs: Pick<
    ListingCosts,
    'maintenanceInr' | 'electricityEstimateInr' | 'wifiInr' | 'helpInr' | 'otherRecurringInr'
  >,
  sharingPeople: number,
): number {
  if (!Number.isInteger(sharingPeople) || sharingPeople < 1) {
    throw new RangeError('sharingPeople must be a positive integer');
  }
  const shared =
    costs.maintenanceInr +
    costs.electricityEstimateInr +
    costs.wifiInr +
    costs.helpInr +
    costs.otherRecurringInr;
  return rentPerPersonInr + Math.ceil(shared / sharingPeople);
}
