import { parse, TYPE, type MessageFormatElement } from '@formatjs/icu-messageformat-parser';
import { describe, expect, it } from 'vitest';
import {
  formatDate,
  formatINR,
  formatPaise,
  formatTime,
  formatTimeOfDay,
  getMessage,
  isLocale,
  messages,
  t,
  type MessageKey,
} from './index.js';

function leaves(obj: unknown, prefix = ''): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    if (typeof v === 'string') out[`${prefix}${k}`] = v;
    else Object.assign(out, leaves(v, `${prefix}${k}.`));
  }
  return out;
}

function placeholders(elements: MessageFormatElement[], acc = new Set<string>()): Set<string> {
  for (const el of elements) {
    if (el.type === TYPE.argument || el.type === TYPE.number || el.type === TYPE.date || el.type === TYPE.time) acc.add(el.value);
    if (el.type === TYPE.plural || el.type === TYPE.select) {
      acc.add(el.value);
      for (const opt of Object.values(el.options)) placeholders(opt.value, acc);
    }
  }
  return acc;
}

const en = leaves(messages.en);
const hi = leaves(messages.hi);

describe('message files', () => {
  it('en and hi have identical keys', () => {
    expect(Object.keys(hi).sort()).toEqual(Object.keys(en).sort());
  });

  it.each(Object.keys(en))('%s parses as ICU with the same placeholders in both languages', (key) => {
    const pe = [...placeholders(parse(en[key]!))].sort();
    const ph = [...placeholders(parse(hi[key]!))].sort();
    expect(ph).toEqual(pe);
  });

  it('no message is empty', () => {
    for (const v of [...Object.values(en), ...Object.values(hi)]) expect(v.trim()).not.toBe('');
  });

  it('uses the glossary terms from docs/06 §11.1', () => {
    expect(t('en', 'glossary.itsARishta')).toBe("It's a Rishta!");
    expect(t('hi', 'glossary.itsARishta')).toBe('रिश्ता मिल गया!');
    expect(t('hi', 'glossary.pehliMulaqat')).toBe('पहली मुलाक़ात');
    expect(t('en', 'app.notDating')).toBe('Flatmates, not dating.');
  });

  it('only shows 112 as the emergency number', () => {
    for (const v of [...Object.values(en), ...Object.values(hi)]) {
      const numbers = v.match(/\b1\d{2,3}\b/g) ?? [];
      for (const n of numbers) expect(n).toBe('112');
    }
  });

  it('formats ICU plurals and placeholders', () => {
    expect(t('en', 'glossary.commuteMinutes', { minutes: 28 })).toBe('28 min to your office');
    expect(t('hi', 'glossary.commuteMinutes', { minutes: 28 })).toBe('आपके ऑफ़िस तक 28 मिनट');
    expect(t('en', 'money.perMonthShort', { amount: formatINR(21500) })).toBe('₹21,500/mo');
  });

  it('throws on a missing key and validates locales', () => {
    expect(() => getMessage('en', 'nope.key' as MessageKey)).toThrow(/Missing message/);
    expect(isLocale('hi')).toBe(true);
    expect(isLocale('fr')).toBe(false);
  });
});

describe('formatters', () => {
  it('uses Indian digit grouping with whole rupees', () => {
    expect(formatINR(21500)).toBe('₹21,500');
    expect(formatINR(150000)).toBe('₹1,50,000');
    expect(formatINR(0)).toBe('₹0');
    expect(formatINR(150000, 'hi')).toBe('₹1,50,000');
    expect(() => formatINR(Number.NaN)).toThrow(RangeError);
  });

  it('formats paise', () => {
    expect(formatPaise(49900)).toBe('₹499');
    expect(formatPaise(49950)).toBe('₹499.50');
    expect(() => formatPaise(1.5)).toThrow(RangeError);
  });

  it('formats dates in IST: same year without year, other years with year', () => {
    const now = new Date('2026-11-15T06:00:00Z');
    expect(formatDate('2026-11-12T08:30:00Z', 'en', now)).toBe('12 Nov');
    expect(formatDate('2025-11-12T08:30:00Z', 'en', now)).toBe('12 Nov 2025');
    // 31 Dec 2026 20:00 UTC is already 1 Jan 2027 in IST.
    expect(formatDate('2026-12-31T20:00:00Z', 'en', now)).toBe('1 Jan 2027');
    expect(formatDate('2026-11-12T08:30:00Z', 'hi', now)).toMatch(/^12 /);
    expect(() => formatDate('not a date')).toThrow(RangeError);
  });

  it('formats times as 12-hour IST with AM/PM', () => {
    expect(formatTime('2026-11-12T17:30:00Z')).toBe('11:00 PM');
    expect(formatTime(new Date('2026-11-12T02:30:00Z'))).toBe('8:00 AM');
    expect(formatTime('2026-11-12T17:30:00Z', 'hi')).toMatch(/^11:00/);
    expect(() => formatTime('x')).toThrow(RangeError);
  });

  it('formats stored HH:mm times of day', () => {
    expect(formatTimeOfDay('23:00')).toBe('11:00 PM');
    expect(formatTimeOfDay('07:05')).toBe('7:05 AM');
    expect(formatTimeOfDay('00:30', 'hi')).toMatch(/^12:30/);
    expect(() => formatTimeOfDay('24:00')).toThrow(RangeError);
  });
});
