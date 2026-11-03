import { createHash, createHmac, randomBytes } from "node:crypto";
import { z } from "zod";
import type { AuthProvider } from "@grids/contracts/cloud";
import type { Config } from "./config.js";

export const randomToken = () => randomBytes(32).toString("base64url");
export const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const definitions = {
  google: {
    authorize: "https://accounts.google.com/o/oauth2/v2/auth",
    token: "https://oauth2.googleapis.com/token",
    profile: "https://openidconnect.googleapis.com/v1/userinfo",
    scope: "openid profile",
    pkce: true,
  },
  discord: {
    authorize: "https://discord.com/oauth2/authorize",
    token: "https://discord.com/api/oauth2/token",
    profile: "https://discord.com/api/users/@me",
    scope: "identify",
    pkce: true,
  },
  facebook: {
    authorize: "https://www.facebook.com/dialog/oauth",
    token: "https://graph.facebook.com/oauth/access_token",
    profile: "https://graph.facebook.com/me?fields=id,name",
    scope: "public_profile",
    pkce: false,
  },
} as const;
export const callbackUrl = (config: Config, provider: AuthProvider) =>
  `${config.apiOrigin}/api/auth/${provider}/callback`;

export function authorizationUrl(config: Config, provider: AuthProvider, state: string, verifier: string, linking = false) {
  const definition = definitions[provider];
  const url = new URL(definition.authorize);
  url.search = new URLSearchParams({
    client_id: config.credentials[provider].id,
    redirect_uri: callbackUrl(config, provider),
    response_type: "code",
    scope: definition.scope,
    state,
    ...(linking ? provider === "google" ? { prompt: "select_account" } :
      provider === "discord" ? { prompt: "consent" } : { auth_type: "reauthenticate" } : {}),
    ...(definition.pkce ? {
      code_challenge: createHash("sha256").update(verifier).digest("base64url"),
      code_challenge_method: "S256",
    } : {}),
  }).toString();
  return url.href;
}

export interface Profile { subject: string; name: string }
export async function exchangeCode(
  config: Config,
  provider: AuthProvider,
  code: string,
  verifier: string,
): Promise<Profile> {
  const definition = definitions[provider];
  const response = await fetch(definition.token, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: new URLSearchParams({
      client_id: config.credentials[provider].id,
      client_secret: config.credentials[provider].secret,
      redirect_uri: callbackUrl(config, provider),
      grant_type: "authorization_code",
      code,
      ...(definition.pkce ? { code_verifier: verifier } : {}),
    }),
    signal: AbortSignal.timeout(10000),
    redirect: "error",
  });
  if (!response.ok) throw new Error(`OAuth token exchange failed (${response.status}).`);
  const token = z.object({ access_token: z.string().min(1) }).parse(await response.json());
  const profileUrl = new URL(definition.profile);
  if (provider === "facebook") {
    profileUrl.searchParams.set(
      "appsecret_proof",
      createHmac("sha256", config.credentials.facebook.secret)
        .update(token.access_token).digest("hex"),
    );
  }
  const profileResponse = await fetch(profileUrl, {
    headers: { Authorization: `Bearer ${token.access_token}`, Accept: "application/json" },
    signal: AbortSignal.timeout(10000),
    redirect: "error",
  });
  if (!profileResponse.ok) throw new Error(`OAuth profile lookup failed (${profileResponse.status}).`);
  const body: unknown = await profileResponse.json();
  if (provider === "google") {
    const profile = z.object({ sub: z.string().min(1).max(255), name: z.string().optional() }).parse(body);
    return { subject: profile.sub, name: (profile.name || "Google user").slice(0, 100) };
  }
  const profile = z.object({
    id: z.string().min(1).max(255),
    name: z.string().optional(),
    username: z.string().optional(),
    global_name: z.string().nullish(),
  }).parse(body);
  return {
    subject: profile.id,
    name: (profile.global_name || profile.name || profile.username || `${provider} user`).slice(0, 100),
  };
}
