import type { Asset, Cell, GridStyle } from "../model";
import { GridCell, type CardDragSource, type CardDragVisual } from "./GridCell";

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
  className?: string;
}) {
  return (
    <div data-library-image className={`relative min-w-0 ${className}`}>
      <GridCell
        cell={
          cell ?? {
            id: asset.id,
            assetId: asset.id,
            title: asset.title.slice(0, 120),
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
        library={{ onDelete, disabled, onSelect }}
        onMoveStart={onMoveStart}
        onTouchDrag={onTouchDrag}
        moving={moving}
        dragAffected={dragAffected}
        dragSource={dragAffected}
      />
    </div>
  );
}
