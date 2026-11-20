import { Alert, Platform } from 'react-native';

/**
 * Ask before a destructive action. Native shows a two-button alert (the confirm button styled as
 * destructive); web falls back to the browser's confirm dialog. Resolves true only on confirm.
 */
export function confirmAction({
  title,
  message,
  confirmLabel,
  cancelLabel,
}: {
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel: string;
}): Promise<boolean> {
  if (Platform.OS === 'web') return Promise.resolve(window.confirm(`${title}\n\n${message}`));
  return new Promise((resolve) =>
    Alert.alert(
      title,
      message,
      [
        { text: cancelLabel, style: 'cancel', onPress: () => resolve(false) },
        { text: confirmLabel, style: 'destructive', onPress: () => resolve(true) },
      ],
      { cancelable: true, onDismiss: () => resolve(false) },
    ),
  );
}
