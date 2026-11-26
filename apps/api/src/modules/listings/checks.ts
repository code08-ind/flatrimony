/**
 * Automatic listing checks (FR-LST-08; docs/05 §8.6; docs/04 §15.8). Run before a listing goes live
 * and when a live (or held) listing's text, rent, costs or photos change, inside the same database
 * transaction as the write (repository.ts). A finding never refuses the request: a listing with a
 * finding that holds waits in `pending_review` for a moderator (T6) instead of going live. Findings
 * name the kind and the field, never the matched text (a phone number is personal data).
 *
 * The thresholds and word lists here are technical starting points, not product claims; docs/07 T3.8
 * lists them for the founder's sign-off.
 */
export type FlagKind = 'broker_words' | 'contact_details' | 'duplicate_photo' | 'price_anomaly';

export interface Flag {
  kind: FlagKind;
  /** 1–100; a listing's risk score is the capped sum. */
  weight: number;
  /** False for a finding worth noting that does not keep the listing out of discovery. */
  holds: boolean;
  details: Record<string, string | number | boolean>;
}

/** What the checks look at (the listing as it is after the write). */
export interface CheckInput {
  title: string;
  description: string | null;
  rentPerPersonInr: number;
  /** One-time cost labels (40 characters each; room enough for a phone number). */
  costLabels: string[];
}

/** Facts the database supplies. */
export interface CheckFacts {
  /** Other owners' listings with an older photo matching one of this listing's. */
  photoMatchesOtherOwners: string[];
  /** Two photos of this listing that are the same picture. */
  photoRepeatedInListing: boolean;
  /** Rent per person of comparable live listings (same area and BHK), this one excluded. */
  comparableRents: number[];
}

// ------------------------------------------------------------------ text folding
// Cyrillic and Greek letters that look Latin; full-width letters are handled by NFKC.
const LOOKALIKE_LETTERS: Record<string, string> = {
  а: 'a',
  е: 'e',
  о: 'o',
  р: 'p',
  с: 'c',
  у: 'y',
  х: 'x',
  к: 'k',
  м: 'm',
  т: 't',
  н: 'h',
  в: 'b',
  і: 'i',
  ј: 'j',
  ѕ: 's',
  ԁ: 'd',
  ο: 'o',
  α: 'a',
  ε: 'e',
  ι: 'i',
  κ: 'k',
  ν: 'v',
  ρ: 'p',
  τ: 't',
};
const DIGIT_AS_LETTER: Record<string, string> = {
  '0': 'o',
  '1': 'i',
  '3': 'e',
  '4': 'a',
  '5': 's',
  '7': 't',
  '@': 'a',
  $: 's',
};

/** Lower case, look-alike letters mapped, digits inside words read as letters ("br0ker"); spaces kept. */
function foldWords(text: string): string {
  const s = [...text.normalize('NFKC').toLowerCase()]
    .map((c) => LOOKALIKE_LETTERS[c] ?? c)
    .join('');
  return s.replace(/(?<=\p{L})[013457@$](?=\p{L})/gu, (c) => DIGIT_AS_LETTER[c] ?? c);
}

// ------------------------------------------------------------------ broker words
/**
 * Words for a broker or a broker's fee, as whole words: "gentleman" and "Dalal Enclave" (a common
 * surname) are not findings, "brokerage", "agent fee" and "दलाली" are.
 */
const BROKER_WORD =
  /(?<![\p{L}\p{M}])(broker|brokers|brokerage|brokrage|dalali|dalaali|commission|commision|comission|ब्रोकर|ब्रोकरेज|दलाल|दलाली|कमीशन|कमिशन|डीलर)(?![\p{L}\p{M}])/u;
// "Agent" has many innocent senses (travel, insurance, LIC): only in a broker's phrase.
const BROKER_PHRASE =
  /(?<![\p{L}])((agent|agents|agency)\s+(fee|fees|charge|charges|commission)|(our|my|the|contact|call)\s+(agent|agency)|(property|real estate|estate)\s+(dealer|dealers|consultant|consultants|agent|agents|agency)|प्रॉपर्टी\s*डीलर)(?![\p{L}])/u;
// "No brokerage" is an honest thing to write: phrases that rule a broker out are not findings.
const NO_BROKER: RegExp[] = [
  // "no broker/agent", "strictly no brokers or agents please", "without any commission"
  /(?<![\p{L}])(no|zero|0|nil|without|without any|free of|strictly no|absolutely no|not a|not an|not any)[\s-]+(broker|brokers|brokerage|brokrage|agent|agents|agency|dalal|dalals|dalali|dalaali|commission|commision|comission)((\s*(\/|,|&|and|or|nor)\s*)(broker|brokers|brokerage|brokrage|agent|agents|agency|dalal|dalals|dalali|dalaali|commission|commision|comission))*(?![\p{L}])/gu,
  // "brokerage-free", "commission free"
  /(?<![\p{L}])(broker|brokers|brokerage|brokrage|commission|agent|agents)[\s-]*free(?![\p{L}])/gu,
  // "brokers please excuse", "agents excuse"
  /(?<![\p{L}])(broker|brokers|agent|agents|dalal|dalals)\s+(please\s+|pls\s+|kindly\s+)?(excuse|stay away|not allowed|don't call|do not call)(?![\p{L}])/gu,
  // "Brokerage: nil", "commission - none"
  /(?<![\p{L}])(broker|brokerage|brokrage|commission|dalali)\s*[:=-]?\s*(nil|none|zero|0|no|na|n\/a|not applicable)(?![\p{L}0-9])/gu,
  // Hindi: "ब्रोकर नहीं", "बिना दलाली"
  /(ब्रोकर|ब्रोकरेज|दलाल|दलाली|कमीशन|कमिशन)\s*(नहीं|नही|ना|मत)/gu,
  /(बिना|नो)\s*(ब्रोकर|ब्रोकरेज|दलाल|दलाली|कमीशन|कमिशन)/gu,
  // Innocent compound nouns with "agent" (not about the room)
  /(?<![\p{L}])(election|planning|finance|public service|human rights|national|state)\s+commission(?![\p{L}])/gu,
];

// "Dalal" alone is a common surname; a dalal's fee is not.
const DALAL_FEE = /(?<![\p{L}])dalal\s+(fee|fees|charge|charges|commission|money)(?![\p{L}])/u;

export function brokerWords(text: string): boolean {
  let rest = foldWords(text);
  for (const pattern of NO_BROKER) rest = rest.replace(pattern, ' ');
  return BROKER_WORD.test(rest) || BROKER_PHRASE.test(rest) || DALAL_FEE.test(rest);
}

// ------------------------------------------------------------------ phone numbers
/** Where '0' is in each script's decimal digits (Arabic, Persian, Devanagari, Bengali, …, full-width). */
const DIGIT_ZEROS = [
  0x0660, 0x06f0, 0x0966, 0x09e6, 0x0a66, 0x0ae6, 0x0b66, 0x0be6, 0x0c66, 0x0ce6, 0x0d66, 0x0de6,
  0x0e50, 0x0ed0, 0xff10,
];
const asciiDigit = (c: string) => {
  const cp = c.codePointAt(0)!;
  const zero = DIGIT_ZEROS.find((z) => cp >= z && cp <= z + 9);
  return zero === undefined ? c : String(cp - zero);
};
const NUMBER_WORDS: Record<string, string> = {
  shunya: '0',
  sunya: '0',
  ek: '1',
  do: '2',
  teen: '3',
  chaar: '4',
  paanch: '5',
  panch: '5',
  chhe: '6',
  chhah: '6',
  saat: '7',
  aath: '8',
  nau: '9',
  zero: '0',
  oh: '0',
  one: '1',
  two: '2',
  three: '3',
  four: '4',
  five: '5',
  six: '6',
  seven: '7',
  eight: '8',
  nine: '9',
  शून्य: '0',
  एक: '1',
  दो: '2',
  तीन: '3',
  चार: '4',
  पांच: '5',
  पाँच: '5',
  छह: '6',
  छः: '6',
  सात: '7',
  आठ: '8',
  नौ: '9',
};
const TENS: Record<string, string> = {
  twenty: '2',
  thirty: '3',
  forty: '4',
  fifty: '5',
  sixty: '6',
  seventy: '7',
  eighty: '8',
  ninety: '9',
};
// Literal patterns only (Semgrep detect-non-literal-regexp).
const TENS_AND_UNIT =
  /(?<![\p{L}\p{M}])(twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)[\s-]*(one|two|three|four|five|six|seven|eight|nine)?(?![\p{L}\p{M}])/giu;
const WORD =
  /(?<![\p{L}\p{M}])(zero|oh|one|two|three|four|five|six|seven|eight|nine|shunya|sunya|ek|do|teen|chaar|paanch|panch|chhe|chhah|saat|aath|nau|शून्य|एक|दो|तीन|चार|पांच|पाँच|छह|छः|सात|आठ|नौ)(?![\p{L}\p{M}])/giu;
// Letters typed for digits next to digits: "98765 4321O", "432 l0".
const LETTER_DIGIT =
  /(?<=[0-9][^\p{L}0-9]{0,2})[oil](?![\p{L}])|(?<![\p{L}])[oil](?=[^\p{L}0-9]{0,2}[0-9])/gu;
const LETTER_DIGITS: Record<string, string> = { o: '0', i: '1', l: '1' };
// Commas between spelled-out digits ("9, 8, 7"), not between amounts ("18000, 36000").
const COMMA_BETWEEN_SMALL = /(?<=(?:^|[^0-9])[0-9]{1,2})\s*,(?=\s*[0-9]{1,2}(?:[^0-9]|$))/g;
const MOBILE = /^(?:91|0)?[6-9][0-9]{9}$/;
const REPEATED = /(?<![\p{L}])(double|triple)\s*([0-9])/gu;
// A comma straight between digits ("98765,43210") joins them; "18000, 36000" (with a space) does not.
const COMMA_TIGHT = /(?<=[0-9]),(?=[0-9])/g;
// Arithmetic is not a phone number: "950 + 700 = 1650" ("+" only counts before 91).
const ARITHMETIC = /\+(?!\s*91)|=/g;
/** Between the digit groups of one number: anything but letters, digits and commas. */
const isSeparator = (c: string) => !/[\p{L}\p{M}0-9,]/u.test(c);

/**
 * An Indian mobile number in the text, however it is written: grouped with spaces, dashes, dots,
 * slashes or symbols, +91 or 0 first, Devanagari digits, letters typed for digits, or digits
 * spelled out in English (including "ninety eight") or Hindi. Digit groups are joined only across
 * separators with at most three visible characters, and any run of consecutive groups that forms a
 * mobile number counts, so "Rent 18000, deposit 36000" is not a number but "98765 43210" is.
 */
export function hasPhoneNumber(text: string): boolean {
  // Invisible format characters (zero-width spaces) are dropped; digits of every script read as 0-9.
  let s = text
    .normalize('NFKC')
    .toLowerCase()
    .replace(/\p{Cf}/gu, '');
  s = [...s].map(asciiDigit).join('');
  s = s.replace(
    TENS_AND_UNIT,
    (_m, tens: string, unit?: string) =>
      ` ${TENS[tens.toLowerCase()]}${unit ? NUMBER_WORDS[unit.toLowerCase()] : '0'} `,
  );
  s = s.replace(WORD, (w) => NUMBER_WORDS[w.toLowerCase()] ?? w);
  s = s.replace(REPEATED, (_m, times: string, d: string) =>
    times === 'double' ? d + d : d + d + d,
  );
  s = s.replace(LETTER_DIGIT, (c) => LETTER_DIGITS[c] ?? c);
  s = s
    .replace(COMMA_BETWEEN_SMALL, ' ')
    .replace(COMMA_TIGHT, ' ')
    .replace(ARITHMETIC, ' x '); /* a letter: ends the number */

  const segments: string[][] = [];
  let groups: string[] = [];
  let digits = '';
  let gap = 0; // visible separator characters since the last digit
  const close = () => {
    if (digits) groups.push(digits);
    digits = '';
  };
  for (const c of s) {
    if (c >= '0' && c <= '9') {
      if (!digits && groups.length && gap > 3) {
        segments.push(groups);
        groups = [];
      }
      digits += c;
      gap = 0;
    } else if (isSeparator(c)) {
      close();
      if (c.trim() !== '') gap += 1;
    } else {
      close();
      if (groups.length) segments.push(groups);
      groups = [];
      gap = 0;
    }
  }
  close();
  if (groups.length) segments.push(groups);

  return segments.some((g) => {
    for (let i = 0; i < g.length; i++) {
      let joined = '';
      for (let j = i; j < g.length && joined.length <= 12; j++) {
        joined += g[j];
        if (MOBILE.test(joined)) return true;
      }
    }
    return false;
  });
}

// ------------------------------------------------------------------ links and handles
/** Ways to reach the owner outside the app: links, e-mail, messaging apps, social handles. */
export function hasContactLink(text: string): boolean {
  const original = text.normalize('NFKC');
  const s = foldWords(original);
  return (
    // E-mail on the unfolded text (folding reads "@" between letters as "a").
    /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/.test(original.toLowerCase()) ||
    /(?<![\p{L}])(https?:\/\/|www\.)\S+/u.test(s) ||
    // "meera at gmail dot com", "meera (at) gmail"
    /(?<![\p{L}])(at|\(at\)|\[at\])\s*(gmail|yahoo|outlook|hotmail|rediffmail|icloud|proton)(?![\p{L}])/u.test(
      s,
    ) ||
    /(?<![\p{L}])dot\s*(com|in|co|net|org)(?![\p{L}])/u.test(s) ||
    // WhatsApp and its spellings, Telegram, Instagram, Signal; "wa.me", "t.me"
    /(?<![\p{L}])(wa\.me|t\.me|w+h?a+t+s+\s*a+p+|wtsp|telegram|instagram|insta|signal app)(?![\p{L}])(?!\s+group)/u.test(
      s,
    ) ||
    /(?<![\p{L}])(dm|message|msg|ping|text)\s+me(?![\p{L}])/u.test(s) ||
    // A bare domain, as written: "flatsforyou.in" (lower-case top-level domain, so the missing
    // space in "furnished.In sector 45" is not one).
    /(?<![\p{L}0-9@.])[a-z0-9-]{2,}\.(com|in|co\.in|net|org|me|link|io|app|site|xyz|ly|gl|info|biz|online|store|page)(?![\p{L}0-9])/u.test(
      original,
    )
  );
}

// ------------------------------------------------------------------ price
/** A rent this far from the usual for the area and BHK is looked at by a moderator. */
export const PRICE_LOW_RATIO = 0.4;
export const PRICE_HIGH_RATIO = 2.5;
/** Fewer comparable listings than this: no usual price to compare with. */
export const PRICE_MIN_COMPARABLES = 5;

export function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : Math.round((s[mid - 1]! + s[mid]!) / 2);
}

// ------------------------------------------------------------------ all checks
export function runChecks(input: CheckInput, facts: CheckFacts): Flag[] {
  const flags: Flag[] = [];
  const fields: Record<string, string> = {
    title: input.title,
    description: input.description ?? '',
    costs: input.costLabels.join(' · '),
  };
  const where = (test: (t: string) => boolean) =>
    Object.keys(fields).filter((f) => fields[f] && test(fields[f]!));

  const broker = where(brokerWords).filter((f) => f !== 'costs'); // labels: refused by the API
  if (broker.length)
    flags.push({
      kind: 'broker_words',
      weight: 40,
      holds: true,
      details: { fields: broker.join(',') },
    });

  const phone = where(hasPhoneNumber);
  const link = where(hasContactLink);
  if (phone.length || link.length)
    flags.push({
      kind: 'contact_details',
      weight: 40,
      holds: true,
      details: {
        ...(phone.length ? { phoneIn: phone.join(',') } : {}),
        ...(link.length ? { linkIn: link.join(',') } : {}),
      },
    });

  if (facts.photoMatchesOtherOwners.length)
    flags.push({
      kind: 'duplicate_photo',
      weight: 60,
      holds: true,
      details: {
        otherListings: facts.photoMatchesOtherOwners.slice(0, 5).join(','),
        count: facts.photoMatchesOtherOwners.length,
      },
    });
  else if (facts.photoRepeatedInListing)
    // Two shots of a plain wall can look alike: noted for the moderator, not held.
    flags.push({
      kind: 'duplicate_photo',
      weight: 10,
      holds: false,
      details: { sameListing: true },
    });

  if (facts.comparableRents.length >= PRICE_MIN_COMPARABLES) {
    const usual = median(facts.comparableRents);
    const ratio = input.rentPerPersonInr / usual;
    if (ratio < PRICE_LOW_RATIO || ratio > PRICE_HIGH_RATIO)
      flags.push({
        kind: 'price_anomaly',
        weight: 30,
        holds: true,
        details: {
          medianInr: usual,
          comparables: facts.comparableRents.length,
          direction: ratio < 1 ? 'low' : 'high',
        },
      });
  }
  return flags;
}

export const holds = (flags: Flag[]) => flags.some((f) => f.holds);
export const riskScore = (flags: Flag[]) =>
  Math.min(
    100,
    flags.reduce((n, f) => n + f.weight, 0),
  );
