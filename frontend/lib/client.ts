// Browser API client: calls the same-origin proxy (which attaches the bearer).

export async function apiGet<T>(path: string): Promise<T> {
  const res = await fetch(`/api/control/${path}`, { cache: "no-store" });
  if (!res.ok) {
    throw new Error(`Request failed (${res.status})`);
  }
  return (await res.json()) as T;
}

export async function apiSend<T>(path: string, method: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api/control/${path}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`Request failed (${res.status})`);
  }
  return (await res.json()) as T;
}

export const exportUrl = (format: string, render: string): string =>
  `/api/control/v1/audit/export?format=${format}&render=${render}`;
