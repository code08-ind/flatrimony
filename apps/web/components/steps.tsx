'use client';

import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';
import {
  anchorComplete,
  bootstrapBody,
  clampBudget,
  DEFAULT_MINUTES,
  genderPrefFor,
  habitsComplete,
  parseDob,
  preferencesBody,
  stepNumber,
  todayIst,
  type AnchorDraft,
  type DobProblem,
  type HabitAnswers,
  type Step,
} from '@flatrimony/client';
import {
  humanText,
  LIMITS,
  PublicConfig as ApiConfig,
  type Category,
  type Intent,
  type Lifestyle,
  type Me,
} from '@flatrimony/shared';
import { api } from '../lib/client/api';
import { useConfig, useT } from '../lib/client/app-context';
import { getDeviceId } from '../lib/client/auth';
import { useMe } from '../lib/client/me';
import {
  getDraft,
  resetDraft,
  saveMe,
  updateDraft,
  useDraft,
  useSaving,
  type SaveResult,
} from '../lib/client/onboarding';
import { AnchorPicker } from './AnchorPicker';
import { AreaPicker, BudgetPicker, HabitPicker, MoveInPicker, useAreas } from './pickers';
import { Button, Frame, Notice, RadioCards, StepHeader } from './ui';

/** Moves to another step once (a double click does not push two pages). */
function useGo() {
  const router = useRouter();
  const { locale } = useT();
  const going = useRef(false);
  return (step: Step | 'restart') => {
    if (going.current) return;
    going.current = true;
    router.push(`/${locale}/onboarding${step === 'restart' ? '' : `/${step}`}`);
  };
}

/** The step count line above the title ("Step 3 of 6 · Budget"). */
function useOverline(step: Step, section: string) {
  const { t } = useT();
  return `${t('onboarding.stepOf', { n: stepNumber(step) })} · ${section}`;
}

const NAME = humanText(LIMITS.displayNameMaxChars);
const DOB_MESSAGE = {
  incomplete: 'onboarding.about.dobIncomplete',
  invalid: 'onboarding.about.dobInvalid',
  underage: 'onboarding.about.dobUnderage',
  too_old: 'onboarding.about.dobTooOld',
} as const satisfies Record<DobProblem, string>;

/** "About you": first name and date of birth (18+ on today's date in India). */
export function AboutStep() {
  const { t, locale } = useT();
  const draft = useDraft();
  const { me, set } = useMe();
  const saving = useSaving();
  const go = useGo();
  const [name, setName] = useState(me?.displayName ?? draft.displayName ?? '');
  const [d0, m0, y0] = (draft.dateOfBirth ?? '').split('-').reverse();
  const [day, setDay] = useState(d0 ?? '');
  const [month, setMonth] = useState(m0 ?? '');
  const [year, setYear] = useState(y0 ?? '');
  const [touched, setTouched] = useState(false);

  const nameOk = NAME.safeParse(name).success;
  const dob = me ? null : parseDob(day, month, year, todayIst(Date.now()));
  const dobOk = me ? true : !!dob?.ok;
  const dobError = !me && touched && dob && !dob.ok ? t(DOB_MESSAGE[dob.problem]) : null;
  const digits = (v: string, n: number) => v.replace(/\D/g, '').slice(0, n);

  const next = () => {
    setTouched(true);
    if (!nameOk || !dobOk) return;
    const displayName = NAME.parse(name);
    if (me) {
      // Already has an account: only the name can change here.
      if (displayName === me.displayName) return go('intent');
      void saving.run(
        () => saveMe('/me', 'PATCH', { displayName }, locale),
        (updated, etag) => {
          set(updated, etag);
          go('intent');
        },
      );
      return;
    }
    if (dob?.ok) updateDraft({ displayName, dateOfBirth: dob.iso });
    go('intent');
  };

  return (
    <Frame>
      <form
        className="stack"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          next();
        }}
      >
        <StepHeader
          overline={t('onboarding.about.overline')}
          title={t('onboarding.about.title')}
          subtitle={t('onboarding.about.subtitle')}
        />
        <div className="card field">
          <label htmlFor="name">{t('onboarding.about.nameLabel')}</label>
          <input
            id="name"
            value={name}
            autoComplete="given-name"
            maxLength={80}
            placeholder={t('onboarding.about.namePlaceholder')}
            aria-invalid={(name.length > 0 && !nameOk) || undefined}
            onChange={(e) => setName(e.target.value)}
          />
          {(touched || name.length > 0) && !nameOk ? (
            <Notice tone="error">{t('onboarding.about.nameInvalid')}</Notice>
          ) : null}
        </div>
        {!me ? (
          <div className="card">
            <fieldset className="group">
              <legend>{t('onboarding.about.dobLabel')}</legend>
              <div className="dob">
                <label>
                  <span className="visually-hidden">{t('onboarding.about.dayLabel')}</span>
                  <input
                    inputMode="numeric"
                    autoComplete="bday-day"
                    placeholder={t('onboarding.about.day')}
                    value={day}
                    onChange={(e) => setDay(digits(e.target.value, 2))}
                  />
                </label>
                <label>
                  <span className="visually-hidden">{t('onboarding.about.monthLabel')}</span>
                  <input
                    inputMode="numeric"
                    autoComplete="bday-month"
                    placeholder={t('onboarding.about.month')}
                    value={month}
                    onChange={(e) => setMonth(digits(e.target.value, 2))}
                  />
                </label>
                <label>
                  <span className="visually-hidden">{t('onboarding.about.yearLabel')}</span>
                  <input
                    inputMode="numeric"
                    autoComplete="bday-year"
                    placeholder={t('onboarding.about.year')}
                    value={year}
                    onChange={(e) => setYear(digits(e.target.value, 4))}
                    onBlur={() => setTouched(true)}
                  />
                </label>
              </div>
              {dobError ? <Notice tone="error">{dobError}</Notice> : null}
            </fieldset>
          </div>
        ) : null}
        {saving.error ? <Notice tone="error">{t(saving.error)}</Notice> : null}
        <Button
          type="submit"
          busy={saving.busy}
          disabled={!nameOk || (touched && !dobOk)}
          testId="continue"
        >
          {t('onboarding.continue')}
        </Button>
      </form>
    </Frame>
  );
}

const INTENTS = [
  { value: 'have_room', title: 'onboarding.intent.haveRoom', sub: 'onboarding.intent.haveRoomSub' },
  { value: 'need_room', title: 'onboarding.intent.needRoom', sub: 'onboarding.intent.needRoomSub' },
  { value: 'pair_up', title: 'onboarding.intent.pairUp', sub: 'onboarding.intent.pairUpSub' },
] as const;

/** Step 1: what the user is looking for (design M04). */
export function IntentStep() {
  const { t, locale } = useT();
  const draft = useDraft();
  const { me } = useMe();
  const go = useGo();
  const [intent, setIntent] = useState<Intent | undefined>(draft.intent ?? me?.intent);
  return (
    <Frame
      actions={
        <>
          <p className="muted">{t('onboarding.intent.footer')}</p>
          <Button
            disabled={!intent}
            testId="continue"
            onClick={() => {
              updateDraft({ intent });
              go('category');
            }}
          >
            {t('onboarding.continue')}
          </Button>
        </>
      }
    >
      <StepHeader
        step={stepNumber('intent')}
        overline={useOverline('intent', t('onboarding.intent.overline'))}
        title={t('onboarding.intent.title')}
        subtitle={t('onboarding.intent.subtitle')}
        backHref={`/${locale}/onboarding/about`}
      />
      <RadioCards
        legend={t('onboarding.intent.title')}
        options={INTENTS.map((o) => ({ value: o.value, title: t(o.title), sub: t(o.sub) }))}
        value={intent}
        onChange={setIntent}
      />
    </Frame>
  );
}

const CATEGORIES = [
  {
    value: 'professional',
    title: 'onboarding.category.professional',
    sub: 'onboarding.category.professionalSub',
  },
  { value: 'student', title: 'onboarding.category.student', sub: 'onboarding.category.studentSub' },
  {
    value: 'women_only',
    title: 'onboarding.category.womenOnly',
    sub: 'onboarding.category.womenOnlySub',
  },
  {
    value: 'relocating',
    title: 'onboarding.category.relocating',
    sub: 'onboarding.category.relocatingSub',
  },
] as const;

/** Step 2: category, with women-only explained (design M05); creates the account. */
export function CategoryStep() {
  const { t, locale } = useT();
  const config = useConfig();
  const draft = useDraft();
  const { me, set } = useMe();
  const saving = useSaving();
  const go = useGo();
  const [category, setCategory] = useState<Category | undefined>(draft.category ?? me?.category);

  /** Creates the account (first time) or updates intent and category (when going back). */
  const saveIdentity = async (chosen: Category, existing: Me | null): Promise<SaveResult> => {
    const answers = { ...getDraft(), category: chosen };
    if (existing) {
      const patched = await saveMe(
        '/me',
        'PATCH',
        { intent: answers.intent, category: chosen },
        locale,
      );
      // Women-only members look for women flatmates: keep saved preferences in line.
      const prefs = patched.ok ? patched.me.preferences : undefined;
      if (prefs && prefs.flatmateGenderPref !== genderPrefFor(chosen)) {
        const updated = await saveMe(
          '/me/preferences',
          'PUT',
          { ...prefs, flatmateGenderPref: genderPrefFor(chosen) },
          locale,
        );
        // The category changed but the flatmate preference did not: say so (save again).
        return updated;
      }
      return patched;
    }
    // The current Terms/Privacy versions (accepted on the sign-in page).
    let legalVersions: { terms?: string; privacy?: string } = {};
    try {
      const res = await api('/config');
      if (res.status !== 200) return { ok: false, error: 'onboarding.errors.save' };
      const parsed = ApiConfig.safeParse(res.body);
      if (parsed.success) legalVersions = parsed.data.legalVersions;
    } catch {
      return { ok: false, error: 'onboarding.errors.save' };
    }
    const body = bootstrapBody(answers, {
      locale,
      legalVersions,
      device: { deviceId: getDeviceId(), platform: 'web', appVersion: config.appVersion },
    });
    if (!body)
      return {
        ok: false,
        error:
          legalVersions.terms && legalVersions.privacy
            ? 'onboarding.errors.generic'
            : 'onboarding.errors.notOpen',
      };
    return saveMe('/me/bootstrap', 'POST', body, locale);
  };

  const next = () => {
    if (!category) return;
    // Earlier answers lost (page reloaded before the account existed): start again.
    if (!me && (!getDraft().displayName || !getDraft().intent)) return go('restart');
    updateDraft({ category });
    void saving.run(
      () => saveIdentity(category, me),
      (saved, etag) => {
        set(saved, etag);
        go('budget');
      },
    );
  };

  return (
    <Frame
      actions={
        <Button disabled={!category} busy={saving.busy} onClick={next} testId="continue">
          {t('onboarding.continue')}
        </Button>
      }
    >
      <StepHeader
        step={stepNumber('category')}
        overline={useOverline('category', t('onboarding.category.overline'))}
        title={t('onboarding.category.title')}
        subtitle={t('onboarding.category.subtitle')}
        backHref={`/${locale}/onboarding/intent`}
      />
      <RadioCards
        legend={t('onboarding.category.title')}
        columns={2}
        options={CATEGORIES.map((o) => ({ value: o.value, title: t(o.title), sub: t(o.sub) }))}
        value={category}
        onChange={setCategory}
      />
      <div className="card note">
        <h2 className="h3">{t('onboarding.category.womenNoteTitle')}</h2>
        <p>{t('onboarding.category.womenNote')}</p>
      </div>
      {saving.error ? <Notice tone="error">{t(saving.error)}</Notice> : null}
    </Frame>
  );
}

/** Step 3: budget per person per month (design M06). */
export function BudgetStep() {
  const { t, locale } = useT();
  const draft = useDraft();
  const { me } = useMe();
  const go = useGo();
  const initial = clampBudget(
    draft.budgetMinInr ?? me?.preferences?.budgetMinInr ?? 10_000,
    draft.budgetMaxInr ?? me?.preferences?.budgetMaxInr ?? 20_000,
  );
  const [min, setMin] = useState(initial.min);
  const [max, setMax] = useState(initial.max);
  return (
    <Frame
      actions={
        <Button
          testId="continue"
          onClick={() => {
            updateDraft({ budgetMinInr: min, budgetMaxInr: max });
            go('commute');
          }}
        >
          {t('onboarding.continue')}
        </Button>
      }
    >
      <StepHeader
        step={stepNumber('budget')}
        overline={useOverline('budget', t('onboarding.budget.overline'))}
        title={t('onboarding.budget.title')}
        subtitle={t('onboarding.budget.subtitle')}
        backHref={`/${locale}/onboarding/category`}
      />
      <BudgetPicker
        min={min}
        max={max}
        onChange={(lo, hi) => {
          setMin(lo);
          setMax(hi);
        }}
      />
    </Frame>
  );
}

/** Step 4: office or college with the commute zone, or up to 3 areas (design M07). */
export function CommuteStep() {
  const { t, locale } = useT();
  const draft = useDraft();
  const { me, set } = useMe();
  const saving = useSaving();
  const go = useGo();
  const reference = useAreas();
  const areas = reference.areas;
  const savedAreas = draft.areaIds ?? me?.preferences?.areaIds ?? [];
  const [mode, setMode] = useState<'anchor' | 'areas'>(
    me?.anchor || savedAreas.length === 0 ? 'anchor' : 'areas',
  );
  const [selected, setSelected] = useState<number[]>(savedAreas);
  const [anchor, setAnchor] = useState<AnchorDraft>(
    me?.anchor
      ? { ...me.anchor }
      : {
          kind: me?.category === 'student' ? 'college' : 'office',
          travelMode: 'metro_transit',
          maxCommuteMin: DEFAULT_MINUTES,
        },
  );

  const next = () => {
    if (mode === 'areas') {
      updateDraft({ areaIds: selected });
      return go('move-in');
    }
    if (!anchorComplete(anchor)) return;
    void saving.run(
      () =>
        saveMe(
          '/me/anchor',
          'PUT',
          {
            kind: anchor.kind,
            label: anchor.label,
            location: anchor.location,
            travelMode: anchor.travelMode,
            maxCommuteMin: anchor.maxCommuteMin,
          },
          locale,
        ),
      (saved, etag) => {
        set(saved, etag);
        // With an office or college the areas are optional: none unless picked later.
        updateDraft({ areaIds: getDraft().areaIds ?? [] });
        go('move-in');
      },
    );
  };

  return (
    <Frame
      actions={
        <>
          {saving.error ? <Notice tone="error">{t(saving.error)}</Notice> : null}
          <Button
            testId="continue"
            busy={saving.busy}
            disabled={mode === 'areas' ? selected.length === 0 : !anchorComplete(anchor)}
            onClick={next}
          >
            {t('onboarding.continue')}
          </Button>
        </>
      }
    >
      <StepHeader
        step={stepNumber('commute')}
        overline={useOverline('commute', t('onboarding.commute.overline'))}
        title={mode === 'anchor' ? t('anchor.title') : t('onboarding.commute.title')}
        subtitle={mode === 'anchor' ? t('anchor.subtitle') : t('onboarding.commute.subtitle')}
        backHref={`/${locale}/onboarding/budget`}
      />
      {mode === 'anchor' ? (
        <AnchorPicker value={anchor} onChange={setAnchor} areas={areas ?? []} />
      ) : (
        <AreaPicker selected={selected} onChange={setSelected} reference={reference} />
      )}
      <Button variant="text" onClick={() => setMode(mode === 'anchor' ? 'areas' : 'anchor')}>
        {mode === 'anchor' ? t('anchor.pickAreas') : t('anchor.useAnchor')}
      </Button>
    </Frame>
  );
}

/** Step 5: move-in window and lease (design M08); saves the preferences. */
export function MoveInStep() {
  const { t, locale } = useT();
  const draft = useDraft();
  const { me, set } = useMe();
  const saving = useSaving();
  const go = useGo();
  const [range, setRange] = useState<{ from?: string; to?: string }>({
    from: draft.moveInFrom ?? me?.preferences?.moveInFrom,
    to: draft.moveInTo ?? me?.preferences?.moveInTo,
  });
  const [lease, setLease] = useState(
    draft.leaseMonths ?? me?.preferences?.leaseMonths ?? LIMITS.leaseMonths.default,
  );
  const complete = !!range.from && !!range.to;
  const save = () => {
    if (!complete) return;
    updateDraft({ moveInFrom: range.from, moveInTo: range.to, leaseMonths: lease });
    const body = preferencesBody(getDraft(), me?.category ?? 'professional', me?.preferences);
    if (!body || !me) return go('restart');
    void saving.run(
      () => saveMe('/me/preferences', 'PUT', body, locale),
      (saved, etag) => {
        set(saved, etag);
        go('habits');
      },
    );
  };
  return (
    <Frame
      actions={
        <>
          {saving.error ? <Notice tone="error">{t(saving.error)}</Notice> : null}
          <Button testId="continue" disabled={!complete} busy={saving.busy} onClick={save}>
            {t('onboarding.continue')}
          </Button>
        </>
      }
    >
      <StepHeader
        step={stepNumber('move-in')}
        overline={useOverline('move-in', t('onboarding.moveIn.overline'))}
        title={t('onboarding.moveIn.title')}
        subtitle={t('onboarding.moveIn.subtitle')}
        backHref={`/${locale}/onboarding/commute`}
      />
      <MoveInPicker range={range} onRange={setRange} lease={lease} onLease={setLease} />
    </Frame>
  );
}

/** Step 6: the six core habits (design M09); saving them finishes onboarding. */
export function HabitsStep() {
  const { t, locale } = useT();
  const { me, set } = useMe();
  const saving = useSaving();
  const go = useGo();
  const l = me?.lifestyle;
  const [h, setH] = useState<HabitAnswers>({
    bedtime: l?.bedtime,
    wakeTime: l?.wakeTime,
    cleaning: l?.cleaning,
    smoking: l?.smoking,
    pets: l?.pets,
    food: l?.food,
  });
  const finish = () => {
    if (!habitsComplete(h)) return;
    if (!me) return go('restart');
    // Keep optional answers already saved (the PUT replaces the whole lifestyle).
    const body: Lifestyle = { ...(me.lifestyle ?? {}), ...h };
    void saving.run(
      () => saveMe('/me/lifestyle', 'PUT', body, locale),
      (saved, etag) => {
        resetDraft();
        set(saved, etag); // complete: the gate opens the home page
      },
    );
  };
  return (
    <Frame
      actions={
        <>
          {!habitsComplete(h) ? (
            <p className="muted" aria-live="polite">
              {t('onboarding.habits.progress', { done: Object.values(h).filter(Boolean).length })}
            </p>
          ) : null}
          {saving.error ? <Notice tone="error">{t(saving.error)}</Notice> : null}
          <Button testId="finish" disabled={!habitsComplete(h)} busy={saving.busy} onClick={finish}>
            {t('onboarding.habits.finish')}
          </Button>
        </>
      }
    >
      <StepHeader
        step={stepNumber('habits')}
        overline={useOverline('habits', t('onboarding.habits.overline'))}
        title={t('onboarding.habits.title')}
        subtitle={t('onboarding.habits.subtitle')}
        backHref={`/${locale}/onboarding/move-in`}
      />
      <HabitPicker value={h} onChange={setH} />
    </Frame>
  );
}
