import { Popover, PopoverButton, PopoverPanel } from "@headlessui/react";
import { Crop, ImagePlus, Trash2 } from "lucide-react";
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
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
  library?: { onDelete: () => void; disabled: boolean };
  captionRows?: number;
}) {
  const trigger = useRef<HTMLButtonElement>(null);
  const caption = useRef<HTMLTextAreaElement>(null);
  const dragPreview = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => () => dragPreview.current?.remove(), []);
  const [cropTarget, setCropTarget] = useState<string | null>(null);
  const [hoverTools, setHoverTools] = useState(false);
  const [imageSize, setImageSize] = useState({ width: 0, height: 0 });
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
      className={`image-card tw:relative tw:min-w-0 tw:bg-(--card-background)! tw:rounded-[6px]! tw:border! tw:border-solid! tw:border-(--line)! tw:[--card-frame-color:transparent] tw:has-[[data-card-image]:hover]:[--card-frame-color:var(--accent)] tw:has-[[data-card-image]_button:focus-visible]:[--card-frame-color:var(--accent)] ${library ? "asset tw:cursor-grab tw:w-full!" : "grid-cell"}`}
      style={
        {
          aspectRatio: `600 / ${geometry.height}`,
          "--card-background": gridStyle.cellBackgroundColor ?? "#111315",
        } as React.CSSProperties
      }
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
          <div className="tw:absolute tw:inset-0 tw:overflow-hidden tw:rounded-[5px]">
            <div
              data-card-image
              className="tw:group/image tw:absolute tw:inset-x-0 tw:@container"
              style={
                {
                  top: `${(geometry.imageTop / geometry.height) * 100}%`,
                  height: `${(geometry.imageHeight / geometry.height) * 100}%`,
                  "--cell-tool-space": `calc(${(toolSpace / 600) * 100}cqw - 4px)`,
                } as React.CSSProperties
              }
              onPointerEnter={(event) => {
                if (
                  event.pointerType === "mouse" &&
                  asset &&
                  window.matchMedia("(hover: hover) and (pointer: fine)")
                    .matches &&
                  !open
                )
                  setHoverTools(true);
              }}
              onPointerLeave={(event) => {
                if (event.pointerType === "mouse") {
                  setHoverTools(false);
                  close(event.currentTarget);
                }
              }}
            >
              {asset ? (
                <PopoverButton
                  ref={trigger}
                  className={`${library ? "library-image-button" : "cell-image-button"} tw:peer/image tw:overflow-hidden tw:outline-none! tw:cursor-[inherit]`}
                  data-library-thumbnail={library ? "" : undefined}
                  style={{ height: "100%", aspectRatio: geometry.aspectRatio }}
                  aria-label={
                    library
                      ? `Image options: ${cell.title}`
                      : `Cell options ${index + 1}${cell.title ? `: ${cell.title}` : ""}`
                  }
                  draggable={Boolean(asset)}
                  onMouseDownCapture={(event) => event.stopPropagation()}
                  onDragStart={(event) => {
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
                    const image = event.currentTarget.querySelector("img");
                    if (image?.complete && image.naturalWidth) {
                      const bounds =
                        event.currentTarget.getBoundingClientRect();
                      const preview = document.createElement("canvas");
                      preview.width = Math.ceil(bounds.width);
                      preview.height = Math.ceil(bounds.height);
                      const context = preview.getContext("2d");
                      if (context) {
                        const source = sourceRectangle(
                          cell.crop,
                          image.naturalWidth,
                          image.naturalHeight,
                          geometry.aspectRatio,
                        );
                        context.drawImage(
                          image,
                          source.x,
                          source.y,
                          source.width,
                          source.height,
                          0,
                          0,
                          preview.width,
                          preview.height,
                        );
                        preview.style.position = "fixed";
                        preview.style.left = "-10000px";
                        preview.style.top = "0";
                        preview.style.pointerEvents = "none";
                        preview.setAttribute("aria-hidden", "true");
                        document.body.append(preview);
                        dragPreview.current?.remove();
                        dragPreview.current = preview;
                        event.dataTransfer.setDragImage(
                          preview,
                          Math.max(
                            0,
                            Math.min(
                              preview.width,
                              event.clientX - bounds.left,
                            ),
                          ),
                          Math.max(
                            0,
                            Math.min(
                              preview.height,
                              event.clientY - bounds.top,
                            ),
                          ),
                        );
                        requestAnimationFrame(() => {
                          preview.remove();
                          if (dragPreview.current === preview)
                            dragPreview.current = null;
                        });
                      }
                    }
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
                  className="cell-image-button tw:peer/image tw:outline-none!"
                  style={{ height: "100%", aspectRatio: geometry.aspectRatio }}
                  aria-label={`Add image to cell ${index + 1}`}
                  title="Add or drop an image"
                  onClick={() => {
                    if (canChoose && trigger.current) onChoose(trigger.current);
                    else onUpload();
                  }}
                >
                  <span
                    className="empty-cell tw:absolute tw:inset-x-0 tw:gap-[4px]! tw:[&_svg]:size-[min(24px,50cqw,90cqh)]!"
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
                          : "tw:hidden tw:text-[9px] tw:@min-[120px]:block"
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
                      className="tw:pointer-events-none tw:absolute tw:inset-x-0 tw:bottom-0 tw:flex tw:flex-wrap tw:justify-center tw:gap-[2px] tw:p-[2px] tw:[&_button]:pointer-events-auto"
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
                        className="tw:size-[min(clamp(24px,25cqw,44px),var(--cell-tool-space))]! tw:p-0! tw:rounded-sm tw:border-white/30! tw:bg-black/60! tw:text-white tw:backdrop-blur-sm tw:enabled:hover:bg-black/75! tw:[&_svg]:size-[min(16px,70%)]"
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
                        className="tw:size-[min(clamp(24px,25cqw,44px),var(--cell-tool-space))]! tw:p-0! tw:rounded-sm tw:border-white/30! tw:bg-black/60! tw:text-white tw:backdrop-blur-sm tw:enabled:hover:bg-black/75! tw:[&_svg]:size-[min(16px,70%)]"
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
                      className="tw:pointer-events-auto tw:absolute tw:top-[2px] tw:right-[2px] tw:size-[min(clamp(24px,25cqw,44px),var(--cell-tool-space))]! tw:p-0! tw:rounded-sm tw:border-white/30! tw:bg-black/60! tw:text-white tw:backdrop-blur-sm tw:enabled:hover:bg-black/75! tw:[&_svg]:size-[min(16px,70%)]"
                      aria-label={
                        library ? `Delete ${asset?.title}` : "Clear cell"
                      }
                      disabled={library?.disabled}
                      style={{
                        top:
                          overlay && gridStyle.captionAlignment === "top"
                            ? `${(geometry.captionHeight / geometry.imageHeight) * 100}%`
                            : undefined,
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
              className={`${library ? "library-heading asset-name" : "cell-heading"} tw:absolute tw:inset-x-0 tw:z-20 tw:hover:z-40 tw:focus:z-40 tw:min-h-0! tw:[field-sizing:fixed]! tw:placeholder:text-(--muted)/35 tw:hover:placeholder:text-(--muted)/80 tw:focus:placeholder:text-(--muted)/80 tw:outline-none! tw:hover:bg-[color-mix(in_srgb,var(--card-caption-color),white_8%)]! tw:focus:bg-[color-mix(in_srgb,var(--card-caption-color),white_12%)]!`}
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
          </div>
          <span
            aria-hidden="true"
            data-cell-image-frame
            className="tw:pointer-events-none tw:absolute tw:inset-[-3px] tw:z-50 tw:[--frame-color:var(--card-frame-color)]"
          >
            <svg
              className="tw:absolute tw:inset-0 tw:h-full tw:w-full tw:overflow-visible"
              aria-hidden="true"
            >
              <rect
                x="0.5"
                y="0.5"
                rx="7.5"
                fill="none"
                stroke="var(--frame-color)"
                strokeWidth="1"
                strokeDasharray="2 2"
                style={{
                  width: "calc(100% - 1px)",
                  height: "calc(100% - 1px)",
                }}
              />
            </svg>
          </span>
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
