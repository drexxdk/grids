import { cellGeometry, type Asset, type Cell, type GridStyle } from "../model";
import { captionMaxLength } from "../config";
import type { Ref } from "react";
import { LoaderCircle } from "lucide-react";
import { GridCell, type CardDragSource, type CardDragVisual } from "./GridCell";

export function LibraryImagePlaceholder({
  gridStyle,
  captionRows,
  loading = false,
}: {
  gridStyle: GridStyle;
  captionRows: number;
  loading?: boolean;
}) {
  const geometry = cellGeometry(gridStyle, 600, captionRows);
  return (
    <div
      data-image-placeholder
      data-loading={loading}
      aria-hidden="true"
      className="min-w-0 w-full"
    >
      <div
        className={`image-card @container flex w-full items-center justify-center rounded-(--card-radius) border border-solid border-(--line) ${loading ? "" : "opacity-25"}`}
        style={{
          aspectRatio: `600 / ${geometry.height}`,
          backgroundColor: gridStyle.cellBackgroundColor ?? "#111315",
        }}
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
  className = "max-[900px]:w-20.5 max-[900px]:shrink-0",
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
