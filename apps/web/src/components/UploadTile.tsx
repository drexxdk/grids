import { t } from "../i18n";
import { ImagePlus, LoaderCircle } from "lucide-react";
import { useState, type CSSProperties, type Ref } from "react";
import { cellGeometry, type GridStyle } from "../model";
import { CardFrame } from "./CardFrame";
import { isLightCanvasColor } from "../canvasTheme";

export function UploadTile({
  progress,
  gridStyle,
  captionRows,
  className = "self-start w-full",
  onClick,
  onDropFiles,
  ref,
}: {
  progress: { completed: number; total: number } | null;
  gridStyle: GridStyle;
  captionRows: number;
  className?: string;
  onClick: () => void;
  onDropFiles: (files: FileList) => void;
  ref?: Ref<HTMLButtonElement>;
}) {
  const geometry = cellGeometry(gridStyle, 600, captionRows);
  const [hovered, setHovered] = useState(false);
  return (
    <div
      className={`min-w-0 max-[901px]:shrink-0 ${className}`}
      style={{ aspectRatio: `600 / ${geometry.height}` }}
    >
      <button
        ref={ref}
        data-upload-tile
        type="button"
        aria-label={t("common.actions.addImages", { count: 2 })}
        disabled={progress !== null}
        title={t("common.actions.addOrDropImages", { count: 2 })}
        className={`image-card @container relative size-full border! border-solid! p-0! text-(--muted) outline-none! [--card-frame-color:transparent] data-image-hovered:[--card-frame-color:var(--accent)] focus-visible:[--card-frame-color:var(--accent)] disabled:cursor-default! disabled:opacity-100!`}
        style={
          {
            aspectRatio: `600 / ${geometry.height}`,
            "--card-radius": `${gridStyle.cornerRadius ?? 12.5}cqw`,
            borderRadius: `${gridStyle.cornerRadius ?? 12.5}% / ${((gridStyle.cornerRadius ?? 12.5) * 600) / geometry.height}%`,
            backgroundColor: gridStyle.cellBackgroundColor ?? "#111315",
            color: isLightCanvasColor(
              gridStyle.cellBackgroundColor ?? "#111315",
            )
              ? "#202325"
              : "#eef1f3",
            borderColor: "var(--line)",
          } as CSSProperties
        }
        data-image-hovered={hovered && !progress ? "" : undefined}
        onPointerEnter={(event) => {
          if (event.pointerType === "mouse") setHovered(true);
        }}
        onPointerLeave={() => setHovered(false)}
        onClick={onClick}
        onDragOver={(event) => {
          if (!progress && event.dataTransfer.types.includes("Files")) {
            event.preventDefault();
            event.dataTransfer.dropEffect = "copy";
            setHovered(true);
          }
        }}
        onDrop={(event) => {
          event.preventDefault();
          event.stopPropagation();
          setHovered(false);
          if (!progress && event.dataTransfer.files.length)
            onDropFiles(event.dataTransfer.files);
        }}
      >
        <span
          data-card-content
          style={{
            backgroundColor: gridStyle.cellBackgroundColor ?? "#111315",
          }}
          className="absolute inset-0 flex flex-col items-center justify-center gap-[3cqw] overflow-hidden rounded-[calc(var(--card-radius)-1px)] [&_svg]:size-[18cqw]!"
        >
          {progress ? (
            <>
              <LoaderCircle
                aria-hidden="true"
                className="animate-spin motion-reduce:animate-none"
              />
              <span
                role="status"
                aria-live="polite"
                className="flex flex-col items-center gap-[3cqw]"
              >
                <span className="text-[8.5cqw]">{t("library.importing")}</span>
                <span className="text-[7cqw]">
                  {progress.completed} / {progress.total}
                </span>
              </span>
            </>
          ) : (
            <>
              <ImagePlus aria-hidden="true" />
              <span data-upload-label className="text-[8.5cqw]">
                {t("common.actions.addImages", { count: 2 })}
              </span>
              <span data-upload-label className="text-[7cqw]">
                {t("common.actions.dropHere")}
              </span>
            </>
          )}
        </span>
        <CardFrame />
      </button>
    </div>
  );
}
