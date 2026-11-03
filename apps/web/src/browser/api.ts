import { z } from "zod";

const configuredUrl = import.meta.env.VITE_API_URL as string | undefined;
export const apiBase = configuredUrl
  ? new URL(configuredUrl).href.replace(/\/$/, "")
  : `${location.origin}/api`;
const errorSchema = z.object({ error: z.string() });

export async function apiRequest<T>(
  path: string,
  schema: z.ZodType<T>,
  options: { method?: string; body?: unknown; version?: string; signal?: AbortSignal } = {},
): Promise<T> {
  const response = await fetch(`${apiBase}${path}`, {
    method: options.method ?? "GET",
    credentials: "include",
    cache: "no-store",
    headers: {
      "X-Grids-Request": "1",
      ...(options.body !== undefined ? { "Content-Type": "application/json" } : {}),
      ...(options.version ? { "If-Match": options.version } : {}),
    },
    ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
    signal: options.signal
      ? AbortSignal.any([options.signal, AbortSignal.timeout(15000)])
      : AbortSignal.timeout(15000),
  });
  if (!response.ok) {
    let message = `Request failed (${response.status}).`;
    if (response.headers.get("content-type")?.includes("application/json")) {
      const error = errorSchema.safeParse(await response.json());
      if (error.success) message = error.data.error;
    }
    throw new Error(message);
  }
  if (response.status === 204) return schema.parse(undefined);
  if (!response.headers.get("content-type")?.includes("application/json")) {
    throw new Error("The account service is not configured at this address.");
  }
  return schema.parse(await response.json());
}
