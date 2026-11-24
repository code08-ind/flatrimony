import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import type { Intent } from '@flatrimony/shared';
import { useMe } from '../../src/me';
import { updateDraft, useDraft } from '../../src/onboarding/draft';
import { stepNumber } from '@flatrimony/client';
import { useGoOnce } from '../../src/onboarding/nav';
import { textStyle, theme } from '../../src/theme';
import { useT } from '../../src/useT';
import { PrimaryButton } from '../../src/ui/buttons';
import { Bed, Key, LockSimple, UsersThree } from '../../src/ui/icons';
import { OptionCard, StepHeader } from '../../src/ui/onboarding';
import { Screen } from '../../src/ui/Screen';

const OPTIONS = [
  {
    value: 'have_room',
    Icon: Key,
    title: 'onboarding.intent.haveRoom',
    sub: 'onboarding.intent.haveRoomSub',
  },
  {
    value: 'need_room',
    Icon: Bed,
    title: 'onboarding.intent.needRoom',
    sub: 'onboarding.intent.needRoomSub',
  },
  {
    value: 'pair_up',
    Icon: UsersThree,
    title: 'onboarding.intent.pairUp',
    sub: 'onboarding.intent.pairUpSub',
  },
] as const;

/** M04 Step 1: intent (FR-AUTH-06). Saved with the category (bootstrap or PATCH /me). */
export default function IntentScreen() {
  const { t, locale } = useT();
  const draft = useDraft();
  const { me } = useMe();
  const [intent, setIntent] = useState<Intent | undefined>(draft.intent ?? me?.intent);
  const step = stepNumber('intent');
  const go = useGoOnce();

  return (
    <Screen
      footer={
        <>
          <View style={styles.footerNote}>
            <LockSimple size={18} color={theme.color.brand.primary} />
            <Text style={[textStyle('caption', locale), styles.footerText]}>
              {t('onboarding.intent.footer')}
            </Text>
          </View>
          <PrimaryButton
            testID="continue"
            locale={locale}
            label={t('onboarding.continue')}
            disabled={!intent}
            onPress={() => {
              updateDraft({ intent });
              go('/onboarding/category');
            }}
          />
        </>
      }
    >
      <StepHeader
        step={step}
        stepLabel={t('onboarding.stepOf', { n: step })}
        overline={`${t('onboarding.stepOf', { n: step })} · ${t('onboarding.intent.overline')}`}
        title={t('onboarding.intent.title')}
        subtitle={t('onboarding.intent.subtitle')}
        onBack={() => (router.canGoBack() ? router.back() : router.replace('/onboarding/about'))}
        backLabel={t('common.back')}
        locale={locale}
      />
      <View style={styles.list} accessibilityRole="radiogroup">
        {OPTIONS.map(({ value, Icon, title, sub }) => (
          <OptionCard
            key={value}
            icon={
              <Icon
                size={26}
                color={intent === value ? theme.color.text.primary : theme.color.brand.primary}
              />
            }
            title={t(title)}
            subtitle={t(sub)}
            selected={intent === value}
            onPress={() => setIntent(value)}
            locale={locale}
          />
        ))}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  list: { gap: theme.space['3'] },
  footerNote: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: theme.space['2'],
  },
  footerText: { color: theme.color.text.secondary, flexShrink: 1 },
});
