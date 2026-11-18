import { useEffect, useState } from "react";
import { clientFetch } from "@/lib/client-fetch";

export function useClientQuery<T>(url: string): { loading: boolean; error: string | null; data: T | null } {
  const [state, setState] = useState<{ url: string; error: string | null; data: T | null } | null>(null);
  useEffect(() => {
    let live = true;
    clientFetch<T>(url)
      .then((data) => {
        if (live) setState({ url, error: null, data });
      })
      .catch((error: unknown) => {
        if (!live) return;
        const message = error instanceof Error ? error.message : "Request failed";
        setState({ url, error: message, data: null });
      });
    return () => {
      live = false;
    };
  }, [url]);
  if (!state || state.url !== url) return { loading: true, error: null, data: null };
  return { loading: false, error: state.error, data: state.data };
}
