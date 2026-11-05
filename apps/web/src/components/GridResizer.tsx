import { t } from "../i18n";
import {
  useLayoutEffect,
  useRef,
  type CSSProperties,
  type ReactNode,
  type Ref,
} from "react";
import { flushSync } from "react-dom";
import { gridLimit } from "../model";
import {
  ArrowDownFromLine,
  ArrowLeftToLine,
  ArrowRightFromLine,
  ArrowUpToLine,
} from "lucide-react";
import { Button, ButtonGroup } from "./ui/controls";

export function GridResizer({
  ref,
  style,
  viewportHeight,
  previewWidth,
  onOverflowChange,
  heading,
  bottomControls,
  sideControls,
  cornerAction,
  children,
}: {
  ref?: Ref<HTMLDivElement>;
  style?: CSSProperties;
  viewportHeight?: number;
  previewWidth?: number;
  onOverflowChange?: (size: { width: number; height: number }) => void;
  heading?: ReactNode;
  bottomControls?: ReactNode;
  sideControls?: ReactNode;
  cornerAction?: ReactNode;
  children: ReactNode;
}) {
  const contentRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const overflowRef = useRef({ width: 0, height: 0 });
  useLayoutEffect(() => {
    const content = contentRef.current;
    const viewport = viewportRef.current;
    const area = content?.parentElement;
    if (!content || !viewport || !area) return;
    const workspace = viewport.closest<HTMLElement>("[data-workspace-scroll]");
    const syncedViewport = {
      left: viewport.scrollLeft,
      top: viewport.scrollTop,
    };
    const syncViewport = () => {
      if (!workspace) return;
      viewport.scrollLeft = workspace.scrollLeft;
      viewport.scrollTop = workspace.scrollTop;
      syncedViewport.left = viewport.scrollLeft;
      syncedViewport.top = viewport.scrollTop;
    };
    const syncWorkspace = () => {
      if (!workspace) return;
      if (viewport.scrollLeft !== syncedViewport.left) {
        workspace.scrollLeft = viewport.scrollLeft;
        syncedViewport.left = viewport.scrollLeft;
      }
      if (viewport.scrollTop !== syncedViewport.top) {
        workspace.scrollTop = viewport.scrollTop;
        syncedViewport.top = viewport.scrollTop;
      }
    };
    const update = () => {
      const overflow = {
        width: Math.max(0, viewport.scrollWidth - viewport.clientWidth),
        height: Math.max(0, viewport.scrollHeight - viewport.clientHeight),
      };
      viewport.toggleAttribute("data-overflow-x", overflow.width > 0);
      viewport.toggleAttribute("data-overflow-y", overflow.height > 0);
      if (
        overflow.width !== overflowRef.current.width ||
        overflow.height !== overflowRef.current.height
      ) {
        overflowRef.current = overflow;
        onOverflowChange?.(overflow);
      }
    };
    update();
    // Flush before paint so the stale scroll extent never flashes scrollbars.
    const observer = new ResizeObserver(() => flushSync(update));
    observer.observe(content);
    observer.observe(viewport);
    observer.observe(area);
    if (viewport.firstElementChild)
      observer.observe(viewport.firstElementChild);
    workspace?.addEventListener("scroll", syncViewport, { passive: true });
    viewport.addEventListener("scroll", syncWorkspace, { passive: true });
    syncViewport();
    return () => {
      observer.disconnect();
      workspace?.removeEventListener("scroll", syncViewport);
      viewport.removeEventListener("scroll", syncWorkspace);
    };
  }, [viewportHeight, previewWidth, onOverflowChange]);
  return (
    <div
      ref={ref}
      style={style}
      data-resize-frame
      data-controls-placement={bottomControls ? "canvas" : "header"}
      className={
        bottomControls
          ? "grid min-h-0 min-w-0 grid-cols-[44px_minmax(0,1fr)_44px] grid-rows-[minmax(0,1fr)_44px] gap-2 [&_button:focus-visible]:-outline-offset-3!"
          : "flex min-h-0 min-w-0 items-center justify-center"
      }
    >
      <div
        ref={contentRef}
        data-preview-content
        style={{
          width: previewWidth,
          maxWidth: "100%",
          paddingTop: heading ? "var(--canvas-inset,0px)" : 0,
        }}
        className={`relative isolate flex min-w-0 flex-col gap-(--heading-gap,0px) @container ${bottomControls ? "col-start-2 row-start-1" : ""}`}
      >
        <span
          aria-hidden="true"
          data-image-canvas-background
          className="pointer-events-none absolute inset-y-0 left-0 right-(--preview-scrollbar-width,0px) -z-10 bg-(--board-bg)"
        />
        {heading && (
          <div className="overflow-hidden px-(--canvas-inset,0px)">
            {heading}
          </div>
        )}
        <div
          ref={viewportRef}
          data-canvas-viewport
          className="min-w-0 overflow-hidden [clip-path:inset(var(--clip-y,-100vmax)_var(--clip-x,-100vmax))] data-overflow-x:[--clip-x:calc(var(--preview-cell-width,200px)*0.03+2px)] data-overflow-y:[--clip-y:calc(var(--preview-cell-width,200px)*0.03+2px)]"
          style={{
            height: viewportHeight,
            boxSizing: "content-box",
            padding: "calc(var(--preview-cell-width, 200px) * 0.03 + 2px)",
            margin:
              "calc(-1 * (var(--preview-cell-width, 200px) * 0.03 + 2px))",
          }}
        >
          {children}
        </div>
      </div>
      {bottomControls && (
        <>
          <div className="col-start-3 row-start-1 flex items-center justify-center">
            {sideControls}
          </div>
          <div className="col-start-2 row-start-2 flex items-center justify-center">
            {bottomControls}
          </div>
          <div className="col-start-3 row-start-2 flex items-center justify-center">
            {cornerAction}
          </div>
        </>
      )}
    </div>
  );
}

export function GridResizeControls({
  rows,
  columns,
  onResize,
  dimension,
  orientation = "horizontal",
}: {
  rows: number;
  columns: number;
  onResize: (dimension: "rows" | "columns", value: number) => void;
  dimension?: "rows" | "columns";
  orientation?: "horizontal" | "vertical";
}) {
  const dimensions = { rows, columns };
  return (
    <>
      {(dimension ? [dimension] : (["columns", "rows"] as const)).map(
        (dimension) => (
          <ButtonGroup
            key={dimension}
            label={
              dimension === "columns"
                ? t("editor.resize.columns")
                : t("editor.resize.rows")
            }
            orientation={orientation}
          >
            {[-1, 1].map((change) => {
              const label = `${change > 0 ? "Add" : "Remove"} ${dimension === "columns" ? "column" : "row"}`;
              const limited =
                change > 0
                  ? dimensions[dimension] >= gridLimit
                  : dimensions[dimension] <= 1;
              const limit =
                change > 0
                  ? `Maximum ${gridLimit} ${dimension}`
                  : `Minimum one ${dimension === "columns" ? "column" : "row"}`;
              return (
                <Button
                  key={change}
                  variant="icon"
                  aria-label={label}
                  title={limited ? limit : label}
                  data-resize-action={change > 0 ? "add" : "remove"}
                  disabled={limited}
                  onClick={() =>
                    onResize(dimension, dimensions[dimension] + change)
                  }
                >
                  {(() => {
                    const Icon =
                      dimension === "columns"
                        ? change > 0
                          ? ArrowRightFromLine
                          : ArrowLeftToLine
                        : change > 0
                          ? ArrowDownFromLine
                          : ArrowUpToLine;
                    return <Icon aria-hidden="true" className="size-6!" />;
                  })()}
                </Button>
              );
            })}
          </ButtonGroup>
        ),
      )}
    </>
  );
}
