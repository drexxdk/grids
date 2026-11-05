import { useEffect, useMemo, useRef, useState } from "react";
import { ImageOff, LoaderCircle } from "lucide-react";
import { createExport, dimensions, sharedCaptionRows } from "../export";
import { presetPreviewWorkspace, type starterPresets } from "../presets";
import { t } from "../i18n";

type Thumbnail =
  | { key: string; url: string; width: number; height: number; error?: never }
  | { key: string; error: string; url?: never };

export function ThemeThumbnail({
  theme,
  name,
  rows,
  columns,
}: {
  theme: (typeof starterPresets)[number];
  name: string;
  rows: number;
  columns: number;
}) {
  const element = useRef<HTMLSpanElement>(null);
  const [visible, setVisible] = useState(false);
  const [thumbnail, setThumbnail] = useState<Thumbnail | null>(null);
  const previewRows = Math.min(3, rows);
  const previewColumns = Math.min(3, columns);
  const preview = useMemo(
    () =>
      presetPreviewWorkspace(
        { ...theme, name },
        {
          rows: previewRows,
          columns: previewColumns,
        },
      ),
    [theme, name, previewRows, previewColumns],
  );
  const size = Math.floor(512 / Math.max(previewRows, previewColumns));
  const key = `${theme.id}:${name}:${previewRows}:${previewColumns}`;
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
    void createExport(
      preview.grid,
      preview.assets,
      size,
      "image/png",
      0.95,
      2_000_000,
    )
      .then((blob) => {
        if (cancelled) return;
        url = URL.createObjectURL(blob);
        const { width, height } = dimensions(
          preview.grid,
          size,
          sharedCaptionRows(preview.grid, preview.assets),
        );
        setThumbnail({ key, url, width, height });
      })
      .catch((reason: unknown) => {
        if (!cancelled)
          setThumbnail({
            key,
            error:
              reason instanceof Error
                ? reason.message
                : t("presets.thumbnailError"),
          });
      });
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [visible, preview, size, key]);
  return (
    <span
      ref={element}
      data-theme-thumbnail
      data-card-content
      data-thumbnail-state={
        current?.url ? "ready" : current?.error ? "error" : "loading"
      }
      aria-label={t("presets.thumbnailNamed", { name })}
      role="img"
      style={{ backgroundColor: theme.settings.style.background }}
      className="relative flex aspect-8/5 min-h-11 w-full items-center justify-center overflow-hidden"
    >
      {current?.url ? (
        <img
          src={current.url}
          alt=""
          draggable={false}
          className="absolute inset-0 block h-full w-full object-contain"
          onError={() =>
            setThumbnail({ key, error: t("presets.thumbnailError") })
          }
        />
      ) : current?.error ? (
        <span
          title={current.error}
          className="flex flex-col items-center gap-1 text-xs"
        >
          <ImageOff aria-hidden="true" className="size-5!" />
          {t("presets.thumbnailError")}
        </span>
      ) : (
        <LoaderCircle
          aria-hidden="true"
          className="size-5! motion-safe:animate-spin"
        />
      )}
    </span>
  );
}
