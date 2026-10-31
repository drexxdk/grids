import { Popover, PopoverButton, PopoverPanel } from "@headlessui/react";
import { Crop, ImagePlus, Scan, Trash2 } from "lucide-react";
import { useRef, type DragEvent } from "react";
import type { Asset, Cell, CellPatch } from "../model";
import { Button } from "./ui/controls";

export function GridCell({
  cell,
  asset,
  index,
  gridId,
  onPatch,
  onClear,
  onChoose,
  onUpload,
  onDrop,
  canChoose,
}: {
  cell: Cell;
  asset?: Asset;
  index: number;
  gridId: string;
  onPatch: (patch: CellPatch) => void;
  onClear: () => void;
  onChoose: (trigger: HTMLButtonElement) => void;
  onUpload: () => void;
  onDrop: (event: DragEvent<HTMLDivElement>) => void;
  canChoose: boolean;
}) {
  const trigger = useRef<HTMLButtonElement>(null);
  return (
    <Popover
      className="grid-cell"
      data-index={index}
      onDragOver={(event) => {
        event.preventDefault();
        event.currentTarget.classList.add("drag-over");
      }}
      onDragLeave={(event) => {
        if (
          !(event.relatedTarget instanceof Node) ||
          !event.currentTarget.contains(event.relatedTarget)
        )
          event.currentTarget.classList.remove("drag-over");
      }}
      onDrop={onDrop}
    >
      {({ open, close }) => (
        <>
          <div
            className="tw:relative tw:overflow-hidden tw:@container"
            onPointerEnter={(event) => {
              if (
                event.pointerType === "mouse" &&
                asset &&
                window.matchMedia("(hover: hover) and (pointer: fine)")
                  .matches &&
                !open
              )
                trigger.current?.click();
            }}
            onPointerLeave={(event) => {
              if (event.pointerType === "mouse") close();
            }}
          >
            {asset ? (
              <PopoverButton
                ref={trigger}
                className="cell-image-button"
                aria-label={`Cell options ${index + 1}${cell.title ? `: ${cell.title}` : ""}`}
                draggable={Boolean(asset)}
                onDragStart={(event) => {
                  close();
                  event.dataTransfer.setData(
                    "application/x-gridroom-cell",
                    JSON.stringify({ boardId: gridId, cellId: cell.id }),
                  );
                  event.dataTransfer.effectAllowed = "move";
                }}
              >
                <img
                  src={asset.src}
                  alt={cell.title || asset.title}
                  style={{ objectFit: cell.fit }}
                  draggable={false}
                />
              </PopoverButton>
            ) : (
              <button
                ref={trigger}
                type="button"
                className="cell-image-button tw:border! tw:border-dashed! tw:border-(--line)! tw:enabled:hover:border-(--accent)! tw:enabled:hover:bg-(--panel)!"
                aria-label={`Add image to cell ${index + 1}`}
                title="Add or drop an image"
                onClick={() => {
                  if (canChoose && trigger.current) onChoose(trigger.current);
                  else onUpload();
                }}
              >
                <span className="empty-cell tw:gap-[4px]! tw:[&_svg]:size-[min(24px,50cqw)]">
                  <ImagePlus aria-hidden="true" />
                  <span className="tw:hidden tw:@min-[64px]:block">
                    Add image
                  </span>
                  <span className="tw:hidden tw:text-[9px] tw:@min-[64px]:block">
                    Drop here
                  </span>
                </span>
              </button>
            )}
            {asset && (
              <PopoverPanel
                role="group"
                aria-label="Cell tools"
                className="tw:pointer-events-none tw:absolute tw:inset-0 tw:z-10"
              >
                <div className="tw:pointer-events-auto tw:absolute tw:inset-x-0 tw:bottom-0 tw:flex tw:flex-wrap tw:justify-center tw:gap-[2px] tw:p-[2px]">
                  <Button
                    variant="icon"
                    className="tw:size-[clamp(24px,25cqw,44px)]! tw:rounded-sm tw:border-white/30! tw:bg-black/60! tw:text-white tw:backdrop-blur-sm tw:enabled:hover:bg-black/75! tw:[&_svg]:size-[16px]"
                    aria-label={asset ? "Replace image" : "Choose image"}
                    title={asset ? "Replace image" : "Choose image"}
                    onClick={() => {
                      close();
                      if (trigger.current) onChoose(trigger.current);
                    }}
                  >
                    <ImagePlus aria-hidden="true" />
                  </Button>
                  {asset && cell.fit === "cover" && (
                    <Button
                      variant="icon"
                      className="tw:size-[clamp(24px,25cqw,44px)]! tw:rounded-sm tw:border-white/30! tw:bg-black/60! tw:text-white tw:backdrop-blur-sm tw:enabled:hover:bg-black/75! tw:[&_svg]:size-[16px]"
                      aria-label="Fit image"
                      title="Fit image"
                      onClick={() => onPatch({ fit: "contain" })}
                    >
                      <Scan aria-hidden="true" />
                    </Button>
                  )}
                  {asset && cell.fit === "contain" && (
                    <Button
                      variant="icon"
                      className="tw:size-[clamp(24px,25cqw,44px)]! tw:rounded-sm tw:border-white/30! tw:bg-black/60! tw:text-white tw:backdrop-blur-sm tw:enabled:hover:bg-black/75! tw:[&_svg]:size-[16px]"
                      aria-label="Fill image"
                      title="Fill image"
                      onClick={() => onPatch({ fit: "cover" })}
                    >
                      <Crop aria-hidden="true" />
                    </Button>
                  )}
                </div>
                {(asset || cell.title) && (
                  <Button
                    variant="icon"
                    className="tw:pointer-events-auto tw:absolute tw:top-[2px] tw:right-[2px] tw:size-[clamp(24px,25cqw,44px)]! tw:rounded-sm tw:border-white/30! tw:bg-black/60! tw:text-white tw:backdrop-blur-sm tw:enabled:hover:bg-black/75! tw:[&_svg]:size-[16px]"
                    aria-label="Clear cell"
                    title="Clear cell"
                    onClick={() => {
                      close();
                      onClear();
                    }}
                  >
                    <Trash2 aria-hidden="true" />
                  </Button>
                )}
              </PopoverPanel>
            )}
          </div>
          <textarea
            className="cell-heading tw:placeholder:text-transparent tw:hover:placeholder:text-(--muted) tw:focus:placeholder:text-(--muted)"
            rows={1}
            maxLength={120}
            value={cell.title}
            placeholder="Heading"
            aria-label={`Heading for cell ${index + 1}`}
            onChange={(event) => onPatch({ title: event.target.value })}
          />
        </>
      )}
    </Popover>
  );
}
