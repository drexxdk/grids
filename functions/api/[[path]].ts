interface Environment {
  GRIDS_API_URL?: string;
  GRIDS_PROXY_SECRET?: string;
  GRIDS_PUBLIC_ORIGIN?: string;
}

function failure(status: number, error: string) {
  return Response.json({ error }, { status, headers: { "Cache-Control": "no-store" } });
}

export async function onRequest({ request, env }: { request: Request; env: Environment }): Promise<Response> {
  if (!env.GRIDS_API_URL || !env.GRIDS_PROXY_SECRET || !env.GRIDS_PUBLIC_ORIGIN) {
    return failure(503, "The account service is not configured for this deployment.");
  }
  const incoming = new URL(request.url);
  let origin: URL;
  let upstream: URL;
  try {
    origin = new URL(env.GRIDS_PUBLIC_ORIGIN);
    upstream = new URL(env.GRIDS_API_URL);
  } catch {
    console.error("Invalid Pages API proxy URLs.");
    return failure(503, "The account service configuration is invalid.");
  }
  if (origin.protocol !== "https:" || origin.origin !== env.GRIDS_PUBLIC_ORIGIN ||
    upstream.protocol !== "https:" || upstream.origin === origin.origin || upstream.username || upstream.password || upstream.search || upstream.hash) {
    console.error("Invalid Pages API proxy configuration.");
    return failure(503, "The account service configuration is invalid.");
  }
  if (incoming.origin !== origin.origin) {
    return failure(403, "Accounts are available only on the production site.");
  }
  if (incoming.pathname !== "/api" && !incoming.pathname.startsWith("/api/")) {
    return failure(404, "API route not found.");
  }
  upstream.pathname = upstream.pathname.replace(/\/$/, "") + incoming.pathname;
  upstream.search = incoming.search;
  const headers = new Headers(request.headers);
  for (const header of ["host", "authorization", "forwarded", "x-forwarded-for", "x-forwarded-host", "x-forwarded-proto", "x-grids-client-ip"]) {
    headers.delete(header);
  }
  headers.set("X-Grids-Proxy-Secret", env.GRIDS_PROXY_SECRET);
  const clientIp = request.headers.get("CF-Connecting-IP");
  if (clientIp) headers.set("X-Grids-Client-IP", clientIp);
  try {
    const response = await fetch(upstream, {
      method: request.method,
      headers,
      body: ["GET", "HEAD"].includes(request.method) ? undefined : request.body,
      redirect: "manual",
      signal: AbortSignal.any([request.signal, AbortSignal.timeout(20000)]),
    });
    const result = new Response(response.body, response);
    result.headers.set("Cache-Control", "no-store");
    return result;
  } catch {
    console.error("Pages could not reach the Grids API.");
    return failure(502, "The account service is temporarily unavailable. Guest editing remains available.");
  }
}
