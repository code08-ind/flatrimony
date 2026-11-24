'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  BEDTIMES,
  BUDGET_BRACKETS,
  BUDGET_STEP,
  clampBudget,
  formatInr,
  monthGrid,
  presetWindow,
  tapDay,
  todayIst,
  WAKE_TIMES,
  type HabitAnswers,
  type MoveInPreset,
} from '@flatrimony/client';
import { LIMITS, ReferenceData } from '@flatrimony/shared';
import { api } from '../lib/client/api';
import { useT } from '../lib/client/app-context';
import { Button, Notice, RadioChips, Stepper } from './ui';

/** Budget per person per month (FR-BIO-02; design M06): range, −/+ steppers, quick brackets. */
export function BudgetPicker({
  min,
  max,
  onChange,
}: {
  min: number;
  max: number;
  onChange: (min: number, max: number) => void;
}) {
  const { t } = useT();
  const set = (lo: number, hi: number) => {
    const c = clampBudget(lo, hi);
    onChange(c.min, c.max);
  };
  const bracket = BUDGET_BRACKETS.find((b) => b.min === min && b.max === max)?.id;
  return (
    <>
      <div className="hero-card">
        <p className="hero-label">{t('onboarding.budget.cardLabel')}</p>
        <p className="hero-value" aria-live="polite">
          {formatInr(min)} – {formatInr(max)}
        </p>
      </div>
      <div className="card">
        <Stepper
          label={t('onboarding.budget.min')}
          value={formatInr(min)}
          onMinus={() => set(min - BUDGET_STEP, max)}
          onPlus={() => set(min + BUDGET_STEP, Math.max(max, min + BUDGET_STEP))}
          minusLabel={t('onboarding.budget.decreaseMin')}
          plusLabel={t('onboarding.budget.increaseMin')}
          canMinus={min > LIMITS.budgetInr.min}
          canPlus={min < LIMITS.budgetInr.max}
        />
        <Stepper
          label={t('onboarding.budget.max')}
          value={formatInr(max)}
          onMinus={() => set(Math.min(min, max - BUDGET_STEP), max - BUDGET_STEP)}
          onPlus={() => set(min, max + BUDGET_STEP)}
          minusLabel={t('onboarding.budget.decreaseMax')}
          plusLabel={t('onboarding.budget.increaseMax')}
          canMinus={max > LIMITS.budgetInr.min}
          canPlus={max < LIMITS.budgetInr.max}
        />
      </div>
      <RadioChips
        legend={t('onboarding.budget.quick')}
        options={BUDGET_BRACKETS.map((b) => ({
          value: b.id,
          label: t(`onboarding.budget.${b.id}`),
        }))}
        value={bracket}
        onChange={(id) => {
          const b = BUDGET_BRACKETS.find((x) => x.id === id);
          if (b) set(b.min, b.max);
        }}
      />
      <div className="card note">
        <h2 className="h3">{t('onboarding.budget.noteTitle')}</h2>
        <p className="muted">{t('onboarding.budget.note')}</p>
      </div>
    </>
  );
}

type Area = ReferenceData['areas'][number];
const CITY_ORDER = [
  'delhi',
  'gurugram',
  'noida',
  'greater_noida',
  'ghaziabad',
  'faridabad',
] as const;

/** The seeded NCR areas (GET /v1/reference), loaded once per language. */
export function useAreas() {
  const { locale } = useT();
  const [areas, setAreas] = useState<Area[] | null>(null);
  const [failed, setFailed] = useState(false);
  const load = useCallback(async () => {
    setFailed(false);
    try {
      const res = await api('/reference', { locale });
      const parsed = ReferenceData.safeParse(res.body);
      if (!parsed.success) throw new Error('bad reference data');
      setAreas(parsed.data.areas);
    } catch {
      setFailed(true);
    }
  }, [locale]);
  useEffect(() => {
    void load();
  }, [load]);
  return { areas, failed, reload: load };
}

/** Up to 3 preferred areas, grouped by city (FR-BIO-02; design M07 "pick areas"). */
export function AreaPicker({
  selected,
  onChange,
  reference,
}: {
  selected: number[];
  onChange: (ids: number[]) => void;
  /** The areas the page already loaded (useAreas), so they are fetched once. */
  reference: ReturnType<typeof useAreas>;
}) {
  const { t } = useT();
  const { areas, failed, reload } = reference;
  const [limitHit, setLimitHit] = useState(false);
  const toggle = (id: number, on: boolean) => {
    if (!on) {
      setLimitHit(false);
      return onChange(selected.filter((a) => a !== id));
    }
    if (selected.length >= LIMITS.preferredAreasMax) return setLimitHit(true);
    setLimitHit(false);
    onChange([...selected, id]);
  };
  if (failed)
    return (
      <div className="stack">
        <Notice tone="error">{t('onboarding.commute.loadFailed')}</Notice>
        <Button variant="secondary" onClick={() => void reload()}>
          {t('onboarding.commute.retry')}
        </Button>
      </div>
    );
  if (!areas)
    return (
      <p className="muted" role="status">
        {t('onboarding.commute.loading')}
      </p>
    );
  return (
    <>
      {CITY_ORDER.map((city) => {
        const inCity = areas.filter((a) => a.city === city);
        if (inCity.length === 0) return null;
        return (
          <fieldset key={city} className="group">
            <legend>{t(`onboarding.commute.cities.${city}`)}</legend>
            <div className="chips">
              {inCity.map((a) => (
                <label key={a.id} className="chip">
                  <input
                    type="checkbox"
                    checked={selected.includes(a.id)}
                    onChange={(e) => toggle(a.id, e.target.checked)}
                  />
                  <span>{a.name}</span>
                </label>
              ))}
            </div>
          </fieldset>
        );
      })}
      {limitHit ? <Notice tone="info">{t('onboarding.commute.maxReached')}</Notice> : null}
    </>
  );
}

const PRESETS: MoveInPreset[] = ['asap', 'this_month', 'next_month', 'flexible'];
export type MoveInRange = { from?: string; to?: string };

/** Move-in window (presets + calendar) and lease length (FR-BIO-02; design M08). */
export function MoveInPicker({
  range,
  onRange,
  lease,
  onLease,
}: {
  range: MoveInRange;
  onRange: (range: MoveInRange) => void;
  lease: number;
  onLease: (months: number) => void;
}) {
  const { t, locale } = useT();
  const today = todayIst(Date.now());
  const start = range.from ?? today;
  const [cursor, setCursor] = useState({
    year: Number(start.slice(0, 4)),
    month0: Number(start.slice(5, 7)) - 1,
  });
  const weeks = useMemo(() => monthGrid(cursor.year, cursor.month0), [cursor]);
  const fmt = useMemo(() => {
    const tag = locale === 'hi' ? 'hi-IN' : 'en-IN';
    return {
      month: new Intl.DateTimeFormat(tag, { month: 'long', year: 'numeric', timeZone: 'UTC' }),
      day: new Intl.DateTimeFormat(tag, {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        timeZone: 'UTC',
      }),
    };
  }, [locale]);
  const asDate = (iso: string) => new Date(`${iso}T00:00:00Z`);
  const atCurrentMonth =
    cursor.year * 12 + cursor.month0 <=
    Number(today.slice(0, 4)) * 12 + Number(today.slice(5, 7)) - 1;
  const preset = PRESETS.find((p) => {
    const w = presetWindow(p, today);
    return w.from === range.from && w.to === range.to;
  });
  const shift = (delta: number) =>
    setCursor(({ year, month0 }) => {
      const m = month0 + delta;
      return { year: year + Math.floor(m / 12), month0: ((m % 12) + 12) % 12 };
    });
  const weekdays = t('onboarding.moveIn.weekdays').split(',');

  return (
    <>
      <RadioChips
        hideLegend
        legend={t('onboarding.moveIn.title')}
        options={PRESETS.map((p) => ({ value: p, label: t(`onboarding.moveIn.${p}`) }))}
        value={preset}
        onChange={(p) => {
          const w = presetWindow(p, today);
          onRange(w);
          setCursor({ year: Number(w.from.slice(0, 4)), month0: Number(w.from.slice(5, 7)) - 1 });
        }}
      />
      <div className="card">
        <div className="month-row">
          <h2 className="h3" id="month-label">
            {fmt.month.format(new Date(Date.UTC(cursor.year, cursor.month0, 1)))}
          </h2>
          <div className="month-nav">
            <button
              type="button"
              className="icon-btn"
              aria-label={t('onboarding.moveIn.previousMonth')}
              disabled={atCurrentMonth}
              onClick={() => shift(-1)}
            >
              <span aria-hidden="true">‹</span>
            </button>
            <button
              type="button"
              className="icon-btn"
              aria-label={t('onboarding.moveIn.followingMonth')}
              onClick={() => shift(1)}
            >
              <span aria-hidden="true">›</span>
            </button>
          </div>
        </div>
        <table className="calendar" aria-labelledby="month-label">
          <thead>
            <tr>
              {weekdays.map((d, i) => (
                <th key={i} scope="col" aria-hidden="true">
                  {d}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {weeks.map((week, wi) => (
              <tr key={wi}>
                {week.map((day, di) => {
                  if (!day) return <td key={di} />;
                  const past = day < today;
                  const edge = day === range.from || day === range.to;
                  const inside = !!range.from && !!range.to && day > range.from && day < range.to;
                  return (
                    <td key={di}>
                      <button
                        type="button"
                        className={`day${edge ? ' day-edge' : inside ? ' day-inside' : ''}`}
                        aria-label={fmt.day.format(asDate(day))}
                        aria-pressed={edge || inside}
                        disabled={past}
                        onClick={() => onRange(tapDay(range, day))}
                      >
                        {Number(day.slice(8))}
                      </button>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
        <p className="muted" aria-live="polite">
          {range.from && range.to
            ? `${t('onboarding.moveIn.window')}: ${t('onboarding.moveIn.windowValue', {
                from: fmt.day.format(asDate(range.from)),
                to: fmt.day.format(asDate(range.to)),
              })}`
            : range.from
              ? t('onboarding.moveIn.pickEnd')
              : t('onboarding.moveIn.pickStart')}
        </p>
      </div>
      <div className="card">
        <Stepper
          label={t('onboarding.moveIn.lease')}
          value={String(lease)}
          onMinus={() => onLease(Math.max(LIMITS.leaseMonths.min, lease - 1))}
          onPlus={() => onLease(Math.min(LIMITS.leaseMonths.max, lease + 1))}
          minusLabel={t('onboarding.moveIn.fewerMonths')}
          plusLabel={t('onboarding.moveIn.moreMonths')}
          canMinus={lease > LIMITS.leaseMonths.min}
          canPlus={lease < LIMITS.leaseMonths.max}
        />
        <p className="muted">{t('onboarding.moveIn.leaseHint')}</p>
      </div>
    </>
  );
}

const CLEANING = ['daily', 'few_times_week', 'weekly', 'rarely'] as const;
const SMOKING = ['no', 'outside_only', 'yes'] as const;
const PETS = [
  { value: 'have', label: 'have' },
  { value: 'love', label: 'love' },
  { value: 'ok', label: 'ok' },
  { value: 'no', label: 'no_pets' },
] as const;
const FOOD = ['veg', 'eggetarian', 'non_veg', 'vegan'] as const;

/** The six core habits (FR-BIO-04; design M09 plus wake time). */
export function HabitPicker({
  value,
  onChange,
}: {
  value: HabitAnswers;
  onChange: (value: HabitAnswers) => void;
}) {
  const { t } = useT();
  const pick = <K extends keyof HabitAnswers>(key: K, v: HabitAnswers[K]) =>
    onChange({ ...value, [key]: v });
  return (
    <>
      <RadioChips
        legend={t('onboarding.habits.bedtime')}
        options={BEDTIMES.map((o) => ({ value: o.time, label: t(`onboarding.habits.${o.id}`) }))}
        value={value.bedtime}
        onChange={(v) => pick('bedtime', v)}
      />
      <RadioChips
        legend={t('onboarding.habits.wakeTime')}
        options={WAKE_TIMES.map((o) => ({ value: o.time, label: t(`onboarding.habits.${o.id}`) }))}
        value={value.wakeTime}
        onChange={(v) => pick('wakeTime', v)}
      />
      <RadioChips
        legend={t('onboarding.habits.cleaning')}
        options={CLEANING.map((v) => ({ value: v, label: t(`onboarding.habits.${v}`) }))}
        value={value.cleaning}
        onChange={(v) => pick('cleaning', v)}
      />
      <RadioChips
        legend={t('onboarding.habits.smoking')}
        options={SMOKING.map((v) => ({ value: v, label: t(`onboarding.habits.${v}`) }))}
        value={value.smoking}
        onChange={(v) => pick('smoking', v)}
      />
      <RadioChips
        legend={t('onboarding.habits.pets')}
        options={PETS.map((o) => ({ value: o.value, label: t(`onboarding.habits.${o.label}`) }))}
        value={value.pets}
        onChange={(v) => pick('pets', v)}
      />
      <RadioChips
        legend={t('onboarding.habits.food')}
        options={FOOD.map((v) => ({ value: v, label: t(`onboarding.habits.${v}`) }))}
        value={value.food}
        onChange={(v) => pick('food', v)}
      />
    </>
  );
}
