import { Popover, PopoverButton, PopoverPanel } from "@headlessui/react";
import { Trash2 } from "lucide-react";
import { useRef } from "react";
import type { Asset } from "../model";
import { Button } from "./ui/controls";

export function LibraryImage({
  asset,
  onDelete,
  disabled,
}: {
  asset: Asset;
  onDelete: () => void;
  disabled: boolean;
}) {
  const trigger = useRef<HTMLButtonElement>(null);
  const dragging = useRef(false);
  return (
    <Popover
      data-library-image
      className="tw:relative tw:min-w-0 tw:max-[900px]:w-[82px] tw:max-[900px]:shrink-0"
    >
      {({ open, close }) => (
        <div
          onPointerEnter={(event) => {
            if (
              event.pointerType === "mouse" &&
              !dragging.current &&
              window.matchMedia("(hover: hover) and (pointer: fine)").matches &&
              !open
            )
              trigger.current?.click();
          }}
          onPointerLeave={(event) => {
            if (event.pointerType === "mouse" && !dragging.current) close();
          }}
        >
          <PopoverButton
            ref={trigger}
            className="asset tw:block tw:w-full! tw:outline-none! tw:focus-visible:[&_[data-library-thumbnail]]:[outline:2px_solid_var(--accent)]! tw:focus-visible:[&_[data-library-thumbnail]]:[outline-offset:-2px]!"
            aria-label={`Image options: ${asset.title}`}
            title={asset.title}
            draggable
            onMouseDownCapture={(event) => event.stopPropagation()}
            onDragStart={(event) => {
              dragging.current = true;
              event.dataTransfer.setData(
                "application/x-gridroom-asset",
                asset.id,
              );
              event.dataTransfer.effectAllowed = "copy";
            }}
            onDragEnd={() => {
              dragging.current = false;
              close();
            }}
          >
            <span
              data-library-thumbnail
              className="tw:relative tw:block tw:aspect-square tw:w-full tw:rounded-[4px] tw:border tw:border-solid tw:border-(--line) tw:hover:border-(--accent)"
            >
              <img
                className="tw:absolute tw:inset-0 tw:h-full tw:rounded-[3px]! tw:border-0!"
                src={asset.src}
                alt={asset.title}
                draggable={false}
              />
            </span>
            <span className="asset-name">{asset.title}</span>
            <span className="asset-category">{asset.category}</span>
          </PopoverButton>
          <PopoverPanel
            role="group"
            aria-label={`Image actions: ${asset.title}`}
            className="tw:absolute tw:top-1 tw:right-1 tw:z-10"
          >
            <Button
              variant="icon"
              className="tw:size-[36px]! tw:border-white/30! tw:bg-black/60! tw:text-white tw:backdrop-blur-sm tw:[&_svg]:size-[18px]"
              disabled={disabled}
              aria-label={`Delete ${asset.title}`}
              title={`Delete ${asset.title}`}
              onClick={() => {
                close();
                onDelete();
              }}
            >
              <Trash2 aria-hidden="true" />
            </Button>
          </PopoverPanel>
        </div>
      )}
    </Popover>
  );
}
