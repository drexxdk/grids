import { cellGeometry, type Asset, type Cell, type GridStyle } from "../model";
import { captionMaxLength } from "../config";
import type { CSSProperties, Ref } from "react";
import { LoaderCircle } from "lucide-react";
import { GridCell, type CardDragSource, type CardDragVisual } from "./GridCell";

export function LibraryImagePlaceholder({
  gridStyle,
  captionRows,
  loading = false,
  className = "",
}: {
  gridStyle: GridStyle;
  captionRows: number;
  loading?: boolean;
  className?: string;
}) {
  const geometry = cellGeometry(gridStyle, 600, captionRows);
  return (
    <div
      data-image-placeholder
      data-loading={loading}
      aria-hidden="true"
      className={`min-w-0 w-full ${className}`}
    >
      <div
        className={`image-card @container flex w-full items-center justify-center border border-solid border-(--line) ${loading ? "" : "opacity-25"}`}
        style={
          {
            aspectRatio: `600 / ${geometry.height}`,
            "--card-radius": `${gridStyle.cornerRadius ?? 12.5}cqw`,
            borderRadius: `${gridStyle.cornerRadius ?? 12.5}% / ${((gridStyle.cornerRadius ?? 12.5) * 600) / geometry.height}%`,
            backgroundColor: gridStyle.cellBackgroundColor ?? "#111315",
          } as CSSProperties
        }
      >
        {loading && (
          <LoaderCircle className="size-[18cqw]! animate-spin text-(--muted) motion-reduce:animate-none" />
        )}
      </div>
    </div>
  );
}

export function LibraryImage({
  asset,
  onDelete,
  disabled,
  cell,
  gridStyle,
  onTitle,
  captionRows,
  onMoveStart,
  onTouchDrag,
  moving,
  dragAffected,
  onSelect,
  onImport,
  source,
  elementRef,
  onImageLoad,
  onImageError,
  className = "max-[901px]:w-16 max-[901px]:shrink-0",
}: {
  asset: Asset;
  onDelete: () => void;
  disabled: boolean;
  cell?: Cell;
  gridStyle: GridStyle;
  onTitle: (title: string) => void;
  captionRows: number;
  onMoveStart?: (source: CardDragSource, visual: CardDragVisual) => void;
  onTouchDrag?: (
    source: CardDragSource,
    visual: CardDragVisual,
    finished: boolean,
    cancelled: boolean,
  ) => void;
  moving?: boolean;
  dragAffected?: boolean;
  onSelect?: () => void;
  onImport?: () => void;
  source?: CardDragSource;
  elementRef?: Ref<HTMLDivElement>;
  onImageLoad?: (image: HTMLImageElement) => void;
  onImageError?: (image: HTMLImageElement) => void;
  className?: string;
}) {
  return (
    <div
      ref={elementRef}
      data-library-image
      className={`relative min-w-0 ${className}`}
      onLoadCapture={(event) => {
        if (event.target instanceof HTMLImageElement)
          onImageLoad?.(event.target);
      }}
      onErrorCapture={(event) => {
        if (event.target instanceof HTMLImageElement)
          onImageError?.(event.target);
      }}
    >
      <GridCell
        cell={
          cell
            ? { ...cell, title: asset.title.slice(0, captionMaxLength) }
            : {
                id: asset.id,
                assetId: asset.id,
                title: asset.title.slice(0, captionMaxLength),
                fit: "cover",
              }
        }
        asset={asset}
        index={0}
        gridId="library"
        gridStyle={gridStyle}
        captionRows={captionRows}
        canChoose={false}
        onPatch={(patch) => {
          if (patch.title !== undefined) onTitle(patch.title);
        }}
        onCrop={() => {}}
        onClear={onDelete}
        onChoose={() => {}}
        onUpload={() => {}}
        onDrop={(event) => event.preventDefault()}
        library={{ onDelete, disabled, onSelect, onImport, source }}
        onMoveStart={onMoveStart}
        onTouchDrag={onTouchDrag}
        moving={moving}
        dragAffected={dragAffected}
        dragSource={dragAffected}
      />
    </div>
  );
}
