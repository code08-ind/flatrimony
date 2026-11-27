'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import {
  basicsFrom,
  basicsPatch,
  basicsProblem,
  costsFrom,
  createRequest,
  DEFAULT_RULES,
  inr,
  LISTING_STEPS,
  liveTrueMonthly,
  moneyFrom,
  moneyProblem,
  nextPhotoPosition,
  stepIndex,
  stepsDone,
  todayIst,
  walkthroughAppLink,
  type BasicsDraft,
  type ListingStep,
  type MoneyDraft,
} from '@flatrimony/client';
import { formatINR, type MessageKey } from '@flatrimony/i18n';
import { LISTING_LIMITS, type ListingRules, type OwnerListing } from '@flatrimony/shared';
import { useT } from '../../lib/client/app-context';
import {
  actOn,
  addPhoto,
  createListing,
  deleteMedia,
  getListing,
  patchListing,
  putCosts,
  putRules,
  type ListingResult,
} from '../../lib/client/listings';
import { useAreas } from '../pickers';
import { Button, Frame, Notice, RadioChips, Stepper } from '../ui';
import { LocationSearch } from './LocationSearch';
import { ConfirmDialog } from './pieces';
import { QrCode } from './QrCode';

/**
 * The web listing editor (T3.9b; FR-LST-05; docs/06 §8.12; the Android screens M28–M33 and the web
 * design `listing_stepper_video_handover`): Basics → Money → Rules → Photos → Video → Review &
 * submit, saved as a draft at every step ("Save draft" leaves; "Next" saves and goes on). The
 * first save of Basics creates the draft (POST /listings). The Video step is "Continue on your
 * phone": a QR code of `flatrimony://listings/{id}/video` that opens the same draft in the Android
 * app, where the walkthrough is recorded. The URL names the draft and the step, so a reload
 * continues where the owner was.
 */
export function ListingEditor({ id, initialStep }: { id?: string; initialStep?: ListingStep }) {
  const { t, locale } = useT();
  const router = useRouter();
  const [listing, setListing] = useState<OwnerListing | null>(null);
  const [etag, setEtag] = useState<string | undefined>(undefined);
  const [loading, setLoading] = useState(!!id);
  const [step, setStep] = useState<ListingStep>(id && initialStep ? initialStep : 'basics');
  const [basics, setBasics] = useState<BasicsDraft>(basicsFrom(null));
  const [money, setMoney] = useState<MoneyDraft>(moneyFrom(null));
  const [rules, setRules] = useState<ListingRules>(DEFAULT_RULES);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<MessageKey | null>(null);
  const [outcome, setOutcome] = useState<'live' | 'review' | null>(null);
  /** The listing could not be loaded: never fall back to creating a new one. */
  const [loadFailed, setLoadFailed] = useState<MessageKey | null>(null);
  /** A live listing whose edit the automatic checks held for review (told once). */
  const [held, setHeld] = useState(false);
  const saving = useRef(false);
  const statusRef = useRef<OwnerListing['status'] | null>(null);
  const myFlat = `/${locale}/my-flat`;

  /**
   * Every answer that sets the listing takes a number; a GET that started before a later answer
   * arrived is dropped, so an older listing (without a photo just added) and its older ETag never
   * replace a newer one.
   */
  const version = useRef(0);
  const adopt = useCallback((r: Extract<ListingResult, { ok: true }>, drafts = false) => {
    version.current++;
    if (statusRef.current === 'active' && r.listing.status === 'pending_review') setHeld(true);
    statusRef.current = r.listing.status;
    setListing(r.listing);
    setEtag(r.etag);
    if (drafts) {
      setBasics(basicsFrom(r.listing));
      setMoney(moneyFrom(r.listing));
      setRules(r.listing.rules ?? DEFAULT_RULES);
    }
  }, []);

  const idRef = useRef<string | null>(id ?? null);
  idRef.current = listing?.id ?? id ?? null;
  /** Fresh data from the API; `drafts` also replaces what the steps show (the first load). */
  const reload = useCallback(
    async (drafts: boolean): Promise<OwnerListing | null> => {
      const current = idRef.current;
      if (!current) return null;
      const asked = version.current;
      const r = await getListing(current);
      setLoading(false);
      if (r.ok && asked !== version.current) return null; // a newer answer already arrived
      if (r.ok) {
        adopt(r, drafts);
        setLoadFailed(null);
        return r.listing;
      }
      if (drafts) setLoadFailed(r.error);
      return null;
    },
    [adopt],
  );
  useEffect(() => {
    void reload(true);
    // Once, for the listing this page opened.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // The URL names the listing and the step, so a reload continues the same draft. Only the id
  // goes in it (no personal data).
  useEffect(() => {
    if (listing)
      window.history.replaceState(null, '', `?id=${encodeURIComponent(listing.id)}&step=${step}`);
  }, [listing?.id, step]); // eslint-disable-line react-hooks/exhaustive-deps -- id and step only
  // Photos, the video and the checklist can change elsewhere (the phone, verification).
  useEffect(() => {
    if (listing && (step === 'photos' || step === 'video' || step === 'review')) void reload(false);
  }, [step]); // eslint-disable-line react-hooks/exhaustive-deps -- on step change only
  // Without a listing only Basics can be shown (the others need the draft it creates).
  useEffect(() => {
    if (!loading && !listing && !id && step !== 'basics') setStep('basics');
  }, [loading, listing, id, step]);
  // Each step starts at the top, with its title focused (StepTitle).
  useEffect(() => {
    window.scrollTo({ top: 0 }); // returns a promise in newer browsers: not a clean-up
  }, [step]);

  /** Saves the current step; true when it may go on. */
  const save = useCallback(async (): Promise<boolean> => {
    if (saving.current) return false;
    setError(null);
    let problem: MessageKey | null = null;
    if (step === 'basics') problem = basicsProblem(basics);
    // A changed date must not be in the past (a saved draft keeps its old date until edited).
    if (
      !problem &&
      step === 'basics' &&
      basics.availableFrom &&
      basics.availableFrom !== listing?.availableFrom &&
      basics.availableFrom < todayIst(Date.now())
    )
      problem = 'listing.editor.basics.errors.availableFromPast';
    if (step === 'money') problem = moneyProblem(money);
    if (problem) {
      setError(problem);
      return false;
    }
    saving.current = true;
    setBusy(true);
    try {
      let r: ListingResult | null = null;
      if (step === 'basics') {
        if (!listing) {
          if (id) return false; // a listing that failed to load is never replaced by a new one
          r = await createListing(createRequest(basics, money));
        } else {
          const patch = basicsPatch(listing, basics);
          if (patch) r = await patchListing(listing.id, patch, etag);
        }
      } else if (step === 'money' && listing) {
        const rent = inr(money.rent)!;
        const deposit = inr(money.deposit)!;
        if (rent !== listing.rentPerPersonInr || deposit !== listing.depositPerPersonInr) {
          const p = await patchListing(
            listing.id,
            { rentPerPersonInr: rent, depositPerPersonInr: deposit },
            etag,
          );
          if (!p.ok) r = p;
          else {
            adopt(p);
            r = await putCosts(listing.id, costsFrom(money), p.etag);
          }
        } else r = await putCosts(listing.id, costsFrom(money), etag);
      } else if (step === 'rules' && listing) {
        // Unchanged rules are not written again (a write on a live listing re-runs the checks).
        if (!sameRules(rules, listing.rules)) r = await putRules(listing.id, rules, etag);
      }
      if (r && !r.ok) {
        setError(r.error);
        // Changed elsewhere (the phone): fetch the current version, keeping what was typed, so
        // the next try carries the current ETag.
        if (r.status === 412) void reload(false);
        return false;
      }
      if (r) adopt(r);
      return true;
    } finally {
      saving.current = false;
      setBusy(false);
    }
  }, [step, basics, money, rules, listing, etag, adopt, id, reload]);

  const next = async () => {
    const from = step;
    if (!(await save())) return;
    const i = stepIndex(from);
    if (i < LISTING_STEPS.length - 1) setStep(LISTING_STEPS[i + 1]!);
  };
  const saveDraft = async () => {
    if (await save()) router.push(`${myFlat}?saved=1`);
  };
  const back = () => {
    if (saving.current) return; // the save in flight decides where the owner goes
    const i = stepIndex(step);
    setError(null);
    if (i > 0) setStep(LISTING_STEPS[i - 1]!);
    else router.push(myFlat);
  };

  const submit = async () => {
    if (!listing || saving.current) return;
    saving.current = true;
    setBusy(true);
    setError(null);
    try {
      const r = await actOn(listing.id, 'submit');
      if (!r.ok) return setError(r.error);
      adopt(r);
      setOutcome(r.listing.status === 'active' ? 'live' : 'review');
    } catch {
      setError('listing.editor.errors.generic');
    } finally {
      saving.current = false;
      setBusy(false);
    }
  };

  if (loading)
    return (
      <Frame wide>
        <p className="muted" role="status">
          {t('state.loading')}
        </p>
      </Frame>
    );

  if (loadFailed && !listing)
    return (
      <Frame
        wide
        actions={
          <>
            {loadFailed !== 'listing.editor.errors.notFound' ? (
              <Button
                onClick={() => {
                  setLoading(true);
                  void reload(true);
                }}
              >
                {t('listing.myFlat.retry')}
              </Button>
            ) : null}
            <Button variant="secondary" onClick={() => router.push(myFlat)}>
              {t('listing.editor.review.toMyFlat')}
            </Button>
          </>
        }
      >
        <StepTitle
          overline={t('listing.editor.title')}
          title={
            loadFailed === 'listing.editor.errors.notFound'
              ? t('listing.editor.errors.notFound')
              : t('listing.myFlat.loadFailed')
          }
        />
        {loadFailed !== 'listing.editor.errors.notFound' ? (
          <Notice tone="error">{t(loadFailed)}</Notice>
        ) : null}
      </Frame>
    );

  if (outcome)
    return (
      <Frame
        wide
        actions={
          <Button testId="listing-to-my-flat" onClick={() => router.push(myFlat)}>
            {t('listing.editor.review.toMyFlat')}
          </Button>
        }
      >
        <StepTitle
          overline={t('listing.editor.title')}
          title={t(
            outcome === 'live'
              ? 'listing.editor.review.liveTitle'
              : 'listing.editor.review.reviewTitle',
          )}
          subtitle={t(
            outcome === 'live'
              ? 'listing.editor.review.liveBody'
              : 'listing.editor.review.reviewBody',
          )}
        />
      </Frame>
    );

  const n = stepIndex(step) + 1;
  const isDraft = !listing || listing.status === 'draft';
  const actions =
    step === 'review' ? (
      isDraft ? (
        <Button
          testId="listing-submit"
          busy={busy}
          disabled={!listing || listing.missing.length > 0}
          onClick={() => void submit()}
        >
          {t('listing.editor.review.submit')}
        </Button>
      ) : (
        <Button onClick={() => router.push(myFlat)}>{t('listing.editor.review.toMyFlat')}</Button>
      )
    ) : (
      <div className="footer-row">
        <Button
          variant="secondary"
          testId="listing-save-draft"
          disabled={busy}
          onClick={() => void saveDraft()}
        >
          {isDraft ? t('listing.editor.saveDraft') : t('listing.editor.save')}
        </Button>
        <Button testId="listing-next" busy={busy} onClick={() => void next()}>
          {t('listing.editor.next')}
        </Button>
      </div>
    );

  return (
    <Frame
      wide
      actions={
        <>
          {error ? <Notice tone="error">{t(error)}</Notice> : null}
          {actions}
        </>
      }
    >
      <StepNav step={step} listing={listing} />
      <StepTitle
        key={step}
        step={n}
        onBack={back}
        overline={`${t('listing.editor.stepOf', { step: n })} · ${t(`listing.editor.${step}.overline`)}`}
        title={t(`listing.editor.${step}.heading`)}
      />
      {listing?.status === 'active' && !held ? (
        <Notice tone="info">{t('listing.editor.liveEditNote')}</Notice>
      ) : null}
      {held ? <Notice tone="info">{t('listing.editor.heldForReview')}</Notice> : null}
      {step === 'basics' ? (
        <BasicsStep
          draft={basics}
          update={(patch) => {
            // From the latest state: a place lookup that ends later must not undo what was typed.
            setBasics((d) => ({ ...d, ...patch }));
            setError(null); // a refusal no longer describes what is on screen
          }}
        />
      ) : null}
      {step === 'money' ? (
        <MoneyStep
          draft={money}
          onChange={(m) => {
            setMoney(m);
            setError(null);
          }}
        />
      ) : null}
      {step === 'rules' ? <RulesStep value={rules} onChange={setRules} /> : null}
      {step === 'photos' && listing ? (
        <PhotosStep
          listing={listing}
          // The confirm answers with the listing and its ETag.
          onAdded={(added) => adopt(added)}
          onChanged={() => void reload(false)}
        />
      ) : null}
      {step === 'video' && listing ? (
        <VideoHandover listing={listing} onCheck={() => reload(false)} />
      ) : null}
      {step === 'review' && listing ? <ReviewStep listing={listing} /> : null}
    </Frame>
  );
}

/** Same house rules, field by field (no write, and no re-check of a live listing, otherwise). */
function sameRules(a: ListingRules, b: ListingRules | null): boolean {
  if (!b) return false;
  return (Object.keys(DEFAULT_RULES) as (keyof ListingRules)[]).every((k) => a[k] === b[k]);
}

// ------------------------------------------------------------------ frame pieces

/** Where the owner is: the six steps, the finished ones ticked (docs/06 §8.12). */
function StepNav({ step, listing }: { step: ListingStep; listing: OwnerListing | null }) {
  const { t } = useT();
  const done = stepsDone(listing);
  return (
    <nav aria-label={t('listing.editor.stepsLabel')}>
      <ol className="step-nav">
        {LISTING_STEPS.map((s) => (
          <li
            key={s}
            className={s === step ? 'current' : done[s] ? 'done' : undefined}
            aria-current={s === step ? 'step' : undefined}
          >
            {done[s] && s !== step ? <span aria-hidden="true">✓</span> : null}
            <span>{t(`listing.editor.steps.${s}`)}</span>
            {done[s] && s !== step ? (
              <span className="visually-hidden">{t('listing.editor.review.done')}</span>
            ) : null}
          </li>
        ))}
      </ol>
    </nav>
  );
}

/** Back, the overline and the step's title (focused when the step opens, for screen readers). */
function StepTitle({
  step,
  overline,
  title,
  subtitle,
  onBack,
}: {
  step?: number;
  overline: string;
  title: string;
  subtitle?: string;
  onBack?: () => void;
}) {
  const { t } = useT();
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    heading.current?.focus();
  }, []);
  return (
    <header className="step-header">
      {onBack ? (
        <div className="step-top">
          <button type="button" className="back" aria-label={t('common.back')} onClick={onBack}>
            <span aria-hidden="true">←</span>
          </button>
          {step ? (
            <div className="progress" aria-hidden="true">
              <div className="progress-fill" style={{ width: `${(step / 6) * 100}%` }} />
            </div>
          ) : null}
        </div>
      ) : null}
      <p className="overline">{overline}</p>
      <h1 ref={heading} tabIndex={-1}>
        {title}
      </h1>
      {subtitle ? <p className="subtitle">{subtitle}</p> : null}
    </header>
  );
}

function Card({ children, className }: { children: ReactNode; className?: string }) {
  return <section className={className ? `card ${className}` : 'card'}>{children}</section>;
}

// ------------------------------------------------------------------ Basics (M28)

const CITY_ORDER = ['gurugram', 'delhi', 'noida', 'ghaziabad', 'faridabad'] as const;

function BasicsStep({
  draft,
  update,
}: {
  draft: BasicsDraft;
  update: (patch: Partial<BasicsDraft>) => void;
}) {
  const { t } = useT();
  const reference = useAreas();
  const set = <K extends keyof BasicsDraft>(k: K, v: BasicsDraft[K]) =>
    update({ [k]: v } as Partial<BasicsDraft>);
  const vacant = draft.totalFlatmates - draft.currentFlatmates;
  const today = todayIst(Date.now());
  return (
    <>
      <Card>
        <div className="field">
          <label htmlFor="listing-title">{t('listing.editor.basics.titleLabel')}</label>
          <input
            id="listing-title"
            data-testid="listing-title"
            value={draft.title}
            onChange={(e) => set('title', e.target.value)}
            placeholder={t('listing.editor.basics.titlePlaceholder')}
            maxLength={LISTING_LIMITS.titleMaxChars}
          />
        </div>
        <div className="field">
          <label htmlFor="listing-description">{t('listing.editor.basics.descriptionLabel')}</label>
          <textarea
            id="listing-description"
            value={draft.description}
            onChange={(e) => set('description', e.target.value)}
            placeholder={t('listing.editor.basics.descriptionPlaceholder')}
            maxLength={LISTING_LIMITS.descriptionMaxChars}
            rows={4}
          />
        </div>
      </Card>
      <Card>
        <h2 className="h3">{t('listing.editor.basics.area')}</h2>
        {reference.failed ? (
          <div className="stack">
            <Notice tone="error">{t('onboarding.commute.loadFailed')}</Notice>
            <Button variant="secondary" onClick={() => void reference.reload()}>
              {t('onboarding.commute.retry')}
            </Button>
          </div>
        ) : !reference.areas ? (
          <p className="muted" role="status">
            {t('onboarding.commute.loading')}
          </p>
        ) : (
          CITY_ORDER.map((city) => {
            const inCity = reference.areas!.filter((a) => a.city === city);
            if (inCity.length === 0) return null;
            return (
              <RadioChips
                key={city}
                legend={t(`onboarding.commute.cities.${city}`)}
                options={inCity.map((a) => ({ value: a.id, label: a.name }))}
                value={draft.areaId ?? undefined}
                onChange={(areaId) => set('areaId', areaId)}
              />
            );
          })
        )}
      </Card>
      <Card>
        <h2 className="h3">{t('listing.editor.basics.location')}</h2>
        <LocationSearch
          value={draft.location}
          label={
            draft.locationLabel ?? (draft.location ? t('listing.editor.basics.pinSaved') : null)
          }
          onChange={(location, label) => update({ location, locationLabel: label })}
        />
        <div className="field">
          <label htmlFor="listing-address">{t('listing.editor.basics.addressLabel')}</label>
          <input
            id="listing-address"
            value={draft.address}
            onChange={(e) => set('address', e.target.value)}
            maxLength={LISTING_LIMITS.addressMaxChars}
            autoComplete="off"
            aria-describedby="listing-address-hint"
          />
          <p id="listing-address-hint" className="muted caption">
            {t('listing.editor.basics.addressHint')}
          </p>
        </div>
      </Card>
      <Card>
        <RadioChips
          legend={t('listing.editor.basics.bhk')}
          options={[1, 2, 3, 4, 5, 6].map((b) => ({
            value: b,
            label: t('listing.editor.basics.bhkValue', { count: b }),
          }))}
          value={draft.bhk}
          onChange={(b) => set('bhk', b)}
        />
        <RadioChips
          legend={t('listing.editor.basics.roomType')}
          options={(['private', 'shared'] as const).map((r) => ({
            value: r,
            label: t(`listing.editor.basics.${r}`),
          }))}
          value={draft.roomType}
          onChange={(r) => set('roomType', r)}
        />
        <RadioChips
          legend={t('listing.editor.basics.furnishing')}
          options={(['unfurnished', 'semi_furnished', 'furnished'] as const).map((f) => ({
            value: f,
            label: t(`listing.editor.basics.${f}`),
          }))}
          value={draft.furnishing}
          onChange={(f) => set('furnishing', f)}
        />
      </Card>
      <Card>
        <div className="field">
          <label htmlFor="listing-available">{t('listing.editor.basics.availableFrom')}</label>
          <input
            id="listing-available"
            data-testid="listing-available-from"
            type="date"
            min={today}
            value={draft.availableFrom ?? ''}
            onChange={(e) => set('availableFrom', e.target.value || null)}
          />
        </div>
        <Stepper
          label={t('listing.editor.basics.lease')}
          value={t('listing.editor.basics.leaseValue', { months: draft.minLeaseMonths })}
          onMinus={() => set('minLeaseMonths', Math.max(1, draft.minLeaseMonths - 1))}
          onPlus={() => set('minLeaseMonths', Math.min(36, draft.minLeaseMonths + 1))}
          minusLabel={t('listing.editor.basics.decreaseField', {
            field: t('listing.editor.basics.lease'),
          })}
          plusLabel={t('listing.editor.basics.increaseField', {
            field: t('listing.editor.basics.lease'),
          })}
          canMinus={draft.minLeaseMonths > 1}
          canPlus={draft.minLeaseMonths < 36}
        />
      </Card>
      <Card>
        <Stepper
          label={t('listing.editor.basics.total')}
          value={String(draft.totalFlatmates)}
          onMinus={() =>
            update({
              totalFlatmates: draft.totalFlatmates - 1,
              currentFlatmates: Math.min(draft.currentFlatmates, draft.totalFlatmates - 2),
            })
          }
          onPlus={() => set('totalFlatmates', draft.totalFlatmates + 1)}
          minusLabel={t('listing.editor.basics.decreaseField', {
            field: t('listing.editor.basics.total'),
          })}
          plusLabel={t('listing.editor.basics.increaseField', {
            field: t('listing.editor.basics.total'),
          })}
          canMinus={draft.totalFlatmates > 2}
          canPlus={draft.totalFlatmates < 10}
        />
        <Stepper
          label={t('listing.editor.basics.current')}
          value={String(draft.currentFlatmates)}
          onMinus={() => set('currentFlatmates', draft.currentFlatmates - 1)}
          onPlus={() => set('currentFlatmates', draft.currentFlatmates + 1)}
          minusLabel={t('listing.editor.basics.decreaseField', {
            field: t('listing.editor.basics.current'),
          })}
          plusLabel={t('listing.editor.basics.increaseField', {
            field: t('listing.editor.basics.current'),
          })}
          canMinus={draft.currentFlatmates > 1}
          canPlus={draft.currentFlatmates < draft.totalFlatmates - 1}
        />
        {vacant > 0 ? (
          <p className="good" aria-live="polite">
            {t('listing.editor.basics.vacancy', { count: vacant })}
          </p>
        ) : null}
      </Card>
    </>
  );
}

// ------------------------------------------------------------------ Money (M29)

function MoneyStep({ draft, onChange }: { draft: MoneyDraft; onChange: (d: MoneyDraft) => void }) {
  const { t, locale } = useT();
  const set = (k: keyof Omit<MoneyDraft, 'oneTime'>, v: string) => onChange({ ...draft, [k]: v });
  const total = liveTrueMonthly(draft);
  const rent = inr(draft.rent);
  const recurring = total !== null && rent !== null ? total - rent : null;
  return (
    <>
      <div className="no-broker">
        <span aria-hidden="true" className="no-broker-icon">
          ✓
        </span>
        <div>
          <p className="label">{t('listing.editor.money.noBrokerTitle')}</p>
          <p className="caption">{t('listing.editor.money.noBrokerBody')}</p>
        </div>
      </div>
      <div className="money-grid">
        <div className="stack">
          <Card>
            <Amount
              id="listing-rent"
              label={t('listing.editor.money.rent')}
              value={draft.rent}
              onChange={(v) => set('rent', v)}
            />
            <Amount
              id="listing-deposit"
              label={t('listing.editor.money.deposit')}
              value={draft.deposit}
              onChange={(v) => set('deposit', v)}
            />
          </Card>
          <Card>
            <h2 className="h3">{t('listing.editor.money.recurringTitle')}</h2>
            {(['maintenance', 'electricity', 'wifi', 'help', 'other'] as const).map((k) => (
              <Amount
                key={k}
                id={`listing-${k}`}
                label={t(`listing.editor.money.${k}`)}
                value={draft[k]}
                onChange={(v) => set(k, v)}
              />
            ))}
          </Card>
          <Card>
            <h2 className="h3">{t('listing.editor.money.oneTimeTitle')}</h2>
            {draft.oneTime.map((o, i) => (
              <div key={i} className="one-time-row">
                <input
                  value={o.label}
                  onChange={(e) =>
                    onChange({
                      ...draft,
                      oneTime: draft.oneTime.map((x, j) =>
                        j === i ? { ...x, label: e.target.value } : x,
                      ),
                    })
                  }
                  placeholder={t('listing.editor.money.oneTimeLabel')}
                  aria-label={`${t('listing.editor.money.oneTimeLabel')} ${i + 1}`}
                  maxLength={40}
                />
                <input
                  value={o.amount}
                  onChange={(e) =>
                    onChange({
                      ...draft,
                      oneTime: draft.oneTime.map((x, j) =>
                        j === i ? { ...x, amount: e.target.value.replace(/[^0-9.]/g, '') } : x,
                      ),
                    })
                  }
                  inputMode="numeric"
                  placeholder="₹"
                  aria-label={`${t('listing.editor.money.oneTimeAmount')} ${i + 1}`}
                  maxLength={9}
                />
                <button
                  type="button"
                  className="icon-btn"
                  aria-label={`${t('listing.editor.money.remove')} ${i + 1}`}
                  onClick={() =>
                    onChange({ ...draft, oneTime: draft.oneTime.filter((_, j) => j !== i) })
                  }
                >
                  <span aria-hidden="true">×</span>
                </button>
              </div>
            ))}
            {draft.oneTime.length < 10 ? (
              <Button
                variant="secondary"
                onClick={() =>
                  onChange({ ...draft, oneTime: [...draft.oneTime, { label: '', amount: '' }] })
                }
              >
                {`+ ${t('listing.editor.money.addOneTime')}`}
              </Button>
            ) : null}
          </Card>
        </div>
        <aside className="total-card" aria-live="polite" data-testid="listing-total">
          <p className="label">{t('listing.editor.money.totalTitle')}</p>
          <dl>
            <div>
              <dt>{t('listing.editor.money.totalRent')}</dt>
              <dd>{rent !== null ? formatINR(rent, locale) : '–'}</dd>
            </div>
            <div>
              <dt>{t('listing.editor.money.totalCosts')}</dt>
              <dd>{recurring !== null ? formatINR(recurring, locale) : '–'}</dd>
            </div>
          </dl>
          <p className="total-value">{total !== null ? formatINR(total, locale) : '–'}</p>
        </aside>
      </div>
    </>
  );
}

function Amount({
  id,
  label,
  value,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="amount-row">
      <label htmlFor={id}>{label}</label>
      <div className="amount-box">
        <span aria-hidden="true">₹</span>
        <input
          id={id}
          data-testid={id}
          value={value}
          // Digits only, but a typed "." stays visible so "18000.5" is refused, not read as 180005.
          onChange={(e) => onChange(e.target.value.replace(/[^0-9.]/g, ''))}
          inputMode="numeric"
          maxLength={7}
          placeholder="0"
        />
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ Rules (M30)

function RulesStep({
  value,
  onChange,
}: {
  value: ListingRules;
  onChange: (r: ListingRules) => void;
}) {
  const { t } = useT();
  const set = <K extends keyof ListingRules>(k: K, v: ListingRules[K]) =>
    onChange({ ...value, [k]: v });
  const toggles = [
    ['bachelorsAllowed', 'bachelors', 'bachelorsSub'],
    ['petsAllowed', 'pets', 'petsSub'],
    ['smokingAllowed', 'smoking', 'smokingSub'],
  ] as const;
  return (
    <>
      <p className="muted">{t('listing.editor.rules.body')}</p>
      <div className="cards cards-2">
        {toggles.map(([k, title, sub]) => (
          <label key={k} className="card-option">
            <input type="checkbox" checked={value[k]} onChange={(e) => set(k, e.target.checked)} />
            <span className="card-title">{t(`listing.editor.rules.${title}`)}</span>
            <span className="card-sub">{t(`listing.editor.rules.${sub}`)}</span>
          </label>
        ))}
      </div>
      <Card>
        <RadioChips
          legend={t('listing.editor.rules.gender')}
          options={(
            [
              ['any', 'genderAny'],
              ['female_only', 'genderFemale'],
              ['male_only', 'genderMale'],
            ] as const
          ).map(([v, k]) => ({ value: v, label: t(`listing.editor.rules.${k}`) }))}
          value={value.genderRule}
          onChange={(v) => set('genderRule', v)}
        />
        <RadioChips
          legend={t('listing.editor.rules.food')}
          options={(
            [
              ['any', 'foodAny'],
              ['veg_only', 'foodVeg'],
              ['eggetarian_ok', 'foodEgg'],
            ] as const
          ).map(([v, k]) => ({ value: v, label: t(`listing.editor.rules.${k}`) }))}
          value={value.foodRule}
          onChange={(v) => set('foodRule', v)}
        />
        <RadioChips
          legend={t('listing.editor.rules.guests')}
          options={(
            [
              ['allowed', 'guestsAllowed'],
              ['day_only', 'guestsDay'],
              ['not_allowed', 'guestsNot'],
            ] as const
          ).map(([v, k]) => ({ value: v, label: t(`listing.editor.rules.${k}`) }))}
          value={value.guestsRule}
          onChange={(v) => set('guestsRule', v)}
        />
      </Card>
    </>
  );
}

// ------------------------------------------------------------------ Photos (M31)

function PhotosStep({
  listing,
  onAdded,
  onChanged,
}: {
  listing: OwnerListing;
  onAdded: (added: Extract<ListingResult, { ok: true }>) => void;
  onChanged: () => void;
}) {
  const { t } = useT();
  const [adding, setAdding] = useState(false);
  const [problem, setProblem] = useState<MessageKey | null>(null);
  const [removing, setRemoving] = useState<{ id: string; number: number } | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const photos = listing.media
    .filter((m) => m.kind === 'photo')
    .sort((a, b) => a.position - b.position);
  const position = nextPhotoPosition(listing);

  const add = async (file: File | undefined) => {
    if (!file || position === null || adding) return;
    setAdding(true);
    setProblem(null);
    const r = await addPhoto(listing.id, file, position);
    setAdding(false);
    if (r.ok) onAdded(r);
    else setProblem(r.error);
  };
  const remove = async () => {
    const target = removing;
    setRemoving(null);
    if (!target) return;
    setProblem(null);
    const r = await deleteMedia(listing.id, target.id);
    if (r.ok) onChanged();
    else setProblem(r.error);
  };

  return (
    <>
      <div className="row">
        <p className="muted">{t('listing.editor.photos.body')}</p>
        <span className="count-chip" aria-live="polite">
          {t('listing.editor.photos.count', { count: photos.length })}
        </span>
      </div>
      <ul className="photo-grid">
        {photos.map((p, i) => (
          <li key={p.id} className="tile">
            {p.url ? (
              // Signed, short-lived storage URLs: next/image cannot optimise them.
              <img src={p.url} alt={t('listing.editor.photos.photoLabel', { number: i + 1 })} />
            ) : (
              <div className="no-image" />
            )}
            {i === 0 ? (
              <span className="cover-badge">{t('listing.editor.photos.cover')}</span>
            ) : null}
            <button
              type="button"
              className="remove-btn"
              aria-label={t('listing.editor.photos.removeNumbered', { number: i + 1 })}
              onClick={() => setRemoving({ id: p.id, number: i + 1 })}
            >
              <span aria-hidden="true">×</span>
            </button>
          </li>
        ))}
        {position !== null ? (
          <li className="tile">
            <button
              type="button"
              className="add-tile"
              data-testid="listing-add-photo"
              aria-busy={adding || undefined}
              disabled={adding}
              onClick={() => input.current?.click()}
            >
              {adding ? (
                <span className="spinner" aria-hidden="true" />
              ) : (
                <span aria-hidden="true" className="add-plus">
                  +
                </span>
              )}
              <span>
                {adding ? t('listing.editor.photos.uploading') : t('listing.editor.photos.add')}
              </span>
            </button>
            <input
              ref={input}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="visually-hidden"
              tabIndex={-1}
              aria-hidden="true"
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = ''; // the same file can be picked again after a failure
                void add(file);
              }}
            />
          </li>
        ) : null}
      </ul>
      {problem ? <Notice tone="error">{t(problem)}</Notice> : null}
      <p className="muted caption">{t('listing.editor.photos.tip')}</p>
      <ConfirmDialog
        open={!!removing}
        title={t('listing.editor.photos.removeTitle')}
        body={t('listing.editor.photos.removeBody')}
        confirmLabel={t('listing.editor.photos.removeConfirm')}
        cancelLabel={t('listing.myFlat.cancel')}
        onConfirm={() => void remove()}
        onCancel={() => setRemoving(null)}
      />
    </>
  );
}

// ------------------------------------------------------------------ Video (web: continue on phone)

/**
 * "Continue on your phone" (FR-LST-05; docs/06 §8.12; design `listing_stepper_video_handover`):
 * the walkthrough is recorded in the Android app, so the web shows a QR code of the link that
 * opens this draft at the Video step there, the steps already done, and a way to check whether the
 * video has arrived. "Send link to my phone" is not offered: the API has no way to text a link yet
 * (docs/07 T3.9b, Blocked).
 */
function VideoHandover({
  listing,
  onCheck,
}: {
  listing: OwnerListing;
  onCheck: () => Promise<OwnerListing | null>;
}) {
  const { t } = useT();
  const [checking, setChecking] = useState(false);
  const [notYet, setNotYet] = useState(false);
  const link = walkthroughAppLink(listing.id);
  const video = listing.media.find((m) => m.kind === 'walkthrough_video');
  const done = stepsDone(listing);
  const finished = LISTING_STEPS.filter((s) => s !== 'video' && s !== 'review' && done[s]);
  return (
    <section className="handover">
      <div className="handover-hero">
        <p className="badge">{t('listing.editor.video.handover.badge')}</p>
        <h2 className="handover-title">{t('listing.editor.video.handover.title')}</h2>
        <p className="muted">{t('listing.editor.video.handover.body')}</p>
      </div>
      <div className="handover-body">
        {link ? (
          <figure className="qr-frame">
            <QrCode
              text={link}
              label={t('listing.editor.video.handover.qrLabel')}
              testId="listing-video-qr"
            />
            <figcaption>{t('listing.editor.video.handover.scan')}</figcaption>
          </figure>
        ) : null}
        <div className="stack">
          {video ? (
            <p className="good label" role="status">
              {video.durationS
                ? t('listing.editor.video.recorded', { seconds: video.durationS })
                : t('listing.editor.review.videoDone')}
            </p>
          ) : null}
          <p>{t('listing.editor.video.handover.noScanner')}</p>
          <p className="notice notice-info">{t('listing.editor.video.handover.note')}</p>
          {finished.length ? (
            <div>
              <h3 className="label">{t('listing.editor.video.handover.doneTitle')}</h3>
              <ul className="done-list">
                {finished.map((s) => (
                  <li key={s}>
                    <span aria-hidden="true">✓ </span>
                    {t(`listing.editor.steps.${s}`)}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {!video ? (
            <Button
              variant="secondary"
              busy={checking}
              testId="listing-video-check"
              onClick={async () => {
                setChecking(true);
                setNotYet(false);
                const fresh = await onCheck();
                setChecking(false);
                setNotYet(!fresh?.media.some((m) => m.kind === 'walkthrough_video'));
              }}
            >
              {t('listing.editor.video.handover.check')}
            </Button>
          ) : null}
          {notYet ? <Notice tone="info">{t('listing.editor.video.handover.notYet')}</Notice> : null}
        </div>
      </div>
    </section>
  );
}

// ------------------------------------------------------------------ Review (M33)

function ReviewStep({ listing }: { listing: OwnerListing }) {
  const { t, locale } = useT();
  const done = stepsDone(listing);
  const photos = listing.media.filter((m) => m.kind === 'photo').length;
  const verified = !listing.missing.includes('verification');
  const items: { key: string; label: string; detail: string; ok: boolean }[] = [
    {
      key: 'basics',
      label: t('listing.editor.steps.basics'),
      detail: `${t('listing.editor.basics.bhkValue', { count: listing.bhk })} · ${t(`listing.editor.basics.${listing.roomType}`)} · ${t(`listing.editor.basics.${listing.furnishing}`)}`,
      ok: done.basics,
    },
    {
      key: 'money',
      label: t('listing.editor.steps.money'),
      detail:
        done.money && listing.trueMonthlyPerPersonInr !== null
          ? t('listing.editor.review.allIn', {
              amount: formatINR(listing.trueMonthlyPerPersonInr, locale),
            })
          : t('listing.editor.review.missing'),
      ok: done.money,
    },
    {
      key: 'rules',
      label: t('listing.editor.steps.rules'),
      detail: done.rules ? t('listing.editor.review.done') : t('listing.editor.review.missing'),
      ok: done.rules,
    },
    {
      key: 'photos',
      label: t('listing.editor.steps.photos'),
      detail: t('listing.editor.review.photosCount', { count: photos }),
      ok: done.photos,
    },
    {
      key: 'video',
      label: t('listing.editor.steps.video'),
      detail: done.video
        ? t('listing.editor.review.videoDone')
        : t('listing.editor.video.handover.notYet'),
      ok: done.video,
    },
    {
      key: 'verification',
      label: t('listing.editor.review.verification'),
      detail: verified
        ? t('listing.editor.review.verified')
        : `${t('listing.editor.review.verifyBody')} ${t('listing.editor.review.verifyInApp')}`,
      ok: verified,
    },
  ];
  return (
    <>
      <Card>
        <h2 className="h3">{listing.title}</h2>
        {done.money && listing.trueMonthlyPerPersonInr !== null ? (
          <p className="brand">
            {t('listing.editor.review.allIn', {
              amount: formatINR(listing.trueMonthlyPerPersonInr, locale),
            })}
          </p>
        ) : null}
      </Card>
      <Card>
        <h2 className="h3">{t('listing.editor.review.checklist')}</h2>
        <ul className="checklist">
          {items.map((item) => (
            <li key={item.key} data-testid={`check-${item.key}`}>
              <span className={item.ok ? 'check-ok' : 'check-missing'} aria-hidden="true">
                {item.ok ? '✓' : '!'}
              </span>
              <div>
                <p className="label">
                  {item.label}
                  <span className="visually-hidden">
                    {' '}
                    (
                    {item.ok ? t('listing.editor.review.done') : t('listing.editor.review.missing')}
                    )
                  </span>
                </p>
                <p className="muted caption">{item.detail}</p>
              </div>
            </li>
          ))}
        </ul>
      </Card>
      {listing.status === 'draft' ? (
        <p className="muted caption center">{t('listing.editor.review.note')}</p>
      ) : null}
    </>
  );
}
