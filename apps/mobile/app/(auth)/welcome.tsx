import { StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import {
  Bed,
  Globe,
  House,
  Lightning,
  MapPin,
  ShieldCheck,
  Translate,
  UsersThree,
} from '../../src/ui/icons';
import type { Locale } from '@flatrimony/i18n';
import { legalUrl } from '../../src/config';
import { setAppLocale } from '../../src/i18n';
import { textStyle, theme } from '../../src/theme';
import { useT } from '../../src/useT';
import { PrimaryButton, SecondaryButton } from '../../src/ui/buttons';
import { Chip } from '../../src/ui/Chip';
import { LegalConsent } from '../../src/ui/LegalConsent';
import { Logo } from '../../src/ui/Logo';
import { Screen } from '../../src/ui/Screen';

/** M01 Welcome + language (FR-AUTH-05, FR-AUTH-07). */
export default function Welcome() {
  const { t, raw, locale } = useT();

  const choose = async (next: Locale) => {
    await setAppLocale(next);
    router.push('/phone');
  };

  return (
    <Screen>
      <View style={styles.header}>
        <Logo size={44} />
        <View style={styles.tagline}>
          <UsersThree size={20} color={theme.color.brand.primary} />
          <Text style={[textStyle('bodyLg', locale), styles.taglineText]}>{t('app.tagline')}</Text>
        </View>
      </View>

      <View style={styles.tiles}>
        <View style={[styles.tile, styles.tilePrimary]}>
          <View style={[styles.tileIcon, { backgroundColor: theme.glass.dark.border }]}>
            <House size={26} color={theme.color.accent.lime} weight="duotone" />
          </View>
          <Text style={[textStyle('h2', locale), { color: theme.color.white }]}>
            {t('welcome.verifiedPeople')}
          </Text>
          <Text style={[textStyle('body', locale), { color: theme.color.brand.primarySubtle }]}>
            {t('welcome.profilesChecked')}
          </Text>
        </View>
        <View style={[styles.tile, styles.tileLavender]}>
          <View style={[styles.tileIcon, { backgroundColor: theme.color.bg.surface }]}>
            <Bed size={26} color={theme.color.brand.primary} weight="duotone" />
          </View>
          <Text style={[textStyle('h2', locale), { color: theme.color.text.primary }]}>
            {t('welcome.realRooms')}
          </Text>
          <Text style={[textStyle('body', locale), { color: theme.color.text.secondary }]}>
            {t('welcome.equalSplit')}
          </Text>
        </View>
      </View>

      <View style={styles.claim}>
        <Text style={[textStyle('display', locale), styles.center]} accessibilityRole="header">
          {t('app.notDating')}
        </Text>
        <Text
          style={[
            textStyle('bodyLg', locale),
            styles.center,
            { color: theme.color.text.secondary },
          ]}
        >
          {t('app.promise')}
        </Text>
      </View>

      <View style={styles.chips}>
        <Chip
          locale={locale}
          label={t('welcome.chipDigilocker')}
          icon={<ShieldCheck size={18} color={theme.color.brand.primary} />}
        />
        <Chip
          locale={locale}
          tone="lime"
          label={t('welcome.chipMatch')}
          icon={<Lightning size={18} color={theme.color.text.primary} />}
        />
        <Chip
          locale={locale}
          label={t('welcome.chipAreas')}
          icon={<MapPin size={18} color={theme.color.brand.primary} />}
        />
      </View>

      <View style={styles.language}>
        <Text style={[textStyle('micro', locale), styles.overline]}>
          {t('welcome.chooseLanguage')}
        </Text>
        <PrimaryButton
          testID="continue-en"
          locale="en"
          label={t('language.continueEnglish')}
          icon={<Translate size={22} color={theme.semantic.action.primary.fg} />}
          onPress={() => void choose('en')}
        />
        <SecondaryButton
          testID="continue-hi"
          locale="hi"
          label={t('language.continueHindi')}
          icon={<Globe size={22} color={theme.color.brand.primary} />}
          onPress={() => void choose('hi')}
        />
      </View>

      <LegalConsent
        text={raw('legal.consent')}
        locale={locale}
        termsUrl={legalUrl('terms', locale)}
        privacyUrl={legalUrl('privacy', locale)}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { alignItems: 'center', gap: theme.space['3'] },
  tagline: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.space['2'],
    backgroundColor: theme.color.brand.primarySubtle,
    borderRadius: theme.radius.full,
    paddingHorizontal: theme.space['4'],
    paddingVertical: theme.space['2'],
  },
  taglineText: { color: theme.color.text.secondary },
  tiles: { flexDirection: 'row', gap: theme.space['3'] },
  tile: {
    flex: 1,
    borderRadius: theme.radius.lg,
    padding: theme.layout.cardPadding,
    gap: theme.space['2'],
    minHeight: 170,
    justifyContent: 'flex-end',
  },
  tilePrimary: { backgroundColor: theme.semantic.tile.bentoPrimary },
  tileLavender: { backgroundColor: theme.color.brand.primarySubtle },
  tileIcon: {
    width: 44,
    height: 44,
    borderRadius: theme.radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 'auto',
  },
  claim: { gap: theme.space['2'] },
  center: { textAlign: 'center' },
  chips: { gap: theme.space['2'] },
  language: { gap: theme.space['3'] },
  overline: { color: theme.color.text.secondary, textAlign: 'center', textTransform: 'uppercase' },
});
