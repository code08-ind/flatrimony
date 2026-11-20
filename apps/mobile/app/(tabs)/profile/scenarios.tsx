import { useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { useMe } from '../../../src/me';
import { EditScreen } from '../../../src/profile/EditScreen';
import { useReference } from '../../../src/profile/reference';
import { useProfileSave } from '../../../src/profile/save';
import { theme } from '../../../src/theme';
import { useT } from '../../../src/useT';
import { SecondaryButton } from '../../../src/ui/buttons';
import { Notice } from '../../../src/ui/Notice';
import { ChipGroup, ChoiceChip } from '../../../src/ui/onboarding';

/**
 * Scenario questions (FR-BIO-06; design M36): one card per question with its options. Saves the
 * answered ones (PUT /me/scenario-answers upserts; nothing is unanswered by saving).
 */
export default function Scenarios() {
  const { t, locale } = useT();
  const { me } = useMe();
  const saving = useProfileSave();
  const reference = useReference(locale);
  const [answers, setAnswers] = useState<Record<string, string>>(
    Object.fromEntries((me?.scenarioAnswers ?? []).map((a) => [a.questionId, a.optionId])),
  );
  if (!me) return null;
  const questions = reference.data?.scenarioQuestions ?? [];
  const changed = Object.entries(answers).filter(
    ([q, o]) => !me.scenarioAnswers?.some((a) => a.questionId === q && a.optionId === o),
  );

  return (
    <EditScreen
      title={t('profile.scenarios.title')}
      subtitle={t('profile.scenarios.subtitle')}
      busy={saving.busy}
      error={saving.error}
      dirty={changed.length > 0}
      saved={saving.saved}
      onSave={() =>
        void saving.save(
          '/me/scenario-answers',
          'PUT',
          changed.map(([questionId, optionId]) => ({ questionId, optionId })),
        )
      }
    >
      {!reference.data && !reference.failed && (
        <ActivityIndicator
          color={theme.color.brand.primary}
          accessibilityLabel={t('profile.scenarios.title')}
        />
      )}
      {reference.failed && (
        <View style={{ gap: theme.space['3'] }}>
          <Notice tone="error" locale={locale} message={t('profile.scenarios.loadFailed')} />
          <SecondaryButton
            locale={locale}
            label={t('profile.scenarios.retry')}
            trailingArrow={false}
            onPress={() => void reference.retry()}
          />
        </View>
      )}
      {questions.map((q) => (
        <ChipGroup key={q.id} label={q.prompt} locale={locale}>
          {q.options.map((o) => (
            <ChoiceChip
              key={o.id}
              label={o.label}
              selected={answers[q.id] === o.id}
              onPress={() => setAnswers((a) => ({ ...a, [q.id]: o.id }))}
              locale={locale}
            />
          ))}
        </ChipGroup>
      ))}
    </EditScreen>
  );
}
