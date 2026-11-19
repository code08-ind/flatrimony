import { useCallback, useRef } from 'react';
import { router, type Href } from 'expo-router';

/**
 * Navigate on Continue at most once per tap burst: a double tap would otherwise push the next
 * screen twice (Back then shows the same step again).
 */
export function useGoOnce() {
  const last = useRef(0);
  return useCallback((href: Href) => {
    const now = Date.now();
    if (now - last.current < 800) return;
    last.current = now;
    router.push(href);
  }, []);
}
