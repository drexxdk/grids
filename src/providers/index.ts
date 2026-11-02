import { z } from "zod";
import { provenanceSchema, providerHosts, type Asset } from "../model";

export interface ProviderImage {
  provider: NonNullable<Asset["provenance"]>["provider"];
  id: string;
  title: string;
  sourcePage: string;
  creator: string;
  license: "CC0" | "Public domain";
  licenseUrl: string;
  thumbnail: string;
  original: {
    url: string;
    width?: number;
    height?: number;
    mime: string;
    size?: number;
  };
}

export interface ImageProvider {
  id: ProviderImage["provider"];
  name: string;
  domain: string;
  policyUrl: string;
  browse: {
    id:
      | "space"
      | "nature"
      | "art"
      | "places"
      | "history"
      | "paintings"
      | "sculpture"
      | "portraits"
      | "prints"
      | "ceramics";
    query: string;
  }[];
  capabilities: {
    pagination: boolean;
    localOriginals: boolean;
    crop: boolean;
    export: boolean;
  };
  search: (
    query: string,
    signal: AbortSignal,
    offset?: number,
  ) => Promise<{ images: ProviderImage[]; next?: number }>;
}

export class ProviderError extends Error {
  constructor(
    public readonly kind: "quota" | "unavailable" | "invalid",
    public readonly retryAfter = 0,
  ) {
    super(kind);
  }
}

type BatchSearch = (
  query: string,
  signal: AbortSignal,
  offset: number,
  limit: number,
) => ReturnType<ImageProvider["search"]>;

export function fillImagePages(
  provider: Omit<ImageProvider, "search"> & { search: BatchSearch },
): ImageProvider {
  return {
    ...provider,
    async search(query, signal, offset = 0) {
      const deadline = AbortSignal.timeout(15000);
      const requestSignal = AbortSignal.any([signal, deadline]);
      const images: ProviderImage[] = [];
      const seen = new Set<string>();
      let next: number | undefined = offset;
      for (
        let batch = 0;
        batch < 5 && next !== undefined && images.length < 12;
        batch++
      ) {
        signal.throwIfAborted();
        const cursor: number = next;
        const remaining = 12 - images.length;
        try {
          const result = await provider.search(
            query,
            requestSignal,
            cursor,
            remaining,
          );
          signal.throwIfAborted();
          if (result.images.length > remaining)
            throw new ProviderError("invalid");
          for (const image of result.images) {
            if (seen.has(image.id)) continue;
            seen.add(image.id);
            images.push(image);
          }
          next =
            result.next !== undefined &&
            Number.isSafeInteger(result.next) &&
            result.next > cursor
              ? result.next
              : undefined;
        } catch (error) {
          signal.throwIfAborted();
          if (deadline.aborted && images.length) break;
          throw error;
        }
      }
      return { images, next };
    },
  };
}

const metadata = z.record(z.string(), z.object({ value: z.string() }));
const responseSchema = z.object({
  error: z.unknown().optional(),
  continue: z.object({ gsroffset: z.number() }).passthrough().optional(),
  query: z
    .object({
      pages: z.array(
        z.object({
          pageid: z.number().int().positive(),
          index: z.number().optional(),
          title: z.string(),
          imageinfo: z
            .array(
              z.object({
                url: z.url(),
                descriptionurl: z.url(),
                thumburl: z.url().optional(),
                width: z.number().positive(),
                height: z.number().positive(),
                size: z.number().nonnegative(),
                mime: z.string(),
                extmetadata: metadata,
              }),
            )
            .optional(),
        }),
      ),
    })
    .optional(),
});

function safeUrl(value: string, host: string) {
  const url = new URL(value);
  return (
    url.protocol === "https:" &&
    url.hostname === host &&
    !url.username &&
    !url.password
  );
}

function plainText(value: string) {
  return (
    new DOMParser()
      .parseFromString(value, "text/html")
      .body.textContent?.trim()
      .slice(0, 1000) ?? ""
  );
}

let blockedUntil = 0;

export const commons = fillImagePages({
  id: "commons",
  name: "Wikimedia Commons",
  domain: "Open media",
  policyUrl:
    "https://commons.wikimedia.org/wiki/Commons:Reusing_content_outside_Wikimedia",
  browse: [
    { id: "space", query: "NASA Earth space" },
    { id: "nature", query: "Ansel Adams landscape" },
    { id: "art", query: "painting public domain" },
    { id: "places", query: "architecture public domain" },
    { id: "history", query: "historical photograph" },
  ],
  capabilities: {
    pagination: true,
    localOriginals: true,
    crop: true,
    export: true,
  },
  async search(query, signal, offset = 0, limit = 12) {
    if (Date.now() < blockedUntil)
      throw new ProviderError("quota", blockedUntil - Date.now());
    const url = new URL("https://commons.wikimedia.org/w/api.php");
    url.search = new URLSearchParams({
      action: "query",
      format: "json",
      formatversion: "2",
      origin: "*",
      generator: "search",
      gsrsearch: `${query.slice(0, 160)} filetype:bitmap`,
      gsrnamespace: "6",
      gsrlimit: String(limit),
      gsroffset: String(offset),
      prop: "imageinfo",
      iiprop: "url|size|mime|extmetadata",
      iiurlwidth: "320",
      iiextmetadatalanguage: "en",
      iiextmetadatafilter:
        "Artist|LicenseShortName|LicenseUrl|Copyrighted|Restrictions|AttributionRequired",
    }).toString();
    const response = await fetch(url, {
      signal,
      credentials: "omit",
      referrerPolicy: "no-referrer",
    });
    if (response.status === 429) {
      const retry = response.headers.get("Retry-After") ?? "60";
      const seconds = Number(retry);
      const wait = Number.isFinite(seconds)
        ? seconds * 1000
        : Date.parse(retry) - Date.now();
      blockedUntil =
        Date.now() + Math.max(1000, Number.isFinite(wait) ? wait : 60000);
      throw new ProviderError("quota", blockedUntil - Date.now());
    }
    if (!response.ok) throw new ProviderError("unavailable");
    const parsed = responseSchema.safeParse(await response.json());
    if (!parsed.success || parsed.data.error)
      throw new ProviderError("invalid");
    const images: ProviderImage[] = [];
    for (const page of (parsed.data.query?.pages ?? []).sort(
      (first, second) => (first.index ?? 0) - (second.index ?? 0),
    )) {
      const info = page.imageinfo?.[0];
      if (!info) continue;
      const meta = info.extmetadata;
      const license = meta.LicenseShortName?.value;
      if (license !== "CC0" && license !== "Public domain") continue;
      if (
        meta.Copyrighted?.value !== "False" ||
        meta.Restrictions?.value ||
        meta.AttributionRequired?.value === "true"
      )
        continue;
      if (
        !["image/jpeg", "image/png", "image/webp"].includes(info.mime) ||
        info.size > 20000000 ||
        info.width * info.height > 40000000
      )
        continue;
      if (
        !safeUrl(info.url, "upload.wikimedia.org") ||
        (!safeUrl(info.thumburl ?? info.url, "upload.wikimedia.org") &&
          !safeUrl(info.thumburl ?? info.url, "thumb.wikimedia.org")) ||
        !safeUrl(info.descriptionurl, "commons.wikimedia.org")
      )
        continue;
      const licenseUrl =
        meta.LicenseUrl?.value ||
        "https://commons.wikimedia.org/wiki/Commons:Public_domain";
      if (
        !safeUrl(licenseUrl, "creativecommons.org") &&
        !safeUrl(licenseUrl, "commons.wikimedia.org")
      )
        continue;
      images.push({
        provider: "commons",
        id: String(page.pageid),
        title: page.title.replace(/^File:/, "").replace(/\.[^.]+$/, ""),
        sourcePage: info.descriptionurl,
        creator: plainText(meta.Artist?.value ?? ""),
        license,
        licenseUrl,
        thumbnail: info.thumburl ?? info.url,
        original: {
          url: info.url,
          width: info.width,
          height: info.height,
          mime: info.mime,
          size: info.size,
        },
      });
    }
    return { images, next: parsed.data.continue?.gsroffset };
  },
});

const museumTopics: ImageProvider["browse"] = [
  { id: "paintings", query: "painting" },
  { id: "sculpture", query: "sculpture" },
  { id: "portraits", query: "portrait" },
  { id: "prints", query: "print" },
  { id: "ceramics", query: "ceramic" },
];
let metRequestTime = 0;
let metCooldown = 0;

async function metJson(url: URL, signal: AbortSignal): Promise<unknown> {
  signal.throwIfAborted();
  const cooldown = metCooldown - Date.now();
  if (cooldown > 0) throw new ProviderError("quota", cooldown);
  const wait = 100 - (Date.now() - metRequestTime);
  if (wait > 0)
    await new Promise<void>((resolve, reject) => {
      const abort = () => {
        clearTimeout(timer);
        signal.removeEventListener("abort", abort);
        reject(signal.reason);
      };
      const timer = setTimeout(() => {
        signal.removeEventListener("abort", abort);
        resolve();
      }, wait);
      signal.addEventListener("abort", abort, { once: true });
      if (signal.aborted) abort();
    });
  signal.throwIfAborted();
  metRequestTime = Date.now();
  const response = await fetch(url, {
    signal,
    credentials: "omit",
    referrerPolicy: "no-referrer",
  });
  if (response.status === 429) {
    const retry = response.headers.get("Retry-After") ?? "60";
    const seconds = Number(retry);
    const delay = Number.isFinite(seconds)
      ? seconds * 1000
      : Date.parse(retry) - Date.now();
    const duration = Math.max(1000, Number.isFinite(delay) ? delay : 60000);
    metCooldown = Date.now() + duration;
    throw new ProviderError("quota", duration);
  }
  if (!response.ok) throw new ProviderError("unavailable");
  try {
    return await response.json();
  } catch {
    throw new ProviderError("invalid");
  }
}

const metSearchSchema = z.object({
  total: z.number().int().nonnegative(),
  objectIDs: z.array(z.number().int().positive()).max(12).nullable(),
});
const metObjectSchema = z.object({
  objectID: z.number().int().positive(),
  isPublicDomain: z.literal(true),
  title: z.string().min(1),
  artistDisplayName: z.string(),
  primaryImage: z.url(),
  primaryImageSmall: z.url(),
  objectURL: z.url(),
  rightsAndReproduction: z.string().optional(),
});

export const met = fillImagePages({
  id: "met",
  name: "The Met",
  domain: "Art and cultural collections",
  policyUrl:
    "https://www.metmuseum.org/about-the-met/policies-and-documents/open-access",
  browse: museumTopics,
  capabilities: commons.capabilities,
  async search(query, signal, offset = 0, limit = 12) {
    limit = Math.min(limit, 10000 - offset);
    if (limit <= 0) return { images: [] };
    const url = new URL(
      "https://collectionapi.metmuseum.org/public/collection/v1.1/search",
    );
    url.search = new URLSearchParams({
      q: query.slice(0, 160),
      hasImages: "true",
      offset: String(offset),
      limit: String(limit),
    }).toString();
    const parsed = metSearchSchema.safeParse(await metJson(url, signal));
    if (!parsed.success) throw new ProviderError("invalid");
    const images: ProviderImage[] = [];
    for (const id of parsed.data.objectIDs ?? []) {
      const object = metObjectSchema.safeParse(
        await metJson(
          new URL(
            `https://collectionapi.metmuseum.org/public/collection/v1/objects/${id}`,
          ),
          signal,
        ),
      );
      if (!object.success) continue;
      const item = object.data;
      if (
        item.objectID !== id ||
        item.rightsAndReproduction?.trim() ||
        !safeUrl(item.primaryImage, "images.metmuseum.org") ||
        !safeUrl(item.primaryImageSmall, "images.metmuseum.org") ||
        !safeUrl(item.objectURL, "www.metmuseum.org")
      )
        continue;
      images.push({
        provider: "met",
        id: String(id),
        title: item.title.slice(0, 120),
        sourcePage: item.objectURL,
        creator: plainText(item.artistDisplayName),
        license: "CC0",
        licenseUrl: "https://creativecommons.org/publicdomain/zero/1.0/",
        thumbnail: item.primaryImageSmall,
        original: { url: item.primaryImage, mime: "image/jpeg" },
      });
    }
    const count = parsed.data.objectIDs?.length ?? 0;
    const next = offset + count;
    return {
      images,
      next:
        count > 0 && next < Math.min(parsed.data.total, 10000)
          ? next
          : undefined,
    };
  },
});

export const imageProviders: readonly ImageProvider[] = [commons, met];

export async function downloadProviderImage(
  image: ProviderImage,
  signal: AbortSignal,
): Promise<{ blob: Blob; provenance: NonNullable<Asset["provenance"]> }> {
  const provenance = provenanceSchema.safeParse({
    provider: image.provider,
    entityId: image.id,
    sourcePage: image.sourcePage,
    originalUrl: image.original.url,
    creator: image.creator,
    license: image.license,
    licenseUrl: image.licenseUrl,
  });
  if (!provenance.success) throw new ProviderError("invalid");
  const response = await fetch(image.original.url, {
    signal: AbortSignal.any([signal, AbortSignal.timeout(30000)]),
    credentials: "omit",
    referrerPolicy: "no-referrer",
    redirect: "error",
  });
  if (
    !response.ok ||
    (response.url &&
      !safeUrl(response.url, providerHosts[image.provider].image)) ||
    response.headers.get("Content-Type")?.split(";")[0] !==
      image.original.mime ||
    !response.body
  )
    throw new ProviderError("invalid");
  const reader = response.body.getReader();
  const chunks: BlobPart[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 20000000) throw new ProviderError("invalid");
      chunks.push(value);
    }
  } finally {
    await reader.cancel();
  }
  if (!size) throw new ProviderError("invalid");
  return {
    blob: new Blob(chunks, { type: image.original.mime }),
    provenance: provenance.data,
  };
}
