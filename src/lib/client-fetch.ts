/** Browser fetch for the Vite desk. Every client request goes through here. */

export async function clientFetch<T>(input: RequestInfo | URL, init?: RequestInit): Promise<T> {
  const r = await fetch(input, init);
  if (!r.ok) {
    throw new Error(await errorMessage(r));
  }
  return (await r.json()) as T;
}

async function errorMessage(response: Response): Promise<string> {
  const text = await response.text();
  if (text) {
    try {
      const body = JSON.parse(text) as { error?: unknown };
      if (typeof body.error === "string" && body.error) return body.error;
    } catch {
      return text;
    }
  }
  return response.statusText || `HTTP ${response.status}`;
}
