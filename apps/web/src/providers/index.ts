import { z } from "zod";
import { providerFreshTime, providerQuery } from "./cache";
import {
  providerPageSize,
  providerQueryMaxLength,
  providerImageMaxBytes,
  providerImageMaxPixels,
  captionMaxLength,
} from "../config";
import {
  provenanceSchema,
  imageLicenseSchema,
  isProviderUrl,
  previewCardMaxWidth,
  type Asset,
} from "../model";

const providerSearchTimeoutMs = 15_000;
const providerDownloadTimeoutMs = 30_000;
const providerMaxSearchBatches = 5;
const metSearchResultLimit = 10_000;
const metRequestIntervalMs = 100;
const providerRetryDelayMs = 60_000;
const providerMinimumRetryDelayMs = 1_000;

export interface ProviderImage {
  provider: NonNullable<Asset["provenance"]>["provider"];
  id: string;
  title: string;
  sourcePage: string;
  creator: string;
  license: NonNullable<Asset["provenance"]>["license"];
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

export function providerPreviewUrl(
  image: ProviderImage,
  cardWidth: number,
  pixelRatio = 1,
  thumbnailSize?: { width: number; height: number },
) {
  const displayWidth = Math.min(previewCardMaxWidth, Math.max(1, cardWidth));
  const density = Math.max(1, pixelRatio);
  if (image.provider === "met") {
    return thumbnailSize &&
      (thumbnailSize.width < displayWidth * density ||
        thumbnailSize.height < ((displayWidth * 4) / 3) * density)
      ? image.original.url
      : image.thumbnail;
  }
  const { width, height } = image.original;
  if (!width || !height) return image.thumbnail;
  const scale = Math.min(
    1,
    Math.max(
      (displayWidth * density) / width,
      (((displayWidth * 4) / 3) * density) / height,
    ),
  );
  const requiredWidth = Math.ceil(width * scale);
  const renditionWidth = [120, 250, 330, 500, 960, 1280, 1920, 3840].find(
    (candidate) => candidate >= requiredWidth,
  );
  if (!renditionWidth || renditionWidth >= width) return image.original.url;
  const url = new URL(image.thumbnail);
  if (
    !["upload.wikimedia.org", "thumb.wikimedia.org"].includes(url.hostname) ||
    !url.pathname.includes("/thumb/") ||
    !/\/\d+px-[^/]+$/.test(url.pathname)
  )
    return image.thumbnail;
  url.pathname = url.pathname.replace(
    /\/\d+px-([^/]+)$/,
    `/${renditionWidth}px-$1`,
  );
  return url.href;
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
      | "ceramics"
      | "animals"
      | "birds"
      | "plants";
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
    topic?: string | null,
    pageSize?: number,
    onImages?: (images: ProviderImage[]) => void,
  ) => Promise<{
    images: ProviderImage[];
    next?: number;
    incomplete?: boolean;
  }>;
}

export function cacheImageProvider(provider: ImageProvider): ImageProvider {
  const pending = new Map<
    string,
    {
      users: number;
      images: ProviderImage[];
      listeners: Set<(images: ProviderImage[]) => void>;
    }
  >();
  return {
    ...provider,
    async search(
      query,
      signal,
      offset = 0,
      topic = null,
      pageSize = providerPageSize,
      onImages,
    ) {
      signal.throwIfAborted();
      const filter = query.trim().slice(0, providerQueryMaxLength);
      const key = [
        "provider-page",
        provider.id,
        filter,
        offset,
        topic,
        pageSize,
      ];
      const progressKey = JSON.stringify(key);
      const progress = pending.get(progressKey) ?? {
        users: 0,
        images: [],
        listeners: new Set<(images: ProviderImage[]) => void>(),
      };
      pending.set(progressKey, progress);
      progress.users += 1;
      try {
        if (onImages) {
          progress.listeners.add(onImages);
          if (progress.images.length)
            onImages(structuredClone(progress.images));
        }
        return await providerQuery(
          key,
          (requestSignal) =>
            provider.search(
              filter,
              requestSignal,
              offset,
              topic,
              pageSize,
              (images) => {
                progress.images = structuredClone(images);
                for (const listener of progress.listeners)
                  listener(structuredClone(progress.images));
              },
            ),
          signal,
          (data) => (data?.incomplete ? 0 : providerFreshTime),
        );
      } finally {
        if (onImages) progress.listeners.delete(onImages);
        progress.users -= 1;
        if (!progress.users) pending.delete(progressKey);
      }
    },
  };
}

export class ProviderError extends Error {
  constructor(
    public readonly kind:
      | "quota"
      | "busy"
      | "timeout"
      | "unavailable"
      | "invalid",
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
  topic?: string | null,
  onImages?: (images: ProviderImage[]) => void,
) => ReturnType<ImageProvider["search"]>;

export function fillImagePages(
  provider: Omit<ImageProvider, "search"> & { search: BatchSearch },
): ImageProvider {
  return {
    ...provider,
    async search(
      query,
      signal,
      offset = 0,
      topic = null,
      pageSize = providerPageSize,
      onImages,
    ) {
      if (
        !Number.isInteger(pageSize) ||
        pageSize < 1 ||
        pageSize > providerPageSize
      )
        throw new ProviderError("invalid");
      const deadline = AbortSignal.timeout(providerSearchTimeoutMs);
      const requestSignal = AbortSignal.any([signal, deadline]);
      const images: ProviderImage[] = [];
      const seen = new Set<string>();
      let incomplete = false;
      let next: number | undefined = offset;
      for (
        let batch = 0;
        batch < providerMaxSearchBatches &&
        next !== undefined &&
        images.length < pageSize;
        batch++
      ) {
        signal.throwIfAborted();
        const cursor: number = next;
        const remaining = pageSize - images.length;
        try {
          const collect = (results: ProviderImage[]) => {
            if (results.length > remaining) throw new ProviderError("invalid");
            for (const image of results) {
              if (seen.has(image.id)) continue;
              seen.add(image.id);
              images.push(image);
            }
            onImages?.(images.slice());
          };
          const result = await provider.search(
            query,
            requestSignal,
            cursor,
            remaining,
            topic,
            collect,
          );
          signal.throwIfAborted();
          collect(result.images);
          next =
            result.next !== undefined &&
            Number.isSafeInteger(result.next) &&
            result.next > cursor
              ? result.next
              : undefined;
        } catch (error) {
          signal.throwIfAborted();
          if (deadline.aborted && images.length) {
            incomplete = true;
            break;
          }
          if (deadline.aborted) throw new ProviderError("timeout");
          throw error;
        }
      }
      if (next !== undefined && images.length < pageSize) incomplete = true;
      return { images, next, ...(incomplete ? { incomplete: true } : {}) };
    },
  };
}

const metadata = z.record(z.string(), z.object({ value: z.string() }));
const responseSchema = z.object({
  error: z.unknown().optional(),
  continue: z
    .object({ gsroffset: z.number().optional() })
    .passthrough()
    .optional(),
  query: z
    .object({
      searchinfo: z
        .object({ totalhits: z.number().int().nonnegative() })
        .optional(),
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
const commonsTopicFilters: Record<string, RegExp> = {
  space: /NASA|space|astronom|galax|planet|earth|moon/i,
  nature:
    /nature|landscape|wildlife|plant|Ansel|tree|forest|animal|bird|mountain|flower/i,
  art: /painting|\bart\b|sculpture|drawing|illustration|engraving/i,
  places:
    /architectur|building|cit(?:y|ies)|landmark|bridge|castle|church|street|mosque|town|village/i,
  history: /histor|archive|ancient|antiquit|medieval|manuscript/i,
};

export const commons = cacheImageProvider(
  fillImagePages({
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
    async search(
      query,
      signal,
      offset = 0,
      limit = providerPageSize,
      topic = null,
    ) {
      if (Date.now() < blockedUntil)
        throw new ProviderError("quota", blockedUntil - Date.now());
      const text =
        query.slice(0, providerQueryMaxLength) ||
        commons.browse.find((item) => item.id === topic)?.query ||
        "";
      const url = new URL("https://commons.wikimedia.org/w/api.php");
      url.search = new URLSearchParams({
        action: "query",
        format: "json",
        formatversion: "2",
        origin: "*",
        generator: "search",
        gsrsearch: `${text} filetype:bitmap haslicense:unrestricted`.trim(),
        gsrnamespace: "6",
        gsrinfo: "totalhits",
        gsrlimit: String(limit),
        gsroffset: String(offset),
        prop: "imageinfo",
        iiprop: "url|size|mime|extmetadata",
        iiurlwidth: "320",
        iiextmetadatalanguage: "en",
        iiextmetadatafilter:
          "Artist|LicenseShortName|LicenseUrl|Copyrighted|Restrictions|AttributionRequired|Categories",
      }).toString();
      const response = await fetch(url, {
        signal,
        credentials: "omit",
        referrerPolicy: "no-referrer",
      });
      if (response.status === 429) {
        const retry =
          response.headers.get("Retry-After") ??
          String(providerRetryDelayMs / 1000);
        const seconds = Number(retry);
        const wait = Number.isFinite(seconds)
          ? seconds * 1000
          : Date.parse(retry) - Date.now();
        blockedUntil =
          Date.now() +
          Math.max(
            providerMinimumRetryDelayMs,
            Number.isFinite(wait) ? wait : providerRetryDelayMs,
          );
        throw new ProviderError("quota", blockedUntil - Date.now());
      }
      if (!response.ok) throw new ProviderError("unavailable");
      const parsed = responseSchema.safeParse(await response.json());
      if (!parsed.success) throw new ProviderError("invalid");
      if (parsed.data.error) {
        const apiError = z
          .object({ code: z.string() })
          .safeParse(parsed.data.error);
        if (
          apiError.success &&
          ["cirrussearch-too-busy-error", "maxlag"].includes(apiError.data.code)
        )
          throw new ProviderError("busy");
        throw new ProviderError("invalid");
      }
      const images: ProviderImage[] = [];
      for (const page of (parsed.data.query?.pages ?? []).sort(
        (first, second) => (first.index ?? 0) - (second.index ?? 0),
      )) {
        const info = page.imageinfo?.[0];
        if (!info) continue;
        const meta = info.extmetadata;
        const topicFilter = commonsTopicFilters[topic ?? ""];
        if (
          topicFilter &&
          !topicFilter.test(
            `${page.title} ${plainText(meta.Categories?.value ?? "")}`,
          )
        )
          continue;
        const parsedLicense = imageLicenseSchema.safeParse(meta.LicenseShortName?.value);
        if (!parsedLicense.success) continue;
        const license = parsedLicense.data;
        const title = page.title.replace(/^File:/, "").replace(/\.[^.]+$/, "").slice(0, captionMaxLength);
        const creator = plainText(meta.Artist?.value ?? "");
        if (
          meta.Copyrighted?.value !== "False" ||
          meta.Restrictions?.value ||
          meta.AttributionRequired?.value === "true"
        )
          continue;
        if (
          !["image/jpeg", "image/png", "image/webp"].includes(info.mime) ||
          info.size > providerImageMaxBytes ||
          info.width * info.height > providerImageMaxPixels
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
          title,
          sourcePage: info.descriptionurl,
          creator,
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
      const rawCount = parsed.data.query?.pages.length ?? 0;
      const totalHits = parsed.data.query?.searchinfo?.totalhits ?? 0;
      return {
        images,
        next:
          parsed.data.continue?.gsroffset ??
          (rawCount === limit && totalHits > offset + rawCount
            ? offset + rawCount
            : undefined),
      };
    },
  }),
);

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
  const wait = metRequestIntervalMs - (Date.now() - metRequestTime);
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
    const retry =
      response.headers.get("Retry-After") ??
      String(providerRetryDelayMs / 1000);
    const seconds = Number(retry);
    const delay = Number.isFinite(seconds)
      ? seconds * 1000
      : Date.parse(retry) - Date.now();
    const duration = Math.max(
      providerMinimumRetryDelayMs,
      Number.isFinite(delay) ? delay : providerRetryDelayMs,
    );
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
  objectIDs: z
    .array(z.number().int().positive())
    .max(providerPageSize)
    .nullable(),
});
const metObjectSchema = z.object({
  objectID: z.number().int().positive(),
  isPublicDomain: z.boolean(),
  title: z.string().min(1),
  artistDisplayName: z.string(),
  primaryImage: z.url(),
  primaryImageSmall: z.url(),
  objectURL: z.url(),
  rightsAndReproduction: z.string().optional(),
  tags: z
    .array(z.object({ term: z.string() }))
    .nullable()
    .optional(),
});
const metTopicMediums: Record<string, string> = {
  paintings: "Paintings",
  sculpture: "Sculpture",
  prints: "Prints",
  ceramics: "Ceramics",
};

export const met = cacheImageProvider(
  fillImagePages({
    id: "met",
    name: "The Met",
    domain: "Art and cultural collections",
    policyUrl:
      "https://www.metmuseum.org/about-the-met/policies-and-documents/open-access",
    browse: museumTopics,
    capabilities: commons.capabilities,
    async search(
      query,
      signal,
      offset = 0,
      limit = providerPageSize,
      topic = null,
      onImages,
    ) {
      limit = Math.min(limit, metSearchResultLimit - offset);
      if (limit <= 0) return { images: [] };
      const url = new URL(
        "https://collectionapi.metmuseum.org/public/collection/v1.1/search",
      );
      url.search = new URLSearchParams({
        q:
          query.slice(0, providerQueryMaxLength) ||
          museumTopics.find((item) => item.id === topic)?.query ||
          "*",
        hasImages: "true",
        offset: String(offset),
        limit: String(limit),
      }).toString();
      const medium = metTopicMediums[topic ?? ""];
      if (medium) url.searchParams.set("medium", medium);
      const parsed = metSearchSchema.safeParse(await metJson(url, signal));
      if (!parsed.success) throw new ProviderError("invalid");
      const images: ProviderImage[] = [];
      for (const id of parsed.data.objectIDs ?? []) {
        const item = await providerQuery(
          ["provider-object", "met", id],
          async (requestSignal) => {
            const parsed = metObjectSchema.safeParse(
              await metJson(
                new URL(
                  `https://collectionapi.metmuseum.org/public/collection/v1/objects/${id}`,
                ),
                requestSignal,
              ),
            );
            return parsed.success ? parsed.data : null;
          },
          signal,
          (data) => (data ? providerFreshTime : 0),
        );
        if (!item) continue;
        if (
          !item.isPublicDomain ||
          (topic === "portraits" &&
            !item.tags?.some((tag) => /^portraits?$/i.test(tag.term))) ||
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
          title: item.title.slice(0, captionMaxLength),
          sourcePage: item.objectURL,
          creator: plainText(item.artistDisplayName),
          license: "CC0",
          licenseUrl: "https://creativecommons.org/publicdomain/zero/1.0/",
          thumbnail: item.primaryImageSmall,
          original: { url: item.primaryImage, mime: "image/jpeg" },
        });
        onImages?.(images.slice());
      }
      const count = parsed.data.objectIDs?.length ?? 0;
      const next = offset + count;
      return {
        images,
        next:
          count > 0 && next < Math.min(parsed.data.total, metSearchResultLimit)
            ? next
            : undefined,
      };
    },
  }),
);

async function catalogJson(url: URL, signal: AbortSignal): Promise<unknown> {
  const response = await fetch(url, { signal, credentials: "omit", referrerPolicy: "no-referrer" });
  if (response.status === 429) {
    const retry = response.headers.get("Retry-After");
    const seconds = Number(retry);
    const wait = retry === null ? providerRetryDelayMs :
      Number.isFinite(seconds) ? seconds * 1000 : Date.parse(retry) - Date.now();
    throw new ProviderError("quota", Math.max(providerMinimumRetryDelayMs, Number.isFinite(wait) ? wait : providerRetryDelayMs));
  }
  if (!response.ok) throw new ProviderError("unavailable");
  try {
    return await response.json();
  } catch (error) {
    signal.throwIfAborted();
    if (error instanceof SyntaxError) throw new ProviderError("invalid");
    throw error;
  }
}

function catalogProvider<Item>(
  metadata: Omit<ImageProvider, "search">,
  page: (query: string, topic: string | null, page: number, signal: AbortSignal) =>
    Promise<{ items: Item[]; total: number }>,
  imageFor: (item: Item) => ProviderImage | null,
): ImageProvider {
  return cacheImageProvider(fillImagePages({
    ...metadata,
    async search(query, signal, offset, limit, topic = null) {
      const batch = await page(query, topic, Math.floor(offset / providerPageSize), signal);
      const images: ProviderImage[] = [];
      let cursor = offset % providerPageSize;
      while (cursor < batch.items.length && images.length < limit) {
        const image = imageFor(batch.items[cursor++]!);
        if (!image) continue;
        if (!provenanceSchema.safeParse({
          provider: image.provider, entityId: image.id, sourcePage: image.sourcePage,
          originalUrl: image.original.url, creator: image.creator, license: image.license,
          licenseUrl: image.licenseUrl,
        }).success || (image.original.size ?? 0) > providerImageMaxBytes ||
          (image.original.width ?? 0) * (image.original.height ?? 0) > providerImageMaxPixels) continue;
        images.push(image);
      }
      const next = Math.floor(offset / providerPageSize) * providerPageSize + cursor;
      return { images, next: cursor > offset % providerPageSize && next < batch.total ? next : undefined };
    },
  }));
}

const smkSchema = z.object({
  found: z.number().int().nonnegative(),
  items: z.array(z.object({
    object_number: z.string(),
    frontend_url: z.string().optional(),
    titles: z.array(z.object({ title: z.string() })).optional(),
    artist: z.array(z.string()).optional(),
    public_domain: z.boolean().optional(),
    rights: z.string().optional(),
    image_iiif_id: z.string().optional(),
    image_width: z.number().positive().optional(),
    image_height: z.number().positive().optional(),
  })),
});

export const smk = catalogProvider(
  {
    id: "smk", name: "SMK", domain: "National Gallery of Denmark",
    policyUrl: "https://www.smk.dk/en/article/smk-open/",
    browse: [], capabilities: commons.capabilities,
  },
  async (query, _topic, page, signal) => {
    const url = new URL("https://api.smk.dk/api/v1/art/search");
    url.search = new URLSearchParams({
      keys: query || "*",
      offset: String(page * providerPageSize), rows: String(providerPageSize),
      filters: "public_domain:true,has_image:true",
    }).toString();
    const result = smkSchema.safeParse(await catalogJson(url, signal));
    if (!result.success) throw new ProviderError("invalid");
    return { items: result.data.items, total: result.data.found };
  },
  (item) => {
    if (!item.public_domain || !item.image_iiif_id ||
      !isProviderUrl("smk", "image", item.image_iiif_id) ||
      item.rights !== "https://creativecommons.org/publicdomain/mark/1.0/") return null;
    const scale = item.image_width && item.image_height ?
      Math.min(1, 4000 / Math.max(item.image_width, item.image_height)) : undefined;
    return {
      provider: "smk", id: item.object_number,
      title: (item.titles?.[0]?.title || item.object_number).slice(0, 1000),
      sourcePage: item.frontend_url || `https://open.smk.dk/artwork/image/${encodeURIComponent(item.object_number)}`,
      creator: (item.artist ?? []).join(", ").slice(0, 1000),
      license: "Public domain", licenseUrl: item.rights,
      thumbnail: `${item.image_iiif_id}/full/!400,400/0/default.jpg`,
      original: {
        url: `${item.image_iiif_id}/full/!4000,4000/0/default.jpg`, mime: "image/jpeg",
        ...(scale && item.image_width && item.image_height ? {
          width: Math.round(item.image_width * scale), height: Math.round(item.image_height * scale),
        } : {}),
      },
    };
  },
);

const natureTopics: ImageProvider["browse"] = [
  { id: "animals", query: "animals" }, { id: "birds", query: "birds" }, { id: "plants", query: "plants" },
];
const observationSchema = z.object({
  total_results: z.number().int().nonnegative(),
  results: z.array(z.object({
    taxon: z.object({ name: z.string(), preferred_common_name: z.string().optional() }).nullable().optional(),
    photos: z.array(z.object({
      id: z.number().int().positive(), url: z.string(), license_code: z.string().nullable(),
      attribution: z.string(), hidden: z.boolean().optional(),
      original_dimensions: z.object({ width: z.number().positive(), height: z.number().positive() }),
    })),
  })),
});

export const inaturalist = catalogProvider(
  {
    id: "inaturalist", name: "iNaturalist", domain: "Wildlife and plants",
    policyUrl: "https://www.inaturalist.org/pages/terms",
    browse: natureTopics, capabilities: commons.capabilities,
  },
  async (query, topic, page, signal) => {
    const url = new URL("https://api.inaturalist.org/v1/observations");
    url.search = new URLSearchParams({
      photos: "true", photo_license: "cc0", per_page: String(providerPageSize),
      page: String(page + 1), order_by: "id", order: "desc",
    }).toString();
    if (query) url.searchParams.set("taxon_name", query);
    const taxon = topic === "birds" ? "3" : topic === "plants" ? "47126" : topic === "animals" ? "1" : null;
    if (taxon) url.searchParams.set("taxon_id", taxon);
    const result = observationSchema.safeParse(await catalogJson(url, signal));
    if (!result.success) throw new ProviderError("invalid");
    return { items: result.data.results, total: Math.min(10000, result.data.total_results) };
  },
  (item) => {
    const photo = item.photos.find((photo) => photo.license_code === "cc0" && !photo.hidden &&
      isProviderUrl("inaturalist", "image", photo.url) && /\/square\.(jpg|jpeg|png)$/i.test(new URL(photo.url).pathname));
    if (!photo) return null;
    const mime = /\.png$/i.test(new URL(photo.url).pathname) ? "image/png" : "image/jpeg";
    return {
      provider: "inaturalist", id: String(photo.id),
      title: (item.taxon?.preferred_common_name || item.taxon?.name || "Wildlife").slice(0, 1000),
      sourcePage: `https://www.inaturalist.org/photos/${photo.id}`,
      creator: photo.attribution.slice(0, 1000), license: "CC0",
      licenseUrl: "https://creativecommons.org/publicdomain/zero/1.0/",
      thumbnail: photo.url.replace(/\/square\./, "/medium."),
      original: { url: photo.url.replace(/\/square\./, "/original."), mime, ...photo.original_dimensions },
    };
  },
);

const openverseSchema = z.object({
  result_count: z.number().int().nonnegative(),
  page_count: z.number().int().nonnegative(),
  results: z.array(z.object({
    id: z.uuid(), title: z.string().nullable(), creator: z.string().nullable(),
    url: z.string(), foreign_landing_url: z.string(),
    license: z.string(), license_version: z.string(), license_url: z.string(),
    width: z.number().positive().nullable(), height: z.number().positive().nullable(),
    filesize: z.number().nonnegative().nullable().optional(), mature: z.boolean().optional(),
  })),
});
export const openverse = catalogProvider(
  {
    id: "openverse", name: "Openverse", domain: "Flickr and Wikimedia images",
    policyUrl: "https://openverse.org/about",
    browse: [], capabilities: commons.capabilities,
  },
  async (query, _topic, page, signal) => {
    const url = new URL("https://api.openverse.org/v1/images/");
    url.search = new URLSearchParams({
      q: query || "nature",
      license: "cc0,pdm", source: "flickr,wikimedia", mature: "false",
      page_size: String(providerPageSize), page: String(page + 1),
    }).toString();
    const result = openverseSchema.safeParse(await catalogJson(url, signal));
    if (!result.success) throw new ProviderError("invalid");
    return { items: result.data.results, total: Math.min(result.data.result_count, result.data.page_count * providerPageSize) };
  },
  (item) => {
    if (item.mature || !isProviderUrl("openverse", "image", item.url)) return null;
    const license = imageLicenseSchema.safeParse(
      item.license === "cc0" ? "CC0" : item.license === "pdm" ? "Public domain" : "",
    );
    if (!license.success) return null;
    const extension = new URL(item.url).pathname.match(/\.(jpe?g|png|webp)$/i)?.[1]?.toLowerCase();
    if (!extension) return null;
    return {
      provider: "openverse", id: item.id, title: plainText(item.title || "Image"),
      sourcePage: item.foreign_landing_url, creator: plainText(item.creator || ""),
      license: license.data, licenseUrl: item.license_url,
      thumbnail: `https://api.openverse.org/v1/images/${item.id}/thumb/`,
      original: {
        url: item.url, mime: extension === "png" ? "image/png" : extension === "webp" ? "image/webp" : "image/jpeg",
        ...(item.width && item.height ? { width: item.width, height: item.height } : {}),
        ...(item.filesize !== null && item.filesize !== undefined ? { size: item.filesize } : {}),
      },
    };
  },
);

export const imageProviders: readonly ImageProvider[] = [commons, met, smk, inaturalist, openverse];

export async function downloadProviderImage(
  image: ProviderImage,
  signal: AbortSignal,
): Promise<{ blob: Blob; provenance: NonNullable<Asset["provenance"]> }> {
  if (!imageLicenseSchema.safeParse(image.license).success)
    throw new ProviderError("invalid");
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
    signal: AbortSignal.any([
      signal,
      AbortSignal.timeout(providerDownloadTimeoutMs),
    ]),
    credentials: "omit",
    referrerPolicy: "no-referrer",
    redirect: "error",
  });
  if (
    !response.ok ||
    (response.url &&
      !isProviderUrl(image.provider, "image", response.url)) ||
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
      if (size > providerImageMaxBytes) throw new ProviderError("invalid");
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
