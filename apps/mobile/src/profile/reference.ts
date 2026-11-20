import { useCallback, useEffect, useState } from 'react';
import { ReferenceData } from '@flatrimony/shared';
import { api } from '../api';

/** GET /v1/reference in the app's language (areas, scenario questions). */
export function useReference(locale: 'en' | 'hi') {
  const [data, setData] = useState<ReferenceData | null>(null);
  const [failed, setFailed] = useState(false);
  const load = useCallback(async () => {
    setFailed(false);
    try {
      const res = await api('/reference', { locale });
      const parsed = ReferenceData.safeParse(res.body);
      if (!parsed.success) throw new Error('bad reference data');
      setData(parsed.data);
    } catch {
      setFailed(true);
    }
  }, [locale]);
  useEffect(() => {
    void load();
  }, [load]);
  return { data, failed, retry: load };
}
