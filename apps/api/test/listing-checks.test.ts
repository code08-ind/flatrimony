import { describe, expect, it } from 'vitest';
import {
  brokerWords,
  hasContactLink,
  hasPhoneNumber,
  median,
  riskScore,
  runChecks,
} from '../src/modules/listings/checks.js';

describe('phone numbers in listing text (FR-LST-08)', () => {
  it.each([
    'Call 9876543210 for details',
    'call 98765 43210',
    'ph: +91 98765-43210',
    'reach me at 098765.43210',
    '(987) 654-3210 evenings',
    'nine eight seven six five four three two one zero',
    'Nine 8 seven 6 five 4 three 2 one 0',
    'नौ आठ सात छह पांच चार तीन दो एक शून्य',
    'संपर्क ९८७६५४३२१०',
    'Rent 18000. Call 9876543210.',
    'flat 12, 9876543210',
    // Evasions from the T3.8 review
    '98765_43210',
    '98765/43210',
    '98765•43210',
    '98765–43210',
    '98765     43210',
    'call 98765 4321O',
    '9876 5432 l0',
    'ninety eight seventy six five four three two one zero',
    'nine, eight, seven, six, five, four, three, two, one, zero',
    // Evasions from T3.8 QA
    '98765,43210',
    '98765 / 43210',
    'nine eight seven six five, four three two one zero',
    'nau aath saat chhe paanch chaar teen do ek shunya',
    '৯৮৭৬৫৪৩২১০',
    '٩٨٧٦٥٤٣٢١٠',
    '98765' + String.fromCodePoint(0x200b) + '43210',
    'double nine eight seven six five four three two one',
  ])('finds %s', (text) => expect(hasPhoneNumber(text)).toBe(true));

  it.each([
    'Rent 18000 / 36000 deposit, 11 months',
    'Rent 18000 36000',
    'Available from 2026-12-01, 3 BHK, 2 flatmates',
    'Sector 62, Noida 201301',
    'Tower 9, floor 8, flat 1203',
    'Only 1 room left, one of two balconies',
    'Two working professionals, one dog',
    'Price 25,000 per month plus 1,200 maintenance',
    'Rent 18000, deposit 36000',
    'Flats 9 and 8, block 7',
    'Lift, 2 balconies, 1 parking',
    'Monthly bills 950 + 700 + 1500 = 3150',
  ])('does not flag %s', (text) => expect(hasPhoneNumber(text)).toBe(false));
});

describe('contact links and broker words', () => {
  it('finds e-mail, links and messaging apps', () => {
    for (const t of [
      'mail me at meera@example.com',
      'see www.example.in',
      'https://example.com/flat',
      'WhatsApp me',
      'wa.me/919876543210',
      'insta id meera.flats',
      'details on flatsforyou.in',
      'meera at gmail dot com',
      'whatsaap me',
      'watsapp only',
      'insta: meera_flats',
      'DM me for photos',
      'bit.ly/meera-flat',
      'іnstagram meera',
    ])
      expect(hasContactLink(t), t).toBe(true);
    for (const t of [
      'A quiet flat near the metro',
      'Sector 62 vs. Sector 18',
      'No pets.',
      'Fully furnished.In sector 45 near the metro',
      'Gym.In the society',
      'Near metro.Co-living style',
      'Meet at 7 pm',
      'B.Com students welcome',
      'We have a WhatsApp group for flatmates',
    ])
      expect(hasContactLink(t), t).toBe(false);
  });

  it('flags broker talk but not "no brokerage"', () => {
    for (const t of [
      'Brokerage one month rent',
      'Contact our agent',
      'Dalal fee extra',
      'commission 50%',
      'Property dealer, all sectors',
      'प्रॉपर्टी डीलर',
      'Agent fee one month',
    ])
      expect(brokerWords(t), t).toBe(true);
    for (const t of [
      'No brokerage!',
      'Zero brokerage, direct from flatmates',
      'brokerage-free',
      'Without broker',
      'I am not a broker',
      'Quiet flat',
      // False positives from the T3.8 review
      'Looking for a gentleman flatmate',
      'a gentle, quiet person',
      'Near Dalal Enclave',
      'No brokers, no agents please',
      'No broker/agent',
      'Strictly no dalali',
      'ब्रोकर नहीं',
      'Brokers please excuse',
      'My sister is a travel agent',
      // From T3.8 QA
      'किराया 9000, कोई ब्रोकरेज नहीं।',
      'बिना ब्रोकर, सीधे मालिक से',
      'कोई दलाल नहीं',
      'No agents please',
      'No brokers/agents',
      'Zero-brokerage flat',
      'Room for 4 gents',
      'Near a travel agency',
      'Near the Election Commission office',
      '0 brokerage',
      'Brokerage: nil',
      'Mrs. Dalal lives next door',
      'LIC agent',
      'Built and commissioned in 2021',
      'with a gentle breeze',
    ])
      expect(brokerWords(t), t).toBe(false);
  });
});

describe('running the checks', () => {
  const clean = {
    title: 'Sunny room near Cyber Hub',
    description: 'Quiet flat.',
    rentPerPersonInr: 18000,
    costLabels: [] as string[],
  };
  const noFacts = {
    photoMatchesOtherOwners: [],
    photoRepeatedInListing: false,
    comparableRents: [],
  };

  it('a clean listing has no findings', () => {
    expect(runChecks(clean, noFacts)).toEqual([]);
  });

  it('findings name the kind and the field, never the matched text', () => {
    const flags = runChecks(
      { ...clean, description: 'Call 9876543210, brokerage extra' },
      { ...noFacts, photoMatchesOtherOwners: ['l2', 'l3'] },
    );
    expect(flags.map((f) => f.kind).sort()).toEqual([
      'broker_words',
      'contact_details',
      'duplicate_photo',
    ]);
    expect(JSON.stringify(flags)).not.toContain('9876543210');
    expect(flags.find((f) => f.kind === 'contact_details')!.details).toEqual({
      phoneIn: 'description',
    });
    expect(riskScore(flags)).toBe(100);
  });

  it('price: only with enough comparable listings, and only far from the usual', () => {
    const rents = [15000, 16000, 18000, 19000, 20000];
    expect(median(rents)).toBe(18000);
    expect(
      runChecks({ ...clean, rentPerPersonInr: 5000 }, { ...noFacts, comparableRents: rents })[0],
    ).toMatchObject({ kind: 'price_anomaly', details: { direction: 'low', medianInr: 18000 } });
    expect(
      runChecks({ ...clean, rentPerPersonInr: 50000 }, { ...noFacts, comparableRents: rents })[0],
    ).toMatchObject({ kind: 'price_anomaly', details: { direction: 'high' } });
    expect(
      runChecks({ ...clean, rentPerPersonInr: 30000 }, { ...noFacts, comparableRents: rents }),
    ).toEqual([]);
    expect(
      runChecks(
        { ...clean, rentPerPersonInr: 1000 },
        { ...noFacts, comparableRents: rents.slice(0, 4) },
      ),
    ).toEqual([]);
  });

  it('a phone number in a cost label is a finding too', () => {
    expect(
      runChecks({ ...clean, costLabels: ['Setup', 'Call 98765 43210'] }, noFacts)[0],
    ).toMatchObject({ kind: 'contact_details', details: { phoneIn: 'costs' } });
  });

  it('the same photo twice in one listing is a small finding', () => {
    expect(runChecks(clean, { ...noFacts, photoRepeatedInListing: true })).toEqual([
      { kind: 'duplicate_photo', weight: 10, holds: false, details: { sameListing: true } },
    ]);
  });
});
