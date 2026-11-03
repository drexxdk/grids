import { z } from "zod";
import type { AuthProvider } from "@grids/contracts/cloud";

const httpUrl = z.url({ protocol: /^https?$/ });
const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().min(1).max(65535).default(5841),
  DATABASE_URL: z.string().min(1),
  WEB_URL: httpUrl.default("http://localhost:5837/"),
  PUBLIC_API_URL: httpUrl.default("http://localhost:5841"),
  TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(5).default(0),
  GOOGLE_CLIENT_ID: z.string().default(""),
  GOOGLE_CLIENT_SECRET: z.string().default(""),
  DISCORD_CLIENT_ID: z.string().default(""),
  DISCORD_CLIENT_SECRET: z.string().default(""),
  FACEBOOK_APP_ID: z.string().default(""),
  FACEBOOK_APP_SECRET: z.string().default(""),
});
export function readConfig(environment: NodeJS.ProcessEnv) {
  const env = envSchema.parse(environment);
  const web = new URL(env.WEB_URL);
  const api = new URL(env.PUBLIC_API_URL);
  if ([web, api].some((url) => url.username || url.password || url.search || url.hash)) {
    throw new Error("Public URLs cannot contain credentials, query strings or fragments.");
  }
  if (api.pathname !== "/") throw new Error("PUBLIC_API_URL must be an origin without a path.");
  if (env.NODE_ENV === "production" && [web, api].some((url) => url.protocol !== "https:")) {
    throw new Error("Production requires HTTPS public URLs.");
  }
  const credentials: Record<AuthProvider, { id: string; secret: string }> = {
    google: { id: env.GOOGLE_CLIENT_ID, secret: env.GOOGLE_CLIENT_SECRET },
    discord: { id: env.DISCORD_CLIENT_ID, secret: env.DISCORD_CLIENT_SECRET },
    facebook: { id: env.FACEBOOK_APP_ID, secret: env.FACEBOOK_APP_SECRET },
  };
  for (const [provider, value] of Object.entries(credentials)) {
    if (Boolean(value.id) !== Boolean(value.secret)) {
      throw new Error(`Both credentials are required for ${provider}.`);
    }
  }
  return {
    port: env.PORT,
    databaseUrl: env.DATABASE_URL,
    webUrl: web.href,
    webOrigin: web.origin,
    apiOrigin: api.origin,
    secure: env.NODE_ENV === "production",
    trustProxyHops: env.TRUST_PROXY_HOPS,
    credentials,
  };
}
export type Config = ReturnType<typeof readConfig>;
