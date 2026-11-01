import { Popover, PopoverButton, PopoverPanel } from "@headlessui/react";
import { Crop, ImagePlus, Trash2 } from "lucide-react";
import { useDrag } from "@use-gesture/react";
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type DragEvent,
} from "react";
import {
  cellGeometry,
  captionPadding,
  resolveFontWeight,
  publishers,
  sourceRectangle,
  type ImageCrop,
  type Asset,
  type Cell,
  type CellPatch,
  type GridStyle,
} from "../model";
import { layoutCaption } from "../export";
import { Button } from "./ui/controls";
import { CropEditor } from "./CropEditor";
import { CardFrame } from "./CardFrame";

const coarsePointerQuery = "(pointer: coarse)";
function subscribeToPointer(onChange: () => void) {
  const media = window.matchMedia(coarsePointerQuery);
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
}

export function useCoarsePointer() {
  return useSyncExternalStore(
    subscribeToPointer,
    () => window.matchMedia(coarsePointerQuery).matches,
    () => false,
  );
}

export type CardDragSource =
  | { kind: "cell"; gridId: string; cellId: string }
  | { kind: "asset"; assetId: string };

export type CardDragVisual = {
  cell: Cell;
  asset: Asset;
  width: number;
  height: number;
  offsetX: number;
  offsetY: number;
  x: number;
  y: number;
};

export function GridCell({
  cell,
  asset,
  index,
  gridId,
  gridStyle,
  onPatch,
  onCrop,
  onClear,
  onChoose,
  onUpload,
  onDrop,
  canChoose,
  library,
  captionRows = 1,
  onMoveStart,
  onTouchDrag,
  onMoveOver,
  onMoveLeave,
  moving = false,
  dragAffected = false,
  dragSource = false,
  previewOnly = false,
}: {
  cell: Cell;
  asset?: Asset;
  index: number;
  gridId: string;
  gridStyle: GridStyle;
  onPatch: (patch: CellPatch) => void;
  onCrop: (crop: ImageCrop, assetId: string) => void;
  onClear: () => void;
  onChoose: (trigger: HTMLButtonElement) => void;
  onUpload: () => void;
  onDrop: (event: DragEvent<HTMLDivElement>) => void;
  canChoose: boolean;
  library?: { onDelete: () => void; disabled: boolean; onSelect?: () => void };
  captionRows?: number;
  onMoveStart?: (source: CardDragSource, visual: CardDragVisual) => void;
  onTouchDrag?: (
    source: CardDragSource,
    visual: CardDragVisual,
    finished: boolean,
    cancelled: boolean,
  ) => void;
  onMoveOver?: () => void;
  onMoveLeave?: () => void;
  moving?: boolean;
  dragAffected?: boolean;
  dragSource?: boolean;
  previewOnly?: boolean;
}) {
  const coarsePointer = useCoarsePointer();
  const trigger = useRef<HTMLButtonElement>(null);
  const card = useRef<HTMLDivElement>(null);
  const caption = useRef<HTMLTextAreaElement>(null);
  const dragPreview = useRef<HTMLCanvasElement | null>(null);
  const touchDragged = useRef(false);
  const bindTouchDrag = useDrag(
    ({ xy, initial, first, last, canceled, tap, event, args }) => {
      if (tap || !asset || !card.current || !onTouchDrag) return;
      if ("pointerType" in event && event.pointerType !== "touch") return;
      touchDragged.current = true;
      if (first) (args[0] as (() => void) | undefined)?.();
      setImageHovered(false);
      setHoverTools(false);
      const bounds = card.current.getBoundingClientRect();
      onTouchDrag(
        library
          ? { kind: "asset", assetId: asset.id }
          : { kind: "cell", gridId, cellId: cell.id },
        {
          cell,
          asset,
          width: bounds.width,
          height: bounds.height,
          offsetX: initial[0] - bounds.left,
          offsetY: initial[1] - bounds.top,
          x: xy[0],
          y: xy[1],
        },
        last,
        canceled ||
          event.type === "pointercancel" ||
          event.type === "touchcancel",
      );
    },
    {
      enabled:
        coarsePointer &&
        Boolean(asset && onTouchDrag) &&
        !library?.disabled &&
        !library?.onSelect &&
        !previewOnly,
      threshold: 8,
      filterTaps: true,
      pointer: { keys: false },
    },
  );
  useEffect(() => () => dragPreview.current?.remove(), []);
  const [cropTarget, setCropTarget] = useState<string | null>(null);
  const [imageHovered, setImageHovered] = useState(false);
  const [hoverTools, setHoverTools] = useState(false);
  const [imageSize, setImageSize] = useState({ width: 0, height: 0 });
  useEffect(() => {
    if (!imageHovered) return;
    const clearOutsideHover = (event: PointerEvent) => {
      if (
        event.pointerType === "mouse" &&
        !card.current
          ?.querySelector("[data-card-image]")
          ?.contains(event.target as Node)
      ) {
        setImageHovered(false);
        setHoverTools(false);
      }
    };
    window.addEventListener("pointermove", clearOutsideHover);
    return () => window.removeEventListener("pointermove", clearOutsideHover);
  }, [imageHovered]);
  useEffect(() => {
    if (cropTarget && cropTarget !== asset?.id) setCropTarget(null);
  }, [asset?.id, cropTarget]);
  const geometry = cellGeometry(gridStyle, 600, captionRows);
  const cropRectangle =
    cell.crop && imageSize.width && imageSize.height
      ? sourceRectangle(
          cell.crop,
          imageSize.width,
          imageSize.height,
          geometry.aspectRatio,
        )
      : null;
  const overlay = gridStyle.captionPlacement === "overlay";
  const alignment = gridStyle.captionAlignment ?? "bottom";
  const freeImageHeight = Math.max(
    0,
    geometry.imageHeight - (overlay ? geometry.captionHeight : 0),
  );
  const toolSpace =
    overlay && alignment === "middle" ? freeImageHeight / 2 : freeImageHeight;
  const overlayColor = `${gridStyle.captionOverlayColor ?? "#000000"}${Math.round(
    ((gridStyle.captionOverlayOpacity ?? 60) / 100) * 255,
  )
    .toString(16)
    .padStart(2, "0")}`;
  useLayoutEffect(() => {
    const field = caption.current;
    if (!field) return;
    let disposed = false;
    const fit = () => {
      if (disposed) return;
      const context = document.createElement("canvas").getContext("2d");
      if (!context) return;
      const bounds = field.getBoundingClientRect();
      const padding = captionPadding(bounds.width);
      const { fontSize, lines } = layoutCaption(
        context,
        cell.title || "Add heading",
        gridStyle.cellFont,
        bounds.width,
        gridStyle.cellFontSize,
        resolveFontWeight(gridStyle.cellFont, gridStyle.cellFontWeight),
      );
      field.style.fontSize = `${fontSize}px`;
      field.style.paddingLeft =
        field.style.paddingRight = `${padding.horizontal}px`;
      field.style.paddingTop =
        field.style.paddingBottom = `${Math.max(0, (bounds.height - lines.length * fontSize * 1.05) / 2)}px`;
    };
    const observer = new ResizeObserver(fit);
    observer.observe(field);
    void document.fonts.ready.then(fit);
    void document.fonts
      .load(
        `${resolveFontWeight(gridStyle.cellFont, gridStyle.cellFontWeight)} 48px "${gridStyle.cellFont}"`,
      )
      .then(fit);
    fit();
    return () => {
      disposed = true;
      observer.disconnect();
    };
  }, [
    cell.title,
    gridStyle.cellFont,
    gridStyle.cellFontSize,
    gridStyle.cellFontWeight,
    geometry.height,
    geometry.captionTop,
  ]);
  return (
    <Popover
      ref={card}
      className={`image-card tw:@container tw:relative tw:min-w-0 tw:rounded-(--card-radius)! tw:border! tw:border-solid! tw:outline-offset-[-2px] tw:[--card-frame-color:transparent] tw:data-[image-hovered]:[--card-frame-color:var(--accent)] tw:has-[[data-card-image]_button:focus-visible]:[--card-frame-color:var(--accent)] ${previewOnly ? "drag-preview-card tw:h-full tw:w-full" : library ? `asset ${library.onSelect ? "tw:cursor-pointer" : "tw:cursor-move"} tw:w-full!` : "grid-cell"}${!library && dragAffected && !dragSource ? " drag-over" : ""}`}
      style={
        {
          aspectRatio: `600 / ${geometry.height}`,
          "--card-background": gridStyle.cellBackgroundColor ?? "#111315",
          backgroundColor: "var(--card-background)",
          borderColor: "var(--line)",
        } as React.CSSProperties
      }
      data-index={index}
      data-cell-id={cell.id}
      data-image-hovered={imageHovered && !moving ? "" : undefined}
      data-drag-affected={dragAffected ? "" : undefined}
      data-drag-source={dragSource ? "" : undefined}
      onDragOver={(event) => {
        event.preventDefault();
        event.dataTransfer.dropEffect =
          event.dataTransfer.effectAllowed === "move" ||
          event.dataTransfer.types.includes("application/x-gridroom-cell")
            ? "move"
            : "copy";
        event.currentTarget.classList.toggle("drag-over", !dragSource);
        onMoveOver?.();
      }}
      onDragLeave={(event) => {
        if (
          !(event.relatedTarget instanceof Node) ||
          !event.currentTarget.contains(event.relatedTarget)
        ) {
          event.currentTarget.classList.remove("drag-over");
          onMoveLeave?.();
        }
      }}
      onDrop={(event) => {
        const image = event.currentTarget.querySelector("[data-card-image]");
        setImageHovered(
          Boolean(
            image?.contains(
              document.elementFromPoint(event.clientX, event.clientY),
            ),
          ),
        );
        onDrop(event);
      }}
    >
      {({ open, close }) => (
        <>
          <div
            data-card-content
            className="tw:absolute tw:inset-0 tw:overflow-hidden tw:rounded-[calc(var(--card-radius)-1px)] tw:bg-(--card-background)"
            style={{ opacity: dragAffected ? 0.35 : 1 }}
          >
            <div
              data-card-image
              className="tw:group/image tw:absolute tw:inset-x-0 tw:@container"
              style={
                {
                  top: `${(geometry.imageTop / geometry.height) * 100}%`,
                  height: `${(geometry.imageHeight / geometry.height) * 100}%`,
                  "--cell-tool-space": `calc(${(toolSpace / 600) * 100}cqw - 3cqw)`,
                } as React.CSSProperties
              }
              onPointerEnter={(event) => {
                if (event.pointerType === "mouse" && !moving && !previewOnly)
                  setImageHovered(true);
                if (
                  event.pointerType === "mouse" &&
                  asset &&
                  !moving &&
                  !previewOnly &&
                  window.matchMedia("(hover: hover) and (pointer: fine)")
                    .matches &&
                  !open
                )
                  setHoverTools(true);
              }}
              onPointerLeave={(event) => {
                if (event.pointerType === "mouse") {
                  setImageHovered(false);
                  setHoverTools(false);
                  close(event.currentTarget);
                }
              }}
            >
              {asset ? (
                <PopoverButton
                  {...bindTouchDrag(close)}
                  ref={trigger}
                  className={`${previewOnly ? "drag-preview-image" : library ? "library-image-button" : "cell-image-button"} tw:peer/image tw:overflow-hidden tw:outline-none! ${library?.onSelect ? "tw:cursor-pointer!" : "tw:cursor-move!"}`}
                  data-library-thumbnail={library ? "" : undefined}
                  style={{
                    height: "100%",
                    aspectRatio: geometry.aspectRatio,
                    touchAction:
                      coarsePointer && onTouchDrag ? "none" : undefined,
                  }}
                  aria-label={
                    library
                      ? library.onSelect
                        ? `Use ${asset.title}`
                        : `Image options: ${cell.title}`
                      : `Cell options ${index + 1}${cell.title ? `: ${cell.title}` : ""}`
                  }
                  draggable={
                    !previewOnly &&
                    Boolean(asset) &&
                    !library?.disabled &&
                    !library?.onSelect
                  }
                  onClickCapture={(event) => {
                    if (touchDragged.current) {
                      event.preventDefault();
                      event.stopPropagation();
                      touchDragged.current = false;
                      return;
                    }
                    if (library?.onSelect && !previewOnly) {
                      event.preventDefault();
                      event.stopPropagation();
                      setHoverTools(false);
                      close(event.currentTarget);
                      if (!library.disabled) library.onSelect();
                      return;
                    }
                  }}
                  onPointerDownCapture={(event) => {
                    if (event.pointerType === "touch")
                      touchDragged.current = false;
                  }}
                  onMouseDownCapture={(event) => event.stopPropagation()}
                  onDragStart={(event) => {
                    if (!asset || previewOnly || library?.onSelect) return;
                    setImageHovered(false);
                    setHoverTools(false);
                    close();
                    if (library && asset) {
                      event.dataTransfer.setData(
                        "application/x-gridroom-asset",
                        asset.id,
                      );
                      event.dataTransfer.effectAllowed = "copy";
                    } else {
                      event.dataTransfer.setData(
                        "application/x-gridroom-cell",
                        JSON.stringify({ boardId: gridId, cellId: cell.id }),
                      );
                      event.dataTransfer.effectAllowed = "move";
                    }
                    const bounds = (
                      card.current ?? event.currentTarget
                    ).getBoundingClientRect();
                    const nativePreview = document.createElement("canvas");
                    nativePreview.width = nativePreview.height = 1;
                    nativePreview.style.position = "fixed";
                    nativePreview.style.left = "-10000px";
                    nativePreview.style.pointerEvents = "none";
                    nativePreview.setAttribute("aria-hidden", "true");
                    document.body.append(nativePreview);
                    dragPreview.current?.remove();
                    dragPreview.current = nativePreview;
                    event.dataTransfer.setDragImage(nativePreview, 0, 0);
                    requestAnimationFrame(() => {
                      nativePreview.remove();
                      if (dragPreview.current === nativePreview)
                        dragPreview.current = null;
                    });
                    onMoveStart?.(
                      library
                        ? { kind: "asset", assetId: asset.id }
                        : { kind: "cell", gridId, cellId: cell.id },
                      {
                        cell,
                        asset,
                        width: bounds.width,
                        height: bounds.height,
                        offsetX: event.clientX - bounds.left,
                        offsetY: event.clientY - bounds.top,
                        x: event.clientX,
                        y: event.clientY,
                      },
                    );
                  }}
                  onDragEnd={() => {
                    dragPreview.current?.remove();
                    dragPreview.current = null;
                  }}
                >
                  <img
                    className="tw:pointer-events-none tw:rounded-none! tw:border-0!"
                    src={asset.src}
                    alt={cell.title || asset.title}
                    onLoad={(event) =>
                      setImageSize({
                        width: event.currentTarget.naturalWidth,
                        height: event.currentTarget.naturalHeight,
                      })
                    }
                    style={
                      cropRectangle
                        ? {
                            position: "absolute",
                            width: `${(imageSize.width / cropRectangle.width) * 100}%`,
                            height: `${(imageSize.height / cropRectangle.height) * 100}%`,
                            left: `${(-cropRectangle.x / cropRectangle.width) * 100}%`,
                            top: `${(-cropRectangle.y / cropRectangle.height) * 100}%`,
                            objectFit: "cover",
                          }
                        : { objectFit: "cover" }
                    }
                    draggable={false}
                  />
                </PopoverButton>
              ) : (
                <button
                  ref={trigger}
                  type="button"
                  className={`${previewOnly ? "drag-preview-image" : "cell-image-button"} tw:peer/image tw:outline-none!`}
                  style={{ height: "100%", aspectRatio: geometry.aspectRatio }}
                  aria-label={`Add image to cell ${index + 1}`}
                  title={imageHovered ? "Add or drop an image" : undefined}
                  onClick={() => {
                    if ((canChoose || coarsePointer) && trigger.current)
                      onChoose(trigger.current);
                    else onUpload();
                  }}
                >
                  <span
                    className="empty-cell tw:absolute tw:inset-x-0 tw:gap-[3cqw]! tw:text-[8.5cqw]! tw:[&_svg]:size-[min(18cqw,90cqh)]!"
                    style={{
                      containerType: "size",
                      top: `${overlay && alignment === "top" ? (geometry.captionHeight / geometry.imageHeight) * 100 : 0}%`,
                      height: `${(toolSpace / geometry.imageHeight) * 100}%`,
                    }}
                  >
                    <ImagePlus aria-hidden="true" />
                    <span
                      className={
                        overlay && alignment === "middle"
                          ? "tw:hidden"
                          : "tw:hidden tw:@min-[64px]:block"
                      }
                    >
                      Add image
                    </span>
                    <span
                      className={
                        overlay && alignment === "middle"
                          ? "tw:hidden"
                          : "tw:hidden tw:text-[7cqw] tw:@min-[120px]:block"
                      }
                    >
                      Drop here
                    </span>
                  </span>
                </button>
              )}
              {asset && (
                <PopoverPanel
                  static={hoverTools}
                  role="group"
                  aria-label="Cell tools"
                  className="tw:pointer-events-none tw:absolute tw:inset-0 tw:z-10"
                >
                  {!library && (
                    <div
                      className="tw:pointer-events-none tw:absolute tw:inset-x-0 tw:bottom-0 tw:flex tw:flex-wrap tw:justify-center tw:gap-[1.5cqw] tw:p-[1.5cqw] tw:[&_button]:pointer-events-auto"
                      style={{
                        bottom:
                          overlay &&
                          (gridStyle.captionAlignment ?? "bottom") === "bottom"
                            ? `${(geometry.captionHeight / geometry.imageHeight) * 100}%`
                            : undefined,
                      }}
                    >
                      <Button
                        variant="icon"
                        className="tw:size-[min(25cqw,var(--cell-tool-space))]! tw:p-0! tw:rounded-[2cqw]! tw:border-white/30! tw:bg-black/60! tw:text-white tw:backdrop-blur-sm tw:enabled:hover:bg-black/75! tw:[&_svg]:size-[40%]!"
                        aria-label={asset ? "Replace image" : "Choose image"}
                        title={asset ? "Replace image" : "Choose image"}
                        onClick={() => {
                          setHoverTools(false);
                          close();
                          if (trigger.current) onChoose(trigger.current);
                        }}
                      >
                        <ImagePlus aria-hidden="true" />
                      </Button>
                      <Button
                        variant="icon"
                        className="tw:size-[min(25cqw,var(--cell-tool-space))]! tw:p-0! tw:rounded-[2cqw]! tw:border-white/30! tw:bg-black/60! tw:text-white tw:backdrop-blur-sm tw:enabled:hover:bg-black/75! tw:[&_svg]:size-[40%]!"
                        aria-label="Crop image"
                        title="Crop image"
                        onClick={() => {
                          setHoverTools(false);
                          close();
                          setCropTarget(asset.id);
                        }}
                      >
                        <Crop aria-hidden="true" />
                      </Button>
                    </div>
                  )}
                  {(asset || cell.title) && (
                    <Button
                      variant="icon"
                      className={`tw:pointer-events-auto tw:absolute ${library ? "tw:size-[44px]!" : "tw:size-[min(25cqw,var(--cell-tool-space))]!"} tw:p-0! tw:rounded-[2cqw]! tw:border-white/30! tw:bg-black/60! tw:text-white tw:backdrop-blur-sm tw:enabled:hover:bg-black/75! tw:[&_svg]:size-[40%]!`}
                      aria-label={
                        library ? `Delete ${asset?.title}` : "Clear cell"
                      }
                      disabled={library?.disabled}
                      style={{
                        right: "calc(4.5cqw + var(--card-paint-inset, 0px))",
                        top:
                          overlay && gridStyle.captionAlignment === "top"
                            ? `calc(${(geometry.captionHeight / geometry.imageHeight) * 100}% + 4.5cqw + var(--card-paint-inset, 0px))`
                            : "calc(4.5cqw + var(--card-paint-inset, 0px))",
                      }}
                      title={library ? `Delete ${asset?.title}` : "Clear cell"}
                      onClick={() => {
                        setHoverTools(false);
                        close();
                        if (library) library.onDelete();
                        else onClear();
                      }}
                    >
                      <Trash2 aria-hidden="true" />
                    </Button>
                  )}
                </PopoverPanel>
              )}
            </div>
            <textarea
              ref={caption}
              className={`${previewOnly ? "drag-preview-heading" : library ? "library-heading asset-name" : "cell-heading"} tw:peer/caption tw:absolute tw:inset-x-0 tw:z-20 tw:hover:z-40 tw:focus:z-40 tw:min-h-0! tw:[field-sizing:fixed]! tw:placeholder:text-(--muted)/35 tw:hover:placeholder:text-(--muted)/80 tw:focus:placeholder:text-(--muted)/80 tw:outline-none!`}
              style={
                {
                  top: `${(geometry.captionTop / geometry.height) * 100}%`,
                  height: `${(geometry.captionHeight / geometry.height) * 100}%`,
                  background: overlay
                    ? overlayColor
                    : (gridStyle.cellBackgroundColor ??
                      publishers[gridStyle.publisher].caption),
                  "--card-caption-color": overlay
                    ? overlayColor
                    : (gridStyle.cellBackgroundColor ??
                      publishers[gridStyle.publisher].caption),
                  fontFamily: `"${gridStyle.cellFont}", sans-serif`,
                  fontWeight: resolveFontWeight(
                    gridStyle.cellFont,
                    gridStyle.cellFontWeight,
                  ),
                  color: gridStyle.cellTextColor ?? "#f4f4ef",
                  margin: 0,
                  letterSpacing: 0,
                } as React.CSSProperties
              }
              rows={1}
              maxLength={120}
              value={cell.title}
              placeholder="Add heading"
              aria-label={
                library
                  ? `Library heading: ${asset?.title}`
                  : `Heading for cell ${index + 1}`
              }
              onPointerDown={(event) => {
                if (open || hoverTools) {
                  setHoverTools(false);
                  close(event.currentTarget);
                }
              }}
              onFocus={(event) => {
                if (open || hoverTools) {
                  setHoverTools(false);
                  close(event.currentTarget);
                }
              }}
              onChange={(event) => onPatch({ title: event.target.value })}
            />
            <span
              aria-hidden="true"
              data-caption-feedback
              className="tw:pointer-events-none tw:absolute tw:z-50 tw:border tw:border-solid tw:border-transparent tw:peer-hover/caption:border-white/60 tw:peer-focus/caption:border-2 tw:peer-focus/caption:border-(--accent)"
              style={
                {
                  "--caption-feedback-inset": "clamp(3px, 1.5cqw, 8px)",
                  left: "var(--caption-feedback-inset)",
                  right: "var(--caption-feedback-inset)",
                  top: `calc(${(geometry.captionTop / geometry.height) * 100}% + var(--caption-feedback-inset))`,
                  height: `max(0px, calc(${(geometry.captionHeight / geometry.height) * 100}% - 2 * var(--caption-feedback-inset)))`,
                  borderTopLeftRadius:
                    geometry.captionTop === 0
                      ? "max(0px, calc(var(--card-radius) - 1px - var(--caption-feedback-inset)))"
                      : 0,
                  borderTopRightRadius:
                    geometry.captionTop === 0
                      ? "max(0px, calc(var(--card-radius) - 1px - var(--caption-feedback-inset)))"
                      : 0,
                  borderBottomLeftRadius:
                    geometry.captionTop + geometry.captionHeight >=
                    geometry.height - 0.01
                      ? "max(0px, calc(var(--card-radius) - 1px - var(--caption-feedback-inset)))"
                      : 0,
                  borderBottomRightRadius:
                    geometry.captionTop + geometry.captionHeight >=
                    geometry.height - 0.01
                      ? "max(0px, calc(var(--card-radius) - 1px - var(--caption-feedback-inset)))"
                      : 0,
                } as React.CSSProperties
              }
            />
          </div>
          <CardFrame />
          {asset && cropTarget === asset.id && (
            <CropEditor
              asset={asset}
              aspect={geometry.aspectRatio}
              initialCrop={cell.crop}
              returnFocus={trigger}
              onClose={() => setCropTarget(null)}
              onApply={(crop) => onCrop(crop, asset.id)}
            />
          )}
        </>
      )}
    </Popover>
  );
}
