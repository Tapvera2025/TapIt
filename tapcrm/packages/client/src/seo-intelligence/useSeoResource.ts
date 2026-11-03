import { useCallback, useEffect, useRef, useState } from 'react';

/** Keeps each website's data scoped to its request, including background polling. */
export function useSeoResource<T>(
  key: string | null,
  loader: () => Promise<T>,
  pollMs = 0,
) {
  const loaderRef = useRef(loader);
  loaderRef.current = loader;
  const [revision, setRevision] = useState(0);
  const [state, setState] = useState<{
    key: string | null;
    data?: T;
    loading: boolean;
    error: string;
  }>({ key: null, loading: true, error: '' });
  const reload = useCallback(() => setRevision((value) => value + 1), []);
  useEffect(() => {
    if (!key) return;
    let cancelled = false;
    let running = false;
    const fetchData = async () => {
      if (running) return;
      running = true;
      setState((previous) => ({
        key,
        ...(previous.key === key && previous.data !== undefined
          ? { data: previous.data }
          : {}),
        loading: true,
        error: '',
      }));
      try {
        const data = await loaderRef.current();
        if (!cancelled) setState({ key, data, loading: false, error: '' });
      } catch (error) {
        if (!cancelled)
          setState((previous) => ({
            ...previous,
            key,
            loading: false,
            error:
              error instanceof Error
                ? error.message
                : 'This information could not be loaded. Please try again.',
          }));
      } finally {
        running = false;
      }
    };
    void fetchData();
    const timer = pollMs
      ? window.setInterval(() => {
          void fetchData();
        }, pollMs)
      : null;
    return () => {
      cancelled = true;
      if (timer !== null) window.clearInterval(timer);
    };
  }, [key, revision, pollMs]);
  return {
    data: state.key === key ? state.data : undefined,
    loading: key !== null && (state.key !== key || state.loading),
    error: state.key === key ? state.error : '',
    reload,
  };
}
