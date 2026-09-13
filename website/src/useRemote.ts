import { useEffect, useRef, useState } from 'react';
import { clearDataCache } from './api.ts';

export function useRemote<T>(key: string | null, load: () => Promise<T>) {
  const loader = useRef(load); loader.current = load;
  const [retry, setRetry] = useState(0);
  const [state, setState] = useState<{ key: string | null; data?: T; error?: string; loading: boolean }>({ key: null, loading: false });
  useEffect(() => {
    if (key === null) return;
    let active = true;
    setState({ key, loading: true });
    loader.current().then(data => { if (active) setState({ key, data, loading: false }); }, error => {
      if (active) setState({ key, loading: false, error: error instanceof Error ? error.message : 'Unable to load data.' });
    });
    return () => { active = false; };
  }, [key, retry]);
  const current: typeof state = state.key === key ? state : { key, loading: key !== null };
  return { ...current, retry: () => { clearDataCache(); setRetry(n => n + 1); } };
}
