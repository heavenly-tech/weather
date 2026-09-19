export async function fetchJson<T>(
  url: string,
  init?: RequestInit & { timeoutMs?: number }
): Promise<{ ok: true; data: T; status: number } | { ok: false; status: number; error: string }> {
  const timeoutMs = init?.timeoutMs ?? 12_000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      ...init,
      signal: controller.signal,
      headers: {
        accept: "application/json",
        "user-agent": "HeavenlyWeather/1.0 (aviation briefing; weather.heavenly.cl)",
        ...(init?.headers ?? {}),
      },
      cache: "no-store",
    });
    if (res.status === 204) {
      return { ok: false, status: 204, error: "No product available for that query." };
    }
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return { ok: false, status: res.status, error: text.slice(0, 200) || res.statusText };
    }
    const data = (await res.json()) as T;
    return { ok: true, data, status: res.status };
  } catch (error) {
    const aborted =
      (error instanceof DOMException && error.name === "AbortError") ||
      (error instanceof Error && (error.name === "AbortError" || /aborted/i.test(error.message)));
    const message = aborted
      ? `Timed out after ${Math.round(timeoutMs / 1000)}s waiting for the weather circuit.`
      : error instanceof Error
        ? error.message
        : "Network error";
    return { ok: false, status: 0, error: message };
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchBinary(
  url: string,
  timeoutMs = 12000
): Promise<{ ok: true; body: ArrayBuffer; contentType: string } | { ok: false; error: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      cache: "no-store",
      headers: {
        "user-agent": "HeavenlyWeather/1.0 (aviation briefing; weather.heavenly.cl)",
      },
    });
    if (!res.ok) return { ok: false, error: `${res.status} ${res.statusText}` };
    const body = await res.arrayBuffer();
    const contentType = res.headers.get("content-type") ?? "application/octet-stream";
    return { ok: true, body, contentType };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Network error" };
  } finally {
    clearTimeout(timer);
  }
}

export function nowIso(): string {
  return new Date().toISOString();
}
