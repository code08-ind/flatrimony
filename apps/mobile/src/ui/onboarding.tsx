/**
 * Building blocks of the onboarding screens (docs/06 §8.3; designs M04–M09): step header with a
 * 6-segment progress bar, large option cards, selectable chips and a −/+ stepper.
 */
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { Locale } from '@flatrimony/i18n';
import { textStyle, theme } from '../theme';
import { BackButton } from './buttons';
import { Check, Minus, Plus } from './icons';

export function StepHeader({
  step,
  total = 6,
  stepLabel,
  overline,
  title,
  subtitle,
  onBack,
  backLabel,
  locale,
}: {
  /** 1-based; omit for the uncounted "About you" screen. */
  step?: number;
  total?: number;
  stepLabel?: string;
  overline: string;
  title: string;
  subtitle?: string;
  onBack?: () => void;
  backLabel: string;
  locale: Locale;
}) {
  return (
    <View style={styles.header}>
      <View style={styles.topRow}>
        {onBack ? <BackButton label={backLabel} onPress={onBack} /> : <View />}
        {step !== undefined && (
          <View
            style={styles.progressWrap}
            accessible
            accessibilityRole="progressbar"
            accessibilityLabel={stepLabel}
            accessibilityValue={{ min: 0, max: total, now: step }}
          >
            <View style={styles.progress}>
              {Array.from({ length: total }, (_, i) => (
                <View key={i} style={[styles.segment, i < step && styles.segmentDone]} />
              ))}
            </View>
            {stepLabel ? (
              <Text style={[textStyle('caption', locale), styles.stepLabel]}>{stepLabel}</Text>
            ) : null}
          </View>
        )}
      </View>
      {/* The progress bar already announces the step; the pill is visual only. */}
      <View
        style={styles.pill}
        importantForAccessibility={step !== undefined ? 'no-hide-descendants' : 'auto'}
        accessibilityElementsHidden={step !== undefined}
      >
        <Text style={[textStyle('label', locale), styles.pillText]}>{overline}</Text>
      </View>
      <Text style={textStyle('display', locale)} accessibilityRole="header">
        {title}
      </Text>
      {subtitle ? (
        <Text style={[textStyle('body', locale), { color: theme.color.text.secondary }]}>
          {subtitle}
        </Text>
      ) : null}
    </View>
  );
}

/** Big tappable option with icon, title and subtitle (radio semantics). */
export function OptionCard({
  icon,
  title,
  subtitle,
  selected,
  onPress,
  locale,
  compact,
}: {
  icon: ReactNode;
  title: string;
  subtitle?: string;
  selected: boolean;
  onPress: () => void;
  locale: Locale;
  /** Grid tile (category step) instead of a full-width row. */
  compact?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ checked: selected }}
      aria-checked={selected}
      accessibilityLabel={subtitle ? `${title}. ${subtitle}` : title}
      onPress={onPress}
      style={({ pressed }) => [
        styles.card,
        compact && styles.cardCompact,
        selected && styles.cardSelected,
        pressed && !selected && { backgroundColor: theme.color.brand.primarySubtle },
      ]}
    >
      <View style={[styles.iconCircle, selected && styles.iconCircleSelected]}>{icon}</View>
      <View style={compact ? undefined : styles.cardText}>
        <Text style={[textStyle('h3', locale), { color: theme.color.text.primary }]}>{title}</Text>
        {subtitle ? (
          <Text style={[textStyle('body', locale), { color: theme.color.text.secondary }]}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {!compact && (
        <View style={[styles.radio, selected && styles.radioSelected]}>
          {selected && <Check size={16} color={theme.color.white} weight="bold" />}
        </View>
      )}
      {compact && selected && (
        <View style={[styles.radio, styles.radioSelected, styles.radioCorner]}>
          <Check size={16} color={theme.color.white} weight="bold" />
        </View>
      )}
    </Pressable>
  );
}

/** Selectable pill (lime with a tick when selected, docs/06 §3.1). */
export function ChoiceChip({
  label,
  selected,
  onPress,
  locale,
  icon,
  multiple,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
  locale: Locale;
  icon?: ReactNode;
  /** Part of a multi-select (checkbox semantics) rather than a single choice. */
  multiple?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole={multiple ? 'checkbox' : 'radio'}
      accessibilityState={{ checked: selected }}
      aria-checked={selected}
      accessibilityLabel={label}
      onPress={onPress}
      hitSlop={4}
      style={({ pressed }) => [
        styles.chip,
        selected && styles.chipSelected,
        pressed && !selected && { backgroundColor: theme.color.brand.primarySubtle },
      ]}
    >
      {icon}
      <Text style={[textStyle('label', locale), { color: theme.color.text.primary }]}>{label}</Text>
      {selected && <Check size={16} color={theme.color.text.primary} weight="bold" />}
    </Pressable>
  );
}

/** A labelled radio group of chips (one row of the habits screen). */
export function ChipGroup({
  label,
  icon,
  children,
  locale,
}: {
  label: string;
  icon?: ReactNode;
  children: ReactNode;
  locale: Locale;
}) {
  return (
    <View style={styles.group} accessibilityRole="radiogroup" accessibilityLabel={label}>
      <View style={styles.groupHead}>
        {icon ? <View style={styles.groupIcon}>{icon}</View> : null}
        <Text style={[textStyle('h3', locale), { color: theme.color.text.primary }]}>{label}</Text>
      </View>
      <View style={styles.chipWrap}>{children}</View>
    </View>
  );
}

export function Stepper({
  label,
  value,
  onMinus,
  onPlus,
  minusLabel,
  plusLabel,
  canMinus,
  canPlus,
  locale,
}: {
  label: string;
  value: string;
  onMinus: () => void;
  onPlus: () => void;
  minusLabel: string;
  plusLabel: string;
  canMinus: boolean;
  canPlus: boolean;
  locale: Locale;
}) {
  return (
    <View style={styles.stepper}>
      <Text style={[textStyle('label', locale), styles.stepperLabel]}>{label}</Text>
      <View style={styles.stepperRow}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={minusLabel}
          accessibilityState={{ disabled: !canMinus }}
          disabled={!canMinus}
          onPress={onMinus}
          style={[styles.stepBtn, !canMinus && styles.stepBtnOff]}
        >
          <Minus size={20} color={theme.color.text.primary} />
        </Pressable>
        <Text style={[textStyle('h3', locale), styles.stepValue]} accessibilityLiveRegion="polite">
          {value}
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={plusLabel}
          accessibilityState={{ disabled: !canPlus }}
          disabled={!canPlus}
          onPress={onPlus}
          style={[styles.stepBtn, styles.stepBtnPlus, !canPlus && styles.stepBtnOff]}
        >
          <Plus size={20} color={theme.color.white} />
        </Pressable>
      </View>
    </View>
  );
}

export const onboardingStyles = StyleSheet.create({
  card: {
    backgroundColor: theme.color.bg.surface,
    borderRadius: theme.radius.lg,
    padding: theme.layout.cardPadding,
    gap: theme.space['3'],
    ...theme.elevation['1'],
  },
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.space['2'] },
});

const styles = StyleSheet.create({
  header: { gap: theme.space['3'] },
  topRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  progressWrap: { alignItems: 'flex-end', gap: theme.space['2'] },
  progress: { flexDirection: 'row', gap: theme.space['1'] },
  segment: {
    width: 26,
    height: 6,
    borderRadius: theme.radius.full,
    backgroundColor: theme.color.brand.primarySubtle,
  },
  segmentDone: { backgroundColor: theme.color.brand.primary },
  stepLabel: { color: theme.color.text.secondary },
  pill: {
    alignSelf: 'flex-start',
    backgroundColor: theme.color.brand.primarySubtle,
    borderRadius: theme.radius.full,
    paddingHorizontal: theme.space['3'],
    paddingVertical: theme.space['1'],
  },
  pillText: { color: theme.color.brand.primary, textTransform: 'uppercase' },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.space['4'],
    backgroundColor: theme.color.bg.surface,
    borderRadius: theme.radius.lg,
    padding: theme.layout.cardPadding,
    minHeight: 72,
    borderWidth: 2,
    borderColor: 'transparent',
    ...theme.elevation['1'],
  },
  cardCompact: {
    flexDirection: 'column',
    alignItems: 'flex-start',
    flexBasis: '47%',
    flexGrow: 1,
    minHeight: 132,
  },
  cardSelected: {
    backgroundColor: theme.semantic.selection.bg,
    borderColor: theme.semantic.selection.bg,
  },
  cardText: { flex: 1, gap: theme.space['1'] },
  iconCircle: {
    width: 48,
    height: 48,
    borderRadius: theme.radius.full,
    backgroundColor: theme.color.brand.primarySubtle,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconCircleSelected: { backgroundColor: theme.color.white },
  radio: {
    width: 28,
    height: 28,
    borderRadius: theme.radius.full,
    backgroundColor: theme.color.brand.primarySubtle,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioSelected: { backgroundColor: theme.color.text.primary },
  radioCorner: { position: 'absolute', top: theme.space['3'], right: theme.space['3'] },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.space['2'],
    minHeight: 44,
    paddingHorizontal: theme.space['4'],
    borderRadius: theme.radius.full,
    borderWidth: 1,
    borderColor: theme.color.border.default,
    backgroundColor: theme.color.bg.surface,
  },
  chipSelected: {
    backgroundColor: theme.semantic.selection.bg,
    borderColor: theme.semantic.selection.bg,
  },
  group: {
    backgroundColor: theme.color.bg.surface,
    borderRadius: theme.radius.lg,
    padding: theme.layout.cardPadding,
    gap: theme.space['3'],
    ...theme.elevation['1'],
  },
  groupHead: { flexDirection: 'row', alignItems: 'center', gap: theme.space['3'] },
  groupIcon: {
    width: 40,
    height: 40,
    borderRadius: theme.radius.full,
    backgroundColor: theme.color.brand.primarySubtle,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.space['2'] },
  stepper: { gap: theme.space['2'], flex: 1 },
  stepperLabel: { color: theme.color.text.secondary },
  stepperRow: { flexDirection: 'row', alignItems: 'center', gap: theme.space['3'] },
  stepBtn: {
    width: 48,
    height: 48,
    borderRadius: theme.radius.full,
    borderWidth: 1,
    borderColor: theme.color.border.default,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.color.bg.app,
  },
  stepBtnPlus: {
    backgroundColor: theme.color.brand.primary,
    borderColor: theme.color.brand.primary,
  },
  stepBtnOff: { opacity: 0.4 },
  stepValue: { minWidth: 90, textAlign: 'center', color: theme.color.text.primary },
});
