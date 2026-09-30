import { useCallback, useEffect, useRef, useState } from 'react';

type AsyncFn = () => Promise<unknown>;

/**
 * Runs an async function on mount and whenever `deps` change, with the usual
 * loading / error / refetch surface. Guards against setting state after unmount
 * and against out-of-order responses from rapid dependency changes.
 */
export function useAsync<T>(
  fn: AsyncFn,
  deps: unknown[] = []
): {
  data: T | null;
  error: string | null;
  isLoading: boolean;
  refetch: () => void;
} {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [nonce, setNonce] = useState(0);
  const mounted = useRef(true);

  // The caller owns the dependency list, which is the whole point of this
  // helper; the default-parameter escape hatch avoids forcing a lint ignore
  // on every call site.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const run = useCallback(fn, deps);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    setError(null);

    run()
      .then((result) => {
        if (cancelled || !mounted.current) return;
        setData(result as T);
        setIsLoading(false);
      })
      .catch((reason: unknown) => {
        if (cancelled || !mounted.current) return;
        setError(reason instanceof Error ? reason.message : 'Something went wrong');
        setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [run, nonce]);

  const refetch = useCallback(() => setNonce((value) => value + 1), []);

  return { data, error, isLoading, refetch };
}

/** Debounces a rapidly changing value, e.g. a search input. */
export function useDebouncedValue<T>(value: T, delayMs = 300): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);

  return debounced;
}
