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
  moving,
  dragAffected,
}: {
  asset: Asset;
  onDelete: () => void;
  disabled: boolean;
  cell?: Cell;
  gridStyle: GridStyle;
  onTitle: (title: string) => void;
  captionRows: number;
  onMoveStart?: (source: CardDragSource, visual: CardDragVisual) => void;
  moving?: boolean;
  dragAffected?: boolean;
}) {
  return (
    <div
      data-library-image
      className="tw:relative tw:min-w-0 tw:max-[900px]:w-[82px] tw:max-[900px]:shrink-0"
    >
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
        library={{ onDelete, disabled }}
        onMoveStart={onMoveStart}
        moving={moving}
        dragAffected={dragAffected}
        dragSource={dragAffected}
      />
    </div>
  );
}
