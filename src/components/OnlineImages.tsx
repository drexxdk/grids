import { useEffect, useId, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Download,
  ExternalLink,
  LoaderCircle,
  Orbit,
  Leaf,
  Palette,
  Landmark,
  History,
  Search,
} from "lucide-react";
import { t } from "../i18n";
import {
  imageProviders,
  ProviderError,
  type ProviderImage,
} from "../providers";
import { Button, SelectField } from "./ui/controls";

const topicIcons = {
  space: Orbit,
  nature: Leaf,
  art: Palette,
  places: Landmark,
  history: History,
};

export function OnlineImages({
  onImport,
}: {
  onImport: (image: ProviderImage, signal: AbortSignal) => Promise<void>;
}) {
  const provider = imageProviders[0]!;
  const providerId = useId();
  const searchLabelId = useId();
  const [query, setQuery] = useState("");
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
  useEffect(() => {
    if (!request) return;
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
              ? t(`library.search.${failure.kind}`)
              : t("library.search.unavailable"),
        );
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [provider, request]);

  return (
    <section aria-label={t("library.source.online")} className="min-w-0">
      <SelectField
        id={providerId}
        label={t("library.search.provider")}
        value={provider.id}
        onChange={() => {}}
        options={imageProviders.map((item) => ({
          value: item.id,
          label: item.name,
        }))}
      />
      <p className="my-2 text-xs leading-5 text-(--muted)">
        {t("library.search.privacy")}
      </p>
      <form
        className="mb-3 flex items-end gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          if (!query.trim()) return;
          setHistory([]);
          setSelectedTopic(null);
          setRequest({ query: query.trim(), offset: 0 });
        }}
      >
        <div className="min-w-0 flex-1 text-sm">
          <span id={searchLabelId}>{t("library.search.query")}</span>
          <input
            type="search"
            aria-labelledby={searchLabelId}
            value={query}
            maxLength={160}
            onChange={(event) => setQuery(event.target.value)}
            className="mt-1 min-h-11 w-full min-w-0 focus:outline-none! focus:border-(--accent)"
          />
        </div>
        <Button
          type="submit"
          disabled={!query.trim()}
          title={t("library.search.submit")}
          aria-label={t("library.search.submit")}
          className="size-11! shrink-0 p-0!"
        >
          <Search aria-hidden="true" />
        </Button>
      </form>
      <div
        role="group"
        aria-label={t("library.browse.title")}
        className="mb-3 flex flex-wrap gap-2"
      >
        {provider.browse.map((topic) => {
          const Icon = topicIcons[topic.id];
          return (
            <Button
              key={topic.id}
              aria-pressed={selectedTopic === topic.id}
              disabled={selectedTopic === topic.id && !error}
              className="min-h-11 gap-1! px-2! text-xs! aria-pressed:bg-(--selected)! aria-pressed:text-(--accent) disabled:opacity-100! [&_svg]:size-4!"
              onClick={() => {
                setSelectedTopic(topic.id);
                setQuery("");
                setHistory([]);
                setRequest({ query: topic.query, offset: 0 });
              }}
            >
              <Icon aria-hidden="true" />
              {t(`library.browse.${topic.id}`)}
            </Button>
          );
        })}
      </div>
      <p className="mb-3 text-xs text-(--muted)">
        {t("library.search.rights")}
      </p>
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
      <div className="grid grid-cols-2 gap-3 min-[700px]:in-data-modal-scroll:grid-cols-3">
        {images.map((image) => (
          <article
            key={image.id}
            className="min-w-0 overflow-hidden rounded-md border border-solid border-(--line)"
          >
            <img
              src={image.thumbnail}
              alt={image.title}
              loading="lazy"
              referrerPolicy="no-referrer"
              className="block aspect-square w-full object-contain bg-(--bg)"
            />
            <div className="p-2">
              <h3 className="m-0 text-sm! leading-5! wrap-break-word">
                {image.title}
              </h3>
              {image.creator && (
                <p className="my-1 text-xs text-(--muted) wrap-break-word">
                  {image.creator}
                </p>
              )}
              <a
                href={image.sourcePage}
                target="_blank"
                rel="noreferrer"
                className="my-2 flex items-center gap-1 text-xs text-(--accent)"
              >
                <ExternalLink aria-hidden="true" className="size-3! shrink-0" />
                {t("library.search.source")}
              </a>
              <span className="block text-xs text-(--muted)">
                {image.license} &middot; {image.original.width} &times;{" "}
                {image.original.height}
              </span>
              <Button
                aria-label={t("library.search.import", { value1: image.title })}
                title={t("library.search.import", { value1: image.title })}
                disabled={importing !== null}
                className="mt-2 min-h-11 w-full"
                onClick={async () => {
                  const controller = new AbortController();
                  importController.current = controller;
                  setImporting(image.id);
                  setError("");
                  try {
                    await onImport(image, controller.signal);
                  } catch {
                    if (!controller.signal.aborted)
                      setError(t("library.search.failed"));
                  } finally {
                    if (!controller.signal.aborted) setImporting(null);
                  }
                }}
              >
                {importing === image.id ? (
                  <LoaderCircle aria-hidden="true" className="animate-spin" />
                ) : (
                  <Download aria-hidden="true" />
                )}
              </Button>
            </div>
          </article>
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
