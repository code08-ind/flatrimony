import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import {
  ActivityIndicator,
  Image,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
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
  wholeRupeesTyped,
  nextPhotoPosition,
  stepIndex,
  stepsDone,
  type BasicsDraft,
  type ListingStep,
  type MoneyDraft,
} from '@flatrimony/client';
import { formatINR, type Locale, type MessageKey } from '@flatrimony/i18n';
import { LISTING_LIMITS, type ListingRules, type OwnerListing } from '@flatrimony/shared';
import {
  actOn,
  createListing,
  deleteMedia,
  getListing,
  patchListing,
  pickAndAddPhoto,
  putCosts,
  putRules,
  type ListingResult,
} from '../../src/listing/api';
import { DatePicker } from '../../src/listing/DatePicker';
import { LocationSearch } from '../../src/listing/LocationSearch';
import { textStyle, theme } from '../../src/theme';
import { useMe } from '../../src/me';
import { useT } from '../../src/useT';
import { PrimaryButton, SecondaryButton } from '../../src/ui/buttons';
import { AreaPicker } from '../../src/ui/biodata/AreaPicker';
import { confirmAction } from '../../src/ui/confirm';
import {
  Check,
  CigaretteSlash,
  PawPrint,
  Plus,
  SealCheck,
  ShieldCheck,
  UsersThree,
  VideoCamera,
  WarningCircle,
  X,
} from '../../src/ui/icons';
import { Notice } from '../../src/ui/Notice';
import { ChipGroup, ChoiceChip, OptionCard, StepHeader, Stepper } from '../../src/ui/onboarding';
import { Screen } from '../../src/ui/Screen';

const isStep = (s: unknown): s is ListingStep =>
  typeof s === 'string' && (LISTING_STEPS as readonly string[]).includes(s);

/**
 * The listing editor (T3.9; docs/06 §8.12; designs M28–M33): Basics → Money → Rules → Photos →
 * Video → Review & submit, saved as a draft at every step ("Save draft" leaves; "Next" saves and
 * goes on). The first save of Basics creates the draft (POST /listings); later steps write their
 * part. A new listing opens at Basics; My Flat opens a draft at its first unfinished step.
 */
export default function ListingEditor() {
  const params = useLocalSearchParams<{ id?: string; step?: string }>();
  const { t, locale } = useT();
  const [listing, setListing] = useState<OwnerListing | null>(null);
  const [etag, setEtag] = useState<string | undefined>(undefined);
  const [loading, setLoading] = useState(!!params.id);
  const [step, setStep] = useState<ListingStep>(isStep(params.step) ? params.step : 'basics');
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
  const { me } = useMe();

  const adopt = useCallback((r: Extract<ListingResult, { ok: true }>, drafts = false) => {
    // An edit of a live listing that the automatic checks hold takes it out of Discover: say so.
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

  // An existing listing: load it once; again when coming back (the recorder, verification), so
  // the checklist, the ETag and what is missing are current. Typed drafts are kept.
  const idRef = useRef<string | null>(params.id ?? null);
  idRef.current = listing?.id ?? params.id ?? null;
  // Every write and every reload takes a new stamp. A reload adopts its answer only if nothing
  // newer happened while it was on its way, so a slow reload never undoes a photo just added (or
  // brings back an old ETag that turns the next save into a 412).
  const stamp = useRef(0);
  const reload = useCallback(
    async (drafts: boolean) => {
      const id = idRef.current;
      if (!id) return;
      const mine = ++stamp.current;
      const r = await getListing(id);
      if (mine !== stamp.current) return;
      if (r.ok) {
        adopt(r, drafts);
        setLoadFailed(null);
      } else if (drafts) setLoadFailed(r.error);
      setLoading(false);
    },
    [adopt],
  );
  useEffect(() => {
    void reload(true);
    // Once, for the listing this screen opened.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const focusedOnce = useRef(false);
  useFocusEffect(
    useCallback(() => {
      if (!focusedOnce.current) {
        focusedOnce.current = true; // the first focus is the load above
        return;
      }
      void reload(false);
    }, [reload]),
  );
  // The URL names the listing and the step, so a reload (web) continues the same draft.
  useEffect(() => {
    if (listing) router.setParams({ id: listing.id, step });
  }, [listing?.id, step]); // eslint-disable-line react-hooks/exhaustive-deps -- id and step only
  // Photos, the video and the checklist can change elsewhere (the phone, verification): fresh
  // data when those steps open.
  useEffect(() => {
    if (listing && (step === 'photos' || step === 'video' || step === 'review')) void reload(false);
  }, [step]); // eslint-disable-line react-hooks/exhaustive-deps -- on step change only
  // Without a listing only Basics can be shown (the others need the draft it creates).
  useEffect(() => {
    if (!loading && !listing && !params.id && step !== 'basics') setStep('basics');
  }, [loading, listing, params.id, step]);

  const leave = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace('/my-flat');
  }, []);

  /** Saves the current step; true when it may go on. */
  const save = useCallback(async (): Promise<boolean> => {
    if (saving.current) return false;
    setError(null);
    let problem: MessageKey | null = null;
    if (step === 'basics') problem = basicsProblem(basics);
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
          // A listing that failed to load is never replaced by a new one.
          if (params.id) return false;
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
            stamp.current++;
            adopt(p);
            r = await putCosts(listing.id, costsFrom(money), p.etag);
          }
        } else r = await putCosts(listing.id, costsFrom(money), etag);
      } else if (step === 'rules' && listing) {
        // Unchanged rules are not written again (a write on a live listing re-runs the checks).
        if (JSON.stringify(rules) !== JSON.stringify(listing.rules))
          r = await putRules(listing.id, rules, etag);
      }
      if (r && !r.ok) {
        setError(r.error);
        return false;
      }
      if (r) {
        stamp.current++;
        adopt(r);
      }
      return true;
    } finally {
      saving.current = false;
      setBusy(false);
    }
  }, [step, basics, money, rules, listing, etag, adopt, params.id]);

  const next = async () => {
    if (!(await save())) return;
    const i = stepIndex(step);
    if (i < LISTING_STEPS.length - 1) setStep(LISTING_STEPS[i + 1]!);
  };
  const saveDraft = async () => {
    if (await save()) leave();
  };
  const back = () => {
    const i = stepIndex(step);
    setError(null);
    if (i > 0) setStep(LISTING_STEPS[i - 1]!);
    else leave();
  };

  const submit = async () => {
    if (!listing || saving.current) return;
    saving.current = true;
    setBusy(true);
    setError(null);
    const r = await actOn(listing.id, 'submit');
    saving.current = false;
    setBusy(false);
    if (!r.ok) return setError(r.error);
    stamp.current++;
    adopt(r);
    setOutcome(r.listing.status === 'active' ? 'live' : 'review');
  };

  if (loading)
    return (
      <Screen>
        <ActivityIndicator color={theme.color.brand.primary} />
      </Screen>
    );

  // Listings are for members with a room (FR-LST-01); the API refuses the rest anyway.
  if (me && me.intent !== 'have_room')
    return (
      <Screen>
        <StepHeader
          overline={t('listing.editor.title')}
          title={t('listing.myFlat.notHaveRoomTitle')}
          onBack={leave}
          backLabel={t('common.back')}
          locale={locale}
        />
        <Text style={[textStyle('body', locale), styles.muted]}>
          {t('listing.myFlat.notHaveRoomBody')}
        </Text>
      </Screen>
    );

  if (loadFailed && !listing)
    return (
      <Screen
        footer={
          <SecondaryButton
            label={t('listing.myFlat.retry')}
            onPress={() => {
              setLoading(true);
              void reload(true);
            }}
            locale={locale}
            trailingArrow={false}
          />
        }
      >
        <StepHeader
          overline={t('listing.editor.title')}
          title={t('listing.myFlat.loadFailed')}
          onBack={leave}
          backLabel={t('common.back')}
          locale={locale}
        />
        <Notice tone="error" locale={locale} message={t(loadFailed)} />
      </Screen>
    );

  if (outcome)
    return (
      <Screen
        footer={
          <PrimaryButton
            testID="listing-to-my-flat"
            label={t('listing.editor.review.toMyFlat')}
            onPress={() => router.replace('/my-flat')}
            locale={locale}
          />
        }
      >
        <View style={[styles.titles, styles.centered]}>
          <SealCheck size={56} color={theme.semantic.status.verified.fg} weight="fill" />
          <Text accessibilityRole="header" style={[textStyle('display', locale), styles.center]}>
            {t(
              outcome === 'live'
                ? 'listing.editor.review.liveTitle'
                : 'listing.editor.review.reviewTitle',
            )}
          </Text>
          <Text style={[textStyle('bodyLg', locale), styles.muted, styles.center]}>
            {t(
              outcome === 'live'
                ? 'listing.editor.review.liveBody'
                : 'listing.editor.review.reviewBody',
            )}
          </Text>
        </View>
      </Screen>
    );

  const n = stepIndex(step) + 1;
  const isDraft = !listing || listing.status === 'draft';
  const actions =
    step === 'review' ? (
      isDraft ? (
        <PrimaryButton
          testID="listing-submit"
          label={t('listing.editor.review.submit')}
          onPress={() => void submit()}
          busy={busy}
          disabled={!listing || listing.missing.length > 0}
          locale={locale}
        />
      ) : (
        <PrimaryButton
          label={t('listing.editor.review.toMyFlat')}
          onPress={leave}
          locale={locale}
        />
      )
    ) : (
      <View style={styles.footerRow}>
        <View style={{ flex: 1 }}>
          <SecondaryButton
            testID="listing-save-draft"
            label={isDraft ? t('listing.editor.saveDraft') : t('listing.editor.save')}
            onPress={() => void saveDraft()}
            disabled={busy}
            locale={locale}
            trailingArrow={false}
          />
        </View>
        <View style={{ flex: 1.4 }}>
          <PrimaryButton
            testID="listing-next"
            label={t('listing.editor.next')}
            onPress={() => void next()}
            busy={busy}
            locale={locale}
          />
        </View>
      </View>
    );

  // The error sits by the buttons, where the owner just tapped (a long step scrolls it away).
  const footer = (
    <View style={{ gap: theme.space['2'] }}>
      {error ? <Notice tone="error" locale={locale} message={t(error)} /> : null}
      {actions}
    </View>
  );

  return (
    <Screen footer={footer}>
      <StepHeader
        step={n}
        total={LISTING_STEPS.length}
        stepLabel={t('listing.editor.stepOf', { step: n })}
        overline={t(`listing.editor.${step}.overline`)}
        title={t(`listing.editor.${step}.heading`)}
        onBack={back}
        backLabel={t('common.back')}
        locale={locale}
      />
      {listing?.status === 'active' && !held ? (
        <Notice tone="info" locale={locale} message={t('listing.editor.liveEditNote')} />
      ) : null}
      {held ? (
        <Notice tone="info" locale={locale} message={t('listing.editor.heldForReview')} />
      ) : null}
      {step === 'basics' ? <BasicsStep draft={basics} onChange={setBasics} /> : null}
      {step === 'money' ? <MoneyStep draft={money} onChange={setMoney} /> : null}
      {step === 'rules' ? <RulesStep value={rules} onChange={setRules} /> : null}
      {step === 'photos' && listing ? (
        <PhotosStep
          listing={listing}
          onAdded={(updated) => {
            // The confirm answers with the listing: adopt it at once (the next free position),
            // then reload for its ETag.
            stamp.current++;
            setListing(updated);
            if (statusRef.current === 'active' && updated.status === 'pending_review')
              setHeld(true);
            statusRef.current = updated.status;
            void reload(false);
          }}
          onChanged={() => void reload(false)}
        />
      ) : null}
      {step === 'video' && listing ? <VideoStep listing={listing} /> : null}
      {step === 'review' && listing ? <ReviewStep listing={listing} /> : null}
    </Screen>
  );
}

// ------------------------------------------------------------------ Basics (M28)

function BasicsStep({
  draft,
  onChange,
}: {
  draft: BasicsDraft;
  onChange: (d: BasicsDraft) => void;
}) {
  const { t, locale } = useT();
  const set = <K extends keyof BasicsDraft>(k: K, v: BasicsDraft[K]) =>
    onChange({ ...draft, [k]: v });
  const vacant = draft.totalFlatmates - draft.currentFlatmates;
  return (
    <>
      <Card>
        <Field label={t('listing.editor.basics.titleLabel')} locale={locale}>
          <TextInput
            testID="listing-title"
            value={draft.title}
            onChangeText={(v) => set('title', v)}
            placeholder={t('listing.editor.basics.titlePlaceholder')}
            placeholderTextColor={theme.color.text.disabled}
            accessibilityLabel={t('listing.editor.basics.titleLabel')}
            maxLength={LISTING_LIMITS.titleMaxChars}
            style={[textStyle('bodyLg', locale), styles.input]}
          />
        </Field>
        <Field label={t('listing.editor.basics.descriptionLabel')} locale={locale}>
          <TextInput
            value={draft.description}
            onChangeText={(v) => set('description', v)}
            placeholder={t('listing.editor.basics.descriptionPlaceholder')}
            placeholderTextColor={theme.color.text.disabled}
            accessibilityLabel={t('listing.editor.basics.descriptionLabel')}
            multiline
            maxLength={LISTING_LIMITS.descriptionMaxChars}
            style={[textStyle('body', locale), styles.input, styles.multiline]}
          />
        </Field>
      </Card>
      <Card>
        <Text style={[textStyle('h3', locale), styles.primary]}>
          {t('listing.editor.basics.area')}
        </Text>
        <AreaPicker
          selected={draft.areaId === null ? [] : [draft.areaId]}
          onChange={(ids) => set('areaId', ids.length ? ids[ids.length - 1]! : null)}
        />
      </Card>
      <Card>
        <Text style={[textStyle('h3', locale), styles.primary]}>
          {t('listing.editor.basics.location')}
        </Text>
        <LocationSearch
          value={draft.location}
          label={
            draft.locationLabel ?? (draft.location ? t('listing.editor.basics.pinSaved') : null)
          }
          onChange={(location, label) => onChange({ ...draft, location, locationLabel: label })}
        />
        <Field label={t('listing.editor.basics.addressLabel')} locale={locale}>
          <TextInput
            value={draft.address}
            onChangeText={(v) => set('address', v)}
            accessibilityLabel={t('listing.editor.basics.addressLabel')}
            maxLength={LISTING_LIMITS.addressMaxChars}
            autoComplete="off"
            style={[textStyle('body', locale), styles.input]}
          />
          <Text style={[textStyle('caption', locale), styles.muted]}>
            {t('listing.editor.basics.addressHint')}
          </Text>
        </Field>
      </Card>
      <Card>
        <ChipGroup label={t('listing.editor.basics.bhk')} locale={locale}>
          {[1, 2, 3, 4, 5, 6].map((b) => (
            <ChoiceChip
              key={b}
              label={t('listing.editor.basics.bhkValue', { count: b })}
              selected={draft.bhk === b}
              onPress={() => set('bhk', b)}
              locale={locale}
            />
          ))}
        </ChipGroup>
        <ChipGroup label={t('listing.editor.basics.roomType')} locale={locale}>
          {(['private', 'shared'] as const).map((r) => (
            <ChoiceChip
              key={r}
              label={t(`listing.editor.basics.${r}`)}
              selected={draft.roomType === r}
              onPress={() => set('roomType', r)}
              locale={locale}
            />
          ))}
        </ChipGroup>
        <ChipGroup label={t('listing.editor.basics.furnishing')} locale={locale}>
          {(['unfurnished', 'semi_furnished', 'furnished'] as const).map((f) => (
            <ChoiceChip
              key={f}
              label={t(`listing.editor.basics.${f}`)}
              selected={draft.furnishing === f}
              onPress={() => set('furnishing', f)}
              locale={locale}
            />
          ))}
        </ChipGroup>
      </Card>
      <Card>
        <Text style={[textStyle('h3', locale), styles.primary]}>
          {t('listing.editor.basics.availableFrom')}
        </Text>
        <DatePicker
          value={draft.availableFrom}
          onChange={(d) => set('availableFrom', d)}
          label={t('listing.editor.basics.availableFrom')}
        />
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
          locale={locale}
        />
      </Card>
      <Card>
        <Stepper
          label={t('listing.editor.basics.total')}
          value={String(draft.totalFlatmates)}
          onMinus={() =>
            onChange({
              ...draft,
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
          locale={locale}
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
          locale={locale}
        />
        {vacant > 0 ? (
          <Text style={[textStyle('label', locale), styles.good]}>
            {t('listing.editor.basics.vacancy', { count: vacant })}
          </Text>
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
      <View style={styles.noBroker}>
        <ShieldCheck size={28} color={theme.color.text.primary} weight="fill" />
        <View style={{ flex: 1, gap: theme.space['1'] }}>
          <Text style={[textStyle('label', locale), styles.primary]}>
            {t('listing.editor.money.noBrokerTitle')}
          </Text>
          <Text style={[textStyle('caption', locale), styles.primary]}>
            {t('listing.editor.money.noBrokerBody')}
          </Text>
        </View>
      </View>
      <Card>
        <Amount
          testID="listing-rent"
          label={t('listing.editor.money.rent')}
          value={draft.rent}
          onChange={(v) => set('rent', v)}
          locale={locale}
        />
        <Amount
          testID="listing-deposit"
          label={t('listing.editor.money.deposit')}
          value={draft.deposit}
          onChange={(v) => set('deposit', v)}
          locale={locale}
        />
      </Card>
      <Card>
        <Text style={[textStyle('h3', locale), styles.primary]}>
          {t('listing.editor.money.recurringTitle')}
        </Text>
        {(['maintenance', 'electricity', 'wifi', 'help', 'other'] as const).map((k) => (
          <Amount
            key={k}
            label={t(`listing.editor.money.${k}`)}
            value={draft[k]}
            onChange={(v) => set(k, v)}
            locale={locale}
          />
        ))}
      </Card>
      <Card>
        <Text style={[textStyle('h3', locale), styles.primary]}>
          {t('listing.editor.money.oneTimeTitle')}
        </Text>
        {draft.oneTime.map((o, i) => (
          <View key={i} style={styles.oneTimeRow}>
            <TextInput
              value={o.label}
              onChangeText={(v) =>
                onChange({
                  ...draft,
                  oneTime: draft.oneTime.map((x, j) => (j === i ? { ...x, label: v } : x)),
                })
              }
              placeholder={t('listing.editor.money.oneTimeLabel')}
              placeholderTextColor={theme.color.text.disabled}
              accessibilityLabel={t('listing.editor.money.oneTimeLabel')}
              maxLength={40}
              style={[textStyle('body', locale), styles.input, { flex: 2 }]}
            />
            <TextInput
              value={o.amount}
              onChangeText={(v) =>
                onChange({
                  ...draft,
                  oneTime: draft.oneTime.map((x, j) =>
                    j === i ? { ...x, amount: wholeRupeesTyped(v) } : x,
                  ),
                })
              }
              placeholder="₹"
              placeholderTextColor={theme.color.text.disabled}
              accessibilityLabel={t('listing.editor.money.oneTimeAmount')}
              keyboardType="number-pad"
              maxLength={9}
              style={[textStyle('body', locale), styles.input, { flex: 1 }]}
            />
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('listing.editor.money.remove')}
              onPress={() =>
                onChange({ ...draft, oneTime: draft.oneTime.filter((_, j) => j !== i) })
              }
              style={styles.iconButton}
              hitSlop={4}
            >
              <X size={18} color={theme.color.text.primary} />
            </Pressable>
          </View>
        ))}
        {draft.oneTime.length < 10 ? (
          <SecondaryButton
            label={t('listing.editor.money.addOneTime')}
            onPress={() =>
              onChange({ ...draft, oneTime: [...draft.oneTime, { label: '', amount: '' }] })
            }
            locale={locale}
            trailingArrow={false}
            icon={<Plus size={18} color={theme.color.brand.primary} />}
          />
        ) : null}
      </Card>
      <View style={styles.total} accessibilityLiveRegion="polite">
        <Text style={[textStyle('label', locale), styles.onBrand]}>
          {t('listing.editor.money.totalTitle')}
        </Text>
        <Row
          label={t('listing.editor.money.totalRent')}
          value={rent !== null ? formatINR(rent, locale) : '–'}
          locale={locale}
        />
        <Row
          label={t('listing.editor.money.totalCosts')}
          value={recurring !== null ? formatINR(recurring, locale) : '–'}
          locale={locale}
        />
        <Text style={[textStyle('display', locale), styles.onBrand]}>
          {total !== null ? formatINR(total, locale) : '–'}
        </Text>
      </View>
    </>
  );
}

function Amount({
  label,
  value,
  onChange,
  locale,
  testID,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  locale: Locale;
  testID?: string;
}) {
  return (
    <View style={styles.amountRow}>
      <Text style={[textStyle('body', locale), styles.primary, { flex: 1 }]}>{label}</Text>
      <View style={styles.amountBox}>
        <Text style={[textStyle('body', locale), styles.muted]}>₹</Text>
        <TextInput
          testID={testID}
          value={value}
          onChangeText={(v) => onChange(wholeRupeesTyped(v))}
          accessibilityLabel={label}
          keyboardType="number-pad"
          maxLength={7}
          placeholder="0"
          placeholderTextColor={theme.color.text.disabled}
          style={[textStyle('bodyLg', locale), styles.amountInput]}
        />
      </View>
    </View>
  );
}

function Row({ label, value, locale }: { label: string; value: string; locale: Locale }) {
  return (
    <View style={styles.row}>
      <Text style={[textStyle('body', locale), styles.onBrand]}>{label}</Text>
      <Text style={[textStyle('label', locale), styles.onBrand]}>{value}</Text>
    </View>
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
  const { t, locale } = useT();
  const set = <K extends keyof ListingRules>(k: K, v: ListingRules[K]) =>
    onChange({ ...value, [k]: v });
  const icon = (I: typeof UsersThree) => <I size={22} color={theme.color.brand.primary} />;
  return (
    <>
      <Text style={[textStyle('body', locale), styles.muted]}>
        {t('listing.editor.rules.body')}
      </Text>
      <OptionCard
        icon={icon(UsersThree)}
        title={t('listing.editor.rules.bachelors')}
        subtitle={t('listing.editor.rules.bachelorsSub')}
        selected={value.bachelorsAllowed}
        onPress={() => set('bachelorsAllowed', !value.bachelorsAllowed)}
        locale={locale}
      />
      <OptionCard
        icon={icon(PawPrint)}
        title={t('listing.editor.rules.pets')}
        subtitle={t('listing.editor.rules.petsSub')}
        selected={value.petsAllowed}
        onPress={() => set('petsAllowed', !value.petsAllowed)}
        locale={locale}
      />
      <OptionCard
        icon={icon(CigaretteSlash)}
        title={t('listing.editor.rules.smoking')}
        subtitle={t('listing.editor.rules.smokingSub')}
        selected={value.smokingAllowed}
        onPress={() => set('smokingAllowed', !value.smokingAllowed)}
        locale={locale}
      />
      <Card>
        <ChipGroup label={t('listing.editor.rules.gender')} locale={locale}>
          {(
            [
              ['any', 'genderAny'],
              ['female_only', 'genderFemale'],
              ['male_only', 'genderMale'],
            ] as const
          ).map(([v, k]) => (
            <ChoiceChip
              key={v}
              label={t(`listing.editor.rules.${k}`)}
              selected={value.genderRule === v}
              onPress={() => set('genderRule', v)}
              locale={locale}
            />
          ))}
        </ChipGroup>
        <ChipGroup label={t('listing.editor.rules.food')} locale={locale}>
          {(
            [
              ['any', 'foodAny'],
              ['veg_only', 'foodVeg'],
              ['eggetarian_ok', 'foodEgg'],
            ] as const
          ).map(([v, k]) => (
            <ChoiceChip
              key={v}
              label={t(`listing.editor.rules.${k}`)}
              selected={value.foodRule === v}
              onPress={() => set('foodRule', v)}
              locale={locale}
            />
          ))}
        </ChipGroup>
        <ChipGroup label={t('listing.editor.rules.guests')} locale={locale}>
          {(
            [
              ['allowed', 'guestsAllowed'],
              ['day_only', 'guestsDay'],
              ['not_allowed', 'guestsNot'],
            ] as const
          ).map(([v, k]) => (
            <ChoiceChip
              key={v}
              label={t(`listing.editor.rules.${k}`)}
              selected={value.guestsRule === v}
              onPress={() => set('guestsRule', v)}
              locale={locale}
            />
          ))}
        </ChipGroup>
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
  onAdded: (listing: OwnerListing) => void;
  onChanged: () => void;
}) {
  const { t, locale } = useT();
  const [adding, setAdding] = useState(false);
  const [problem, setProblem] = useState<MessageKey | null>(null);
  const photos = listing.media
    .filter((m) => m.kind === 'photo')
    .sort((a, b) => a.position - b.position);
  const position = nextPhotoPosition(listing);

  const add = async () => {
    if (position === null || adding) return;
    setAdding(true);
    setProblem(null);
    const r = await pickAndAddPhoto(listing.id, position);
    setAdding(false);
    if (r.ok) onAdded(r.listing);
    else if ('error' in r) setProblem(r.error);
  };
  const remove = async (mediaId: string) => {
    const ok = await confirmAction({
      title: t('listing.editor.photos.removeTitle'),
      message: t('listing.editor.photos.removeBody'),
      confirmLabel: t('listing.editor.photos.removeConfirm'),
      cancelLabel: t('listing.myFlat.cancel'),
    });
    if (!ok) return;
    setProblem(null);
    const r = await deleteMedia(listing.id, mediaId);
    if (r.ok) onChanged();
    else setProblem(r.error);
  };

  return (
    <>
      <View style={styles.row}>
        <Text style={[textStyle('body', locale), styles.muted, { flex: 1 }]}>
          {t('listing.editor.photos.body')}
        </Text>
        <View style={styles.countChip}>
          <Text style={[textStyle('label', locale), styles.primary]}>
            {t('listing.editor.photos.count', { count: photos.length })}
          </Text>
        </View>
      </View>
      <View style={styles.grid}>
        {photos.map((p, i) => (
          <View key={p.id} style={styles.tile}>
            {p.url ? (
              <Image
                source={{ uri: p.url }}
                style={styles.tileImage}
                accessibilityLabel={t('listing.editor.photos.photoLabel', { number: i + 1 })}
              />
            ) : (
              <View style={[styles.tileImage, styles.noImage]} />
            )}
            {i === 0 ? (
              <View style={styles.coverBadge}>
                <Text style={[textStyle('caption', locale), styles.primary]}>
                  {t('listing.editor.photos.cover')}
                </Text>
              </View>
            ) : null}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('listing.editor.photos.removeNumbered', { number: i + 1 })}
              onPress={() => void remove(p.id)}
              style={styles.removeButton}
              hitSlop={6}
            >
              <X size={16} color={theme.color.text.primary} />
            </Pressable>
          </View>
        ))}
        {position !== null ? (
          <Pressable
            testID="listing-add-photo"
            accessibilityRole="button"
            accessibilityLabel={t('listing.editor.photos.add')}
            accessibilityState={{ busy: adding }}
            disabled={adding}
            onPress={() => void add()}
            style={[styles.tile, styles.addTile]}
          >
            {adding ? (
              <ActivityIndicator color={theme.color.brand.primary} />
            ) : (
              <Plus size={28} color={theme.color.brand.primary} />
            )}
            <Text style={[textStyle('caption', locale), styles.brand]}>
              {adding ? t('listing.editor.photos.uploading') : t('listing.editor.photos.add')}
            </Text>
          </Pressable>
        ) : null}
      </View>
      {problem ? <Notice tone="error" locale={locale} message={t(problem)} /> : null}
      <Text style={[textStyle('caption', locale), styles.muted]}>
        {t('listing.editor.photos.tip')}
      </Text>
    </>
  );
}

// ------------------------------------------------------------------ Video (M32)

function VideoStep({ listing }: { listing: OwnerListing }) {
  const { t, locale } = useT();
  const video = listing.media.find((m) => m.kind === 'walkthrough_video');
  if (Platform.OS === 'web')
    return (
      <Card>
        <Text style={[textStyle('h3', locale), styles.primary]}>
          {t('listing.editor.video.webTitle')}
        </Text>
        <Text style={[textStyle('body', locale), styles.muted]}>
          {t('listing.editor.video.webBody')}
        </Text>
      </Card>
    );
  return (
    <Card>
      <Text style={[textStyle('body', locale), styles.muted]}>
        {t('listing.editor.video.body')}
      </Text>
      {video ? (
        <View style={styles.row}>
          <Check size={20} color={theme.semantic.status.verified.fg} weight="bold" />
          <Text style={[textStyle('label', locale), styles.primary, { flex: 1 }]}>
            {t('listing.editor.video.recorded', { seconds: video.durationS ?? 0 })}
          </Text>
        </View>
      ) : null}
      <PrimaryButton
        testID="listing-record-video"
        label={video ? t('listing.editor.video.rerecord') : t('listing.editor.video.record')}
        onPress={() => router.push(`/listings/${listing.id}/video`)}
        locale={locale}
        icon={<VideoCamera size={22} color={theme.semantic.action.primary.fg} weight="fill" />}
      />
    </Card>
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
        listing.trueMonthlyPerPersonInr !== null
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
        : t('listing.editor.review.missing'),
      ok: done.video,
    },
    {
      key: 'verification',
      label: t('listing.editor.review.verification'),
      detail: verified
        ? t('listing.editor.review.verified')
        : t('listing.editor.review.verifyBody'),
      ok: verified,
    },
  ];
  return (
    <>
      <Card>
        <Text style={[textStyle('h3', locale), styles.primary]}>{listing.title}</Text>
        {listing.trueMonthlyPerPersonInr !== null ? (
          <Text style={[textStyle('bodyLg', locale), styles.brand]}>
            {t('listing.editor.review.allIn', {
              amount: formatINR(listing.trueMonthlyPerPersonInr, locale),
            })}
          </Text>
        ) : null}
      </Card>
      <Card>
        <Text style={[textStyle('h3', locale), styles.primary]}>
          {t('listing.editor.review.checklist')}
        </Text>
        {items.map((item) => (
          <View key={item.key} style={styles.checkRow}>
            {item.ok ? (
              <Check size={22} color={theme.semantic.status.verified.fg} weight="bold" />
            ) : (
              <WarningCircle size={22} color={theme.semantic.status.error.fg} weight="fill" />
            )}
            <View style={{ flex: 1 }}>
              <Text style={[textStyle('label', locale), styles.primary]}>{item.label}</Text>
              <Text style={[textStyle('caption', locale), styles.muted]}>{item.detail}</Text>
            </View>
          </View>
        ))}
        {!verified ? (
          <SecondaryButton
            label={t('listing.editor.review.verifyAction')}
            onPress={() => router.push('/profile/verify')}
            locale={locale}
          />
        ) : null}
      </Card>
      {listing.status === 'draft' ? (
        <Text style={[textStyle('caption', locale), styles.muted, styles.center]}>
          {t('listing.editor.review.note')}
        </Text>
      ) : null}
    </>
  );
}

// ------------------------------------------------------------------ pieces

function Card({ children }: { children: ReactNode }) {
  return <View style={styles.card}>{children}</View>;
}

function Field({
  label,
  locale,
  children,
}: {
  label: string;
  locale: Locale;
  children: ReactNode;
}) {
  return (
    <View style={{ gap: theme.space['2'] }}>
      <Text style={[textStyle('label', locale), styles.primary]}>{label}</Text>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  titles: { gap: theme.space['2'] },
  centered: { alignItems: 'center', marginTop: theme.space['8'] },
  center: { textAlign: 'center' },
  primary: { color: theme.color.text.primary },
  muted: { color: theme.color.text.secondary },
  brand: { color: theme.color.brand.primary },
  good: { color: theme.semantic.status.verified.fg },
  onBrand: { color: theme.semantic.action.primary.fg },
  card: {
    backgroundColor: theme.color.bg.surface,
    borderRadius: theme.radius.lg,
    padding: theme.layout.cardPadding,
    gap: theme.space['3'],
    ...theme.elevation['1'],
  },
  input: {
    minHeight: 52,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.color.border.default,
    paddingHorizontal: theme.space['3'],
    backgroundColor: theme.color.bg.app,
    color: theme.color.text.primary,
  },
  multiline: { minHeight: 110, paddingTop: theme.space['3'], textAlignVertical: 'top' },
  footerRow: { flexDirection: 'row', gap: theme.space['3'] },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: theme.space['2'],
  },
  noBroker: {
    flexDirection: 'row',
    gap: theme.space['3'],
    alignItems: 'center',
    padding: theme.layout.cardPadding,
    borderRadius: theme.radius.lg,
    backgroundColor: theme.semantic.status.verified.bg,
  },
  amountRow: { flexDirection: 'row', alignItems: 'center', gap: theme.space['3'] },
  amountBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.space['1'],
    minWidth: 128,
    minHeight: 52,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.color.border.default,
    paddingHorizontal: theme.space['3'],
    backgroundColor: theme.color.bg.app,
  },
  amountInput: { flex: 1, color: theme.color.text.primary, textAlign: 'right', minHeight: 48 },
  oneTimeRow: { flexDirection: 'row', gap: theme.space['2'], alignItems: 'center' },
  iconButton: {
    width: theme.size.touchMin,
    height: theme.size.touchMin,
    borderRadius: theme.radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.color.bg.app,
  },
  total: {
    gap: theme.space['2'],
    padding: theme.layout.cardPadding,
    borderRadius: theme.radius.lg,
    backgroundColor: theme.color.brand.primary,
  },
  countChip: {
    paddingHorizontal: theme.space['3'],
    paddingVertical: theme.space['1'],
    borderRadius: theme.radius.full,
    backgroundColor: theme.semantic.status.verified.bg,
  },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.space['3'] },
  tile: { width: '30%', aspectRatio: 1, borderRadius: theme.radius.md, overflow: 'hidden' },
  tileImage: { width: '100%', height: '100%' },
  noImage: { backgroundColor: theme.color.brand.primarySubtle },
  coverBadge: {
    position: 'absolute',
    left: theme.space['1'],
    bottom: theme.space['1'],
    paddingHorizontal: theme.space['2'],
    paddingVertical: 2,
    borderRadius: theme.radius.full,
    backgroundColor: theme.semantic.status.verified.bg,
  },
  removeButton: {
    position: 'absolute',
    top: theme.space['1'],
    right: theme.space['1'],
    width: theme.size.touchMin,
    height: theme.size.touchMin,
    borderRadius: theme.radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.color.bg.surface,
  },
  addTile: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: theme.space['1'],
    borderWidth: 2,
    borderStyle: 'dashed',
    borderColor: theme.color.brand.lavender,
    backgroundColor: theme.color.brand.primarySubtle,
  },
  checkRow: { flexDirection: 'row', gap: theme.space['3'], alignItems: 'flex-start' },
});
