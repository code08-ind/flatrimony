import { useState } from 'react';
import { Text } from 'react-native';
import type { Lifestyle } from '@flatrimony/shared';
import { useMe } from '../../../src/me';
import { habitsComplete, type HabitAnswers } from '../../../src/onboarding/logic';
import { EditScreen } from '../../../src/profile/EditScreen';
import { sameAnswers } from '../../../src/profile/logic';
import { useProfileSave } from '../../../src/profile/save';
import { textStyle, theme } from '../../../src/theme';
import { useT } from '../../../src/useT';
import { HabitPicker } from '../../../src/ui/biodata/HabitPicker';
import { ChipGroup, ChoiceChip } from '../../../src/ui/onboarding';

const FREQUENCY = ['never', 'rarely', 'sometimes', 'often'] as const;
const WORK_MODES = ['office', 'hybrid', 'wfh', 'night_shift', 'student'] as const;
type Optional = Pick<Lifestyle, 'cooksAtHome' | 'drinking' | 'guests' | 'parties' | 'workMode'>;

/**
 * Habits: the six core answers plus the optional ones (FR-BIO-04, P1: cooking at home, drinking,
 * guests, parties, work mode). PUT /me/lifestyle replaces all; tapping a chosen optional answer
 * again clears it.
 */
export default function EditHabits() {
  const { t, locale } = useT();
  const { me } = useMe();
  const saving = useProfileSave();
  const l = me?.lifestyle;
  const [core, setCore] = useState<HabitAnswers>({
    bedtime: l?.bedtime,
    wakeTime: l?.wakeTime,
    cleaning: l?.cleaning,
    smoking: l?.smoking,
    pets: l?.pets,
    food: l?.food,
  });
  const [extra, setExtra] = useState<Optional>({
    cooksAtHome: l?.cooksAtHome,
    drinking: l?.drinking,
    guests: l?.guests,
    parties: l?.parties,
    workMode: l?.workMode,
  });
  if (!me) return null;
  const answers = { ...core, ...extra };
  const dirty = !me.lifestyle || !sameAnswers(answers, me.lifestyle);

  const toggle = <K extends keyof Optional>(key: K, value: Optional[K]) =>
    setExtra((cur) => ({ ...cur, [key]: cur[key] === value ? undefined : value }));
  const frequencyRow = (key: 'drinking' | 'guests' | 'parties') => (
    <ChipGroup label={t(`profile.habitsMore.${key}`)} locale={locale}>
      {FREQUENCY.map((f) => (
        <ChoiceChip
          key={f}
          label={t(`profile.habitsMore.${f}`)}
          selected={extra[key] === f}
          onPress={() => toggle(key, f)}
          locale={locale}
        />
      ))}
    </ChipGroup>
  );

  return (
    <EditScreen
      title={t('profile.editor.habits')}
      busy={saving.busy}
      error={saving.error}
      dirty={dirty}
      saved={saving.saved}
      canSave={habitsComplete(core)}
      onSave={() => {
        if (!habitsComplete(core)) return;
        const body: Lifestyle = {
          ...core,
          ...Object.fromEntries(Object.entries(extra).filter(([, v]) => v !== undefined)),
        };
        void saving.save('/me/lifestyle', 'PUT', body);
      }}
    >
      <HabitPicker value={core} onChange={setCore} />
      <Text
        style={[textStyle('h2', locale), { color: theme.color.text.primary }]}
        accessibilityRole="header"
      >
        {t('profile.habitsMore.title')}
      </Text>
      <ChipGroup label={t('profile.habitsMore.cooksAtHome')} locale={locale}>
        {([true, false] as const).map((v) => (
          <ChoiceChip
            key={String(v)}
            label={t(v ? 'profile.habitsMore.yes' : 'profile.habitsMore.no')}
            selected={extra.cooksAtHome === v}
            onPress={() => toggle('cooksAtHome', v)}
            locale={locale}
          />
        ))}
      </ChipGroup>
      {frequencyRow('drinking')}
      {frequencyRow('guests')}
      {frequencyRow('parties')}
      <ChipGroup label={t('profile.habitsMore.workMode')} locale={locale}>
        {WORK_MODES.map((m) => (
          <ChoiceChip
            key={m}
            label={t(`profile.habitsMore.${m}`)}
            selected={extra.workMode === m}
            onPress={() => toggle('workMode', m)}
            locale={locale}
          />
        ))}
      </ChipGroup>
    </EditScreen>
  );
}
