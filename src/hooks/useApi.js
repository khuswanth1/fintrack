import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../lib/api.js";
import { realtime } from "../lib/realtime.js";

/** Fetch `path` (re-fetching when path/params change) and expose loading, error and reload.
 * With `{ live: true }` it also refetches when the server reports the user's data changed (another tab,
 * device, recurring job or import), so financial views stay current without polling. */
export function useApi(path, params, { live = false } = {}) {
  const [state, setState] = useState({ data: null, loading: Boolean(path), error: null });
  const key = JSON.stringify(params ?? null);
  const controller = useRef(null);

  const load = useCallback(async () => {
    if (!path) return;
    controller.current?.abort();
    const ctrl = new AbortController();
    controller.current = ctrl;
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const data = await api(path, { params: JSON.parse(key), signal: ctrl.signal });
      if (!ctrl.signal.aborted) setState({ data, loading: false, error: null });
    } catch (error) {
      if (error.name !== "AbortError" && !ctrl.signal.aborted) setState((s) => ({ ...s, loading: false, error }));
    }
  }, [path, key]);

  useEffect(() => {
    load();
    return () => controller.current?.abort();
  }, [load]);

  useEffect(() => {
    if (!live || !path) return undefined;
    let timer;
    // Debounced: a bulk import or a write plus its budget alert arrive as a burst.
    const unsubscribe = realtime.subscribe("data.changed", () => { clearTimeout(timer); timer = setTimeout(load, 250); });
    return () => { clearTimeout(timer); unsubscribe(); };
  }, [live, path, load]);

  return { ...state, reload: load, setData: (data) => setState((s) => ({ ...s, data })) };
}

export function useDebounced(value, delay = 300) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return v;
}
