import { useEffect, useState } from 'react';

export function useOverviewData<T>(fetchData: () => Promise<T>, fallback: string, refreshKey = 0, enabled = true) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let active = true;
    let timer: number;
    async function load() {
      try {
        const next = await fetchData();
        if (active) {
          setData(next);
          setError(null);
        }
      } catch (cause) {
        if (active) setError(cause instanceof Error ? cause.message : fallback);
      } finally {
        if (active) timer = window.setTimeout(() => void load(), 30_000);
      }
    }
    void load();
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [fetchData, fallback, refreshKey, enabled]);

  return { data, error };
}
