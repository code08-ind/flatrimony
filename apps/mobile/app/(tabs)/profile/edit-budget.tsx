import { useState } from 'react';
import { Text } from 'react-native';
import { LIMITS } from '@flatrimony/shared';
import { useMe } from '../../../src/me';
import { clampBudget } from '@flatrimony/client';
import { EditScreen } from '../../../src/profile/EditScreen';
import { preferencesWith } from '../../../src/profile/logic';
import { useProfileSave } from '../../../src/profile/save';
import { textStyle, theme } from '../../../src/theme';
import { useT } from '../../../src/useT';
import { BudgetPicker } from '../../../src/ui/biodata/BudgetPicker';
import { MoveInPicker, type MoveInRange } from '../../../src/ui/biodata/MoveInPicker';

/** Budget & dates: budget, move-in window and lease (FR-BIO-02; PUT /me/preferences). */
export default function EditBudget() {
  const { t, locale } = useT();
  const { me } = useMe();
  const saving = useProfileSave();
  const p = me?.preferences;
  const initial = clampBudget(p?.budgetMinInr ?? 10_000, p?.budgetMaxInr ?? 20_000);
  const [min, setMin] = useState(initial.min);
  const [max, setMax] = useState(initial.max);
  const [range, setRange] = useState<MoveInRange>({ from: p?.moveInFrom, to: p?.moveInTo });
  const [lease, setLease] = useState(p?.leaseMonths ?? LIMITS.leaseMonths.default);
  if (!me || !p) return null;
  const dirty =
    min !== p.budgetMinInr ||
    max !== p.budgetMaxInr ||
    range.from !== p.moveInFrom ||
    range.to !== p.moveInTo ||
    lease !== p.leaseMonths;

  return (
    <EditScreen
      title={t('profile.editor.budgetDates')}
      busy={saving.busy}
      error={saving.error}
      dirty={dirty}
      saved={saving.saved}
      canSave={!!range.from && !!range.to}
      onSave={() =>
        void saving.save(
          '/me/preferences',
          'PUT',
          preferencesWith(p, {
            budgetMinInr: min,
            budgetMaxInr: max,
            moveInFrom: range.from!,
            moveInTo: range.to!,
            leaseMonths: lease,
          }),
        )
      }
    >
      <BudgetPicker
        min={min}
        max={max}
        showNote={false}
        onChange={(lo, hi) => {
          setMin(lo);
          setMax(hi);
        }}
      />
      <Text
        style={[
          textStyle('label', locale),
          { color: theme.color.text.secondary, textTransform: 'uppercase' },
        ]}
        accessibilityRole="header"
      >
        {t('onboarding.moveIn.overline')}
      </Text>
      <MoveInPicker range={range} onRange={setRange} lease={lease} onLease={setLease} />
    </EditScreen>
  );
}
