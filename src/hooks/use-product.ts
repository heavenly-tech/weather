"use client";

import { useEffect, useState } from "react";
import type { ProductEnvelope } from "@/lib/types";

type State<T> =
  | { status: "loading" }
  | { status: "empty"; message: string }
  | { status: "error"; message: string }
  | { status: "ready"; envelope: ProductEnvelope<T> };

export function useProduct<T>(url: string, emptyMessage = "Nothing to show yet.") {
  const [fetched, setFetched] = useState<{ url: string; state: State<T> }>({
    url,
    state: { status: "loading" },
  });

  if (fetched.url !== url) {
    setFetched({ url, state: { status: "loading" } });
  }

  useEffect(() => {
    const controller = new AbortController();
    fetch(url, { signal: controller.signal, cache: "no-store" })
      .then(async (res) => {
        if (!res.ok) {
          const text = await res.text();
          throw new Error(text || res.statusText);
        }
        return (await res.json()) as ProductEnvelope<T>;
      })
      .then((envelope) => {
        if (!envelope?.data) {
          setFetched({ url, state: { status: "empty", message: emptyMessage } });
          return;
        }
        setFetched({ url, state: { status: "ready", envelope } });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setFetched({
          url,
          state: {
            status: "error",
            message: error instanceof Error ? error.message : "The weather circuit did not answer.",
          },
        });
      });
    return () => controller.abort();
  }, [url, emptyMessage]);

  return fetched.state;
}
