import { Stack } from 'expo-router';
import { theme } from '../../../src/theme';

/** A deep link into the stack keeps the tab (M34) underneath it. */
export const unstable_settings = { anchor: 'index' };

/** Profile tab stack: the tab (M34), the Flat Biodata editor (M35) and its edit screens. */
export default function ProfileLayout() {
  return (
    <Stack
      screenOptions={{ headerShown: false, contentStyle: { backgroundColor: theme.color.bg.app } }}
    />
  );
}
