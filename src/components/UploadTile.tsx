import { ImagePlus, LoaderCircle } from "lucide-react";
import { useState, type Ref } from "react";
import { cellGeometry, type GridStyle } from "../model";
import { CardFrame } from "./CardFrame";

export function UploadTile({
  progress,
  gridStyle,
  captionRows,
  className = "tw:self-start tw:w-full",
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
    <button
      ref={ref}
      data-upload-tile
      type="button"
      aria-label="Add images"
      disabled={progress !== null}
      title="Add or drop images"
      className={`image-card tw:@container tw:relative tw:shrink-0 tw:rounded-(--card-radius)! tw:border! tw:border-solid! tw:p-0! tw:text-(--muted) tw:outline-none! tw:[--card-frame-color:transparent] tw:data-[image-hovered]:[--card-frame-color:var(--accent)] tw:focus-visible:[--card-frame-color:var(--accent)] tw:disabled:cursor-default! tw:disabled:opacity-100! tw:disabled:text-(--text)! ${className}`}
      style={{
        aspectRatio: `600 / ${geometry.height}`,
        backgroundColor: gridStyle.cellBackgroundColor ?? "#111315",
        borderColor: "var(--line)",
      }}
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
        style={{ backgroundColor: gridStyle.cellBackgroundColor ?? "#111315" }}
        className="tw:absolute tw:inset-0 tw:flex tw:flex-col tw:items-center tw:justify-center tw:gap-[3cqw] tw:overflow-hidden tw:rounded-[calc(var(--card-radius)-1px)] tw:[&_svg]:size-[18cqw]!"
      >
        {progress ? (
          <>
            <LoaderCircle
              aria-hidden="true"
              className="tw:animate-spin tw:motion-reduce:animate-none"
            />
            <span
              role="status"
              aria-live="polite"
              className="tw:flex tw:flex-col tw:items-center tw:gap-[3cqw]"
            >
              <span className="tw:text-[8.5cqw]">Importing...</span>
              <span className="tw:text-[7cqw]">
                {progress.completed} / {progress.total}
              </span>
            </span>
          </>
        ) : (
          <>
            <ImagePlus aria-hidden="true" />
            <span data-upload-label className="tw:text-[8.5cqw]">
              Add images
            </span>
            <span data-upload-label className="tw:text-[7cqw]">
              Drop here
            </span>
          </>
        )}
      </span>
      <CardFrame />
    </button>
  );
}
