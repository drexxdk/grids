import { useEffect, useRef, useState } from "react";
import { ImageOff, LoaderCircle } from "lucide-react";
import { createExport } from "../export";
import { presetPreviewWorkspace, type starterPresets } from "../presets";
import { t } from "../i18n";

type Thumbnail = { key: string; url: string; error?: never } | { key: string; error: string; url?: never };

export function ThemeThumbnail({ theme, name, rows, columns }: {
  theme: (typeof starterPresets)[number];
  name: string;
  rows: number;
  columns: number;
}) {
  const element = useRef<HTMLSpanElement>(null);
  const [visible, setVisible] = useState(false);
  const [thumbnail, setThumbnail] = useState<Thumbnail | null>(null);
  const key = `${theme.id}:${name}:${rows}:${columns}`;
  const current = thumbnail?.key === key ? thumbnail : null;
  useEffect(() => {
    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      setVisible(true);
      observer.disconnect();
    });
    if (element.current) observer.observe(element.current);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    let url = "";
    const preview = presetPreviewWorkspace({ ...theme, name }, { rows, columns });
    const size = Math.max(16, Math.floor(512 / Math.max(rows, columns)));
    void createExport(preview.grid, preview.assets, size, "image/png", 0.95, 2_000_000)
      .then((blob) => {
        if (cancelled) return;
        url = URL.createObjectURL(blob);
        setThumbnail({ key, url });
      })
      .catch((reason: unknown) => {
        if (!cancelled) setThumbnail({ key, error: reason instanceof Error ? reason.message : t("presets.thumbnailError") });
      });
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [visible, theme, name, rows, columns, key]);
  return <span ref={element} data-theme-thumbnail
    data-thumbnail-state={current?.url ? "ready" : current?.error ? "error" : "loading"}
    aria-label={t("presets.thumbnailNamed", { name })} role="img"
    className="flex aspect-square w-full shrink-0 items-center justify-center overflow-hidden">
    {current?.url ? <img src={current.url} alt="" draggable={false} className="block h-full w-full object-contain"
      onError={() => setThumbnail({ key, error: t("presets.thumbnailError") })} /> :
      current?.error ? <span title={current.error} className="flex flex-col items-center gap-1 text-xs text-(--muted)">
        <ImageOff aria-hidden="true" className="size-5!" />{t("presets.thumbnailError")}
      </span> : <LoaderCircle aria-hidden="true" className="size-5! text-(--muted) motion-safe:animate-spin" />}
  </span>;
}
