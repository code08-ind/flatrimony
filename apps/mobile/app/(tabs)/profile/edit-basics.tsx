import { useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import { humanText, LIMITS, MePatch } from '@flatrimony/shared';
import { useMe } from '../../../src/me';
import { EditScreen } from '../../../src/profile/EditScreen';
import { LANGUAGE_CODES, languageName, sameSet, toggleLanguage } from '../../../src/profile/logic';
import { useProfileSave } from '../../../src/profile/save';
import { textStyle, theme } from '../../../src/theme';
import { useT } from '../../../src/useT';
import { Notice } from '../../../src/ui/Notice';
import { ChoiceChip, onboardingStyles } from '../../../src/ui/onboarding';

const NAME = humanText(LIMITS.displayNameMaxChars);
const BIO = MePatch.shape.bio;

/** Basics: first name, bio and languages (FR-BIO-01; PATCH /me). Date of birth is not editable. */
export default function EditBasics() {
  const { t, locale } = useT();
  const { me } = useMe();
  const saving = useProfileSave();
  const [name, setName] = useState(me?.displayName ?? '');
  const [bio, setBio] = useState(me?.bio ?? '');
  const [languages, setLanguages] = useState<string[]>(me?.languages ?? []);
  const [atMax, setAtMax] = useState(false);
  if (!me) return null;

  const nameOk = NAME.safeParse(name).success;
  const bioValue = bio.trim() === '' ? null : bio;
  const bioOk = BIO.safeParse(bioValue).success;
  const dirty =
    name !== me.displayName || bioValue !== (me.bio ?? null) || !sameSet(languages, me.languages);
  // Saved languages the editor does not list stay visible, so they can be removed.
  const shown = [
    ...LANGUAGE_CODES,
    ...me.languages.filter((c) => !LANGUAGE_CODES.includes(c as never)),
  ];
  const toggle = (code: string) => {
    const next = toggleLanguage(languages, code);
    setAtMax(next === null);
    if (next) setLanguages(next);
  };

  return (
    <EditScreen
      title={t('profile.basics.title')}
      busy={saving.busy}
      error={saving.error}
      dirty={dirty}
      saved={saving.saved}
      canSave={nameOk && bioOk && languages.length <= LIMITS.languagesMax}
      onSave={() =>
        void saving.save('/me', 'PATCH', {
          displayName: NAME.parse(name),
          bio: bioValue,
          languages,
        })
      }
    >
      <View style={onboardingStyles.card}>
        <Text style={[textStyle('label', locale), styles.label]}>
          {t('profile.basics.nameLabel')}
        </Text>
        <TextInput
          value={name}
          onChangeText={setName}
          accessibilityLabel={t('profile.basics.nameLabel')}
          autoComplete="given-name"
          maxLength={LIMITS.displayNameMaxChars}
          style={[textStyle('bodyLg', locale), styles.input]}
        />
        {!nameOk && (
          <Notice
            tone="error"
            locale={locale}
            message={t(
              name.trim() === '' ? 'profile.basics.nameRequired' : 'onboarding.about.nameInvalid',
            )}
          />
        )}
        <Text style={[textStyle('caption', locale), styles.label]}>
          {t('profile.basics.dobNote')}
        </Text>
      </View>

      <View style={onboardingStyles.card}>
        <Text style={[textStyle('label', locale), styles.label]}>
          {t('profile.basics.bioLabel')}
        </Text>
        <TextInput
          value={bio}
          onChangeText={setBio}
          accessibilityLabel={t('profile.basics.bioLabel')}
          placeholder={t('profile.basics.bioPlaceholder')}
          placeholderTextColor={theme.color.text.disabled}
          multiline
          maxLength={LIMITS.bioMaxChars + 100}
          style={[textStyle('body', locale), styles.input, styles.bio]}
        />
        <Text
          style={[
            textStyle('caption', locale),
            { color: bioOk ? theme.color.text.secondary : theme.color.danger, textAlign: 'right' },
          ]}
          accessibilityLiveRegion="polite"
        >
          {t('profile.basics.bioCount', {
            count: [...bio.trim()].length,
            max: LIMITS.bioMaxChars,
          })}
        </Text>
      </View>

      <View style={onboardingStyles.card}>
        <Text style={[textStyle('label', locale), styles.label]}>
          {t('profile.basics.languages')}
        </Text>
        <View style={onboardingStyles.chipWrap}>
          {shown.map((code) => (
            <ChoiceChip
              key={code}
              multiple
              label={languageName(t, code)}
              selected={languages.includes(code)}
              onPress={() => toggle(code)}
              locale={locale}
            />
          ))}
        </View>
        {atMax && (
          <Notice
            tone="info"
            locale={locale}
            message={t('profile.basics.languagesMax', { max: LIMITS.languagesMax })}
          />
        )}
      </View>
    </EditScreen>
  );
}

const styles = StyleSheet.create({
  label: { color: theme.color.text.secondary },
  input: {
    minHeight: 52,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.color.border.default,
    paddingHorizontal: theme.space['4'],
    color: theme.color.text.primary,
    backgroundColor: theme.color.bg.app,
  },
  bio: { minHeight: 120, paddingTop: theme.space['3'], textAlignVertical: 'top' },
});
