import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ComponentProps,
} from "react";
import {
  ArrowLeft,
  ArrowRight,
  Orbit,
  Leaf,
  Palette,
  Landmark,
  History,
  UserRound,
  Layers,
  Coffee,
  Search,
} from "lucide-react";
import { t } from "../i18n";
import {
  type ImageProvider,
  ProviderError,
  providerPreviewUrl,
  downloadProviderImage,
  type ProviderImage,
} from "../providers";
import { Button } from "./ui/controls";
import { LibraryImage } from "./LibraryImage";
import type { CardDragSource } from "./GridCell";

const topicIcons = {
  space: Orbit,
  nature: Leaf,
  art: Palette,
  places: Landmark,
  history: History,
  paintings: Palette,
  sculpture: Landmark,
  portraits: UserRound,
  prints: Layers,
  ceramics: Coffee,
};

function OnlineImage({
  image,
  asset,
  ...props
}: { image: ProviderImage } & ComponentProps<typeof LibraryImage>) {
  const element = useRef<HTMLDivElement>(null);
  const [viewport, setViewport] = useState({ width: 0, density: 1 });
  const [thumbnailSize, setThumbnailSize] = useState<{
    width: number;
    height: number;
  }>();
  const [failedPreview, setFailedPreview] = useState("");
  const [originalPreview, setOriginalPreview] = useState<{
    source: string;
    url: string;
  }>();
  useLayoutEffect(() => {
    const root = element.current;
    if (!root) return;
    const measure = () => {
      const width = root.getBoundingClientRect().width;
      if (width > 0)
        setViewport({ width, density: window.devicePixelRatio || 1 });
    };
    const observer = new ResizeObserver(measure);
    observer.observe(root);
    let densityQuery = window.matchMedia(
      `(resolution: ${window.devicePixelRatio}dppx)`,
    );
    const densityChanged = () => {
      densityQuery.removeEventListener("change", densityChanged);
      densityQuery = window.matchMedia(
        `(resolution: ${window.devicePixelRatio}dppx)`,
      );
      densityQuery.addEventListener("change", densityChanged);
      measure();
    };
    densityQuery.addEventListener("change", densityChanged);
    window.addEventListener("resize", measure);
    measure();
    return () => {
      observer.disconnect();
      densityQuery.removeEventListener("change", densityChanged);
      window.removeEventListener("resize", measure);
    };
  }, []);
  const selectedSrc = viewport.width
    ? providerPreviewUrl(image, viewport.width, viewport.density, thumbnailSize)
    : "";
  const needsOriginal =
    image.provider === "met" && selectedSrc === image.original.url;
  const originalUrl = image.original.url;
  useEffect(() => {
    if (!needsOriginal) return;
    const controller = new AbortController();
    let url = "";
    void downloadProviderImage(image, controller.signal)
      .then(async ({ blob }) => {
        controller.signal.throwIfAborted();
        url = URL.createObjectURL(blob);
        const decoded = new Image();
        decoded.src = url;
        await decoded.decode();
        controller.signal.throwIfAborted();
        if (decoded.naturalWidth * decoded.naturalHeight > 40000000)
          throw new Error("Image dimensions are too large");
        setOriginalPreview({ source: originalUrl, url });
      })
      .catch(() => {
        if (url) URL.revokeObjectURL(url);
      });
    return () => {
      controller.abort();
      if (url) URL.revokeObjectURL(url);
      setOriginalPreview(undefined);
    };
  }, [needsOriginal, originalUrl]);
  const src = needsOriginal
    ? originalPreview?.source === originalUrl
      ? originalPreview.url
      : image.thumbnail
    : selectedSrc && selectedSrc === failedPreview
      ? image.thumbnail
      : selectedSrc;
  return (
    <LibraryImage
      {...props}
      elementRef={element}
      asset={{ ...asset, src }}
      onImageLoad={(loaded) => {
        if (image.provider === "met" && loaded.src === image.thumbnail)
          setThumbnailSize({
            width: loaded.naturalWidth,
            height: loaded.naturalHeight,
          });
      }}
      onImageError={(loaded) => {
        if (loaded.src !== image.thumbnail) setFailedPreview(loaded.src);
      }}
    />
  );
}

export function OnlineImages({
  provider,
  onImport,
  selectionOnly = false,
  gridClassName = "grid grid-cols-2 gap-2.5",
  dragSource,
  ...cardProps
}: {
  provider: ImageProvider;
  onImport: (image: ProviderImage, signal: AbortSignal) => Promise<void>;
  selectionOnly?: boolean;
  gridClassName?: string;
  dragSource?: CardDragSource;
} & Pick<
  ComponentProps<typeof LibraryImage>,
  "gridStyle" | "captionRows" | "moving" | "onMoveStart" | "onTouchDrag"
>) {
  const [query, setQuery] = useState("");
  const [filtering, setFiltering] = useState(false);
  const [selectedTopic, setSelectedTopic] = useState<string | null>(
    provider.browse[0]?.id ?? null,
  );
  const [request, setRequest] = useState<{
    query: string;
    offset: number;
  } | null>(() =>
    provider.browse[0] ? { query: provider.browse[0].query, offset: 0 } : null,
  );
  const [images, setImages] = useState<ProviderImage[]>([]);
  const [next, setNext] = useState<number>();
  const [history, setHistory] = useState<number[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [importing, setImporting] = useState<string | null>(null);
  const importController = useRef<AbortController | null>(null);
  useEffect(() => () => importController.current?.abort(), []);
  const importImage = async (image: ProviderImage) => {
    const controller = new AbortController();
    importController.current = controller;
    setImporting(image.id);
    setError("");
    try {
      await onImport(image, controller.signal);
    } catch {
      if (!controller.signal.aborted) setError(t("library.search.failed"));
    } finally {
      if (!controller.signal.aborted) setImporting(null);
    }
  };
  useEffect(() => {
    if (selectedTopic !== null) return;
    const timer = window.setTimeout(() => {
      const filter = query.trim();
      const fallback = provider.browse[0];
      const nextRequest = filter
        ? { query: filter, offset: 0 }
        : fallback
          ? { query: fallback.query, offset: 0 }
          : null;
      setFiltering(false);
      setLoading(nextRequest !== null);
      setHistory([]);
      if (!filter) setSelectedTopic(fallback?.id ?? null);
      setRequest(nextRequest);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [provider, query, selectedTopic]);
  useEffect(() => {
    if (!request) {
      setImages([]);
      setNext(undefined);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    setError("");
    setImages([]);
    setNext(undefined);
    provider
      .search(request.query, controller.signal, request.offset)
      .then((result) => {
        if (controller.signal.aborted) return;
        setImages(result.images);
        setNext(result.next);
      })
      .catch((failure: unknown) => {
        if (controller.signal.aborted) return;
        setError(
          !navigator.onLine
            ? t("library.search.offline")
            : failure instanceof ProviderError
              ? t(`library.search.${failure.kind}`, { value1: provider.name })
              : t("library.search.unavailable", { value1: provider.name }),
        );
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [provider, request]);

  return (
    <section
      aria-label={t("library.source.online")}
      aria-busy={loading || filtering}
      className="min-w-0"
    >
      <div className="relative mb-2">
        <Search
          aria-hidden="true"
          className="pointer-events-none absolute top-1/2 left-3 size-4! -translate-y-1/2 text-(--muted)"
        />
        <input
          type="search"
          aria-label={t("library.search.query")}
          placeholder={t("library.search.query")}
          value={query}
          maxLength={160}
          onChange={(event) => {
            setQuery(event.target.value);
            setSelectedTopic(null);
            setFiltering(true);
            setError("");
          }}
          className="min-h-11 w-full min-w-0 pl-10! focus:outline-none! focus:border-(--accent)"
        />
      </div>
      <div
        role="group"
        aria-label={t("library.browse.title")}
        className="mb-3 flex flex-wrap gap-1"
      >
        {provider.browse.map((topic) => {
          const Icon = topicIcons[topic.id];
          return (
            <Button
              key={topic.id}
              title={t(`library.browse.${topic.id}`)}
              aria-pressed={selectedTopic === topic.id}
              disabled={selectedTopic === topic.id && !error}
              className="size-8! p-0! aria-pressed:bg-(--selected)! aria-pressed:text-(--accent) disabled:opacity-100! [&_svg]:size-4!"
              onClick={() => {
                setFiltering(false);
                setSelectedTopic(topic.id);
                setQuery("");
                setHistory([]);
                setRequest({ query: topic.query, offset: 0 });
              }}
            >
              <Icon aria-hidden="true" />
              <span className="sr-only">{t(`library.browse.${topic.id}`)}</span>
            </Button>
          );
        })}
      </div>
      {error && (
        <p role="alert" className="text-sm">
          {error}
        </p>
      )}
      <div role="status" className="text-sm" aria-live="polite">
        {loading
          ? t("library.search.loading")
          : request && !error && !images.length
            ? t("library.search.empty")
            : ""}
      </div>
      <div className={gridClassName}>
        {images.map((image) => (
          <OnlineImage
            key={image.id}
            image={image}
            {...cardProps}
            asset={{
              id: `provider:${image.provider}:${image.id}`,
              category: "",
              title: image.title,
              src: image.thumbnail,
              provenance: {
                provider: image.provider,
                entityId: image.id,
                sourcePage: image.sourcePage,
                originalUrl: image.original.url,
                creator: image.creator,
                license: image.license,
                licenseUrl: image.licenseUrl,
              },
            }}
            className="w-full"
            disabled={importing !== null}
            onTitle={(title) =>
              setImages((current) =>
                current.map((item) =>
                  item.id === image.id ? { ...item, title } : item,
                ),
              )
            }
            onDelete={() => {}}
            onImport={() => {
              void importImage(image);
            }}
            onSelect={
              selectionOnly
                ? () => {
                    void importImage(image);
                  }
                : undefined
            }
            source={{ kind: "provider", image }}
            dragAffected={
              dragSource?.kind === "provider" &&
              dragSource.image.provider === image.provider &&
              dragSource.image.id === image.id
            }
          />
        ))}
      </div>
      {request && !loading && (
        <div className="mt-3 flex justify-between gap-2">
          <Button
            aria-label={t("library.search.previous")}
            title={t("library.search.previous")}
            disabled={!history.length}
            onClick={() => {
              setRequest({
                query: request.query,
                offset: history[history.length - 1]!,
              });
              setHistory(history.slice(0, -1));
            }}
          >
            <ArrowLeft aria-hidden="true" />
          </Button>
          <Button
            aria-label={t("library.search.next")}
            title={t("library.search.next")}
            disabled={next === undefined}
            onClick={() => {
              if (next === undefined) return;
              setHistory([...history, request.offset]);
              setRequest({ query: request.query, offset: next });
            }}
          >
            <ArrowRight aria-hidden="true" />
          </Button>
        </div>
      )}
    </section>
  );
}
