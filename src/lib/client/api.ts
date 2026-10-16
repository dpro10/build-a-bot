/**
 * Browser-side JSON fetch for our own API routes. Throws ApiError with the
 * server's message (routes answer `{ error }` on failure; see src/lib/api.ts).
 */
export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public data: Record<string, unknown> = {},
  ) {
    super(message);
  }
  /** Why, when the server says ("no_credit": out of credit; "fair_use": over a fair-use limit). */
  get code(): string | undefined {
    return typeof this.data.code === "string" ? this.data.code : undefined;
  }
}

export async function api<T = Record<string, unknown>>(url: string, opts: { method?: string; body?: unknown; signal?: AbortSignal } = {}): Promise<T> {
  const res = await fetch(url, {
    method: opts.method ?? (opts.body === undefined ? "GET" : "POST"),
    headers: opts.body === undefined ? undefined : { "content-type": "application/json" },
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    signal: opts.signal,
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    const message = typeof data.error === "string" ? data.error : res.status === 401 ? "Please sign in again." : `Something went wrong (${res.status}).`;
    throw new ApiError(message, res.status, data);
  }
  return data as T;
}
