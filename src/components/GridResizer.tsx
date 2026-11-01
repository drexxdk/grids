import { t } from "../i18n";
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp } from "lucide-react";
import {
  useLayoutEffect,
  useRef,
  type CSSProperties,
  type ReactNode,
  type Ref,
} from "react";
import { gridLimit } from "../model";
import { Button, ButtonGroup } from "./ui/controls";

export function GridResizer({
  ref,
  style,
  viewportHeight,
  previewWidth,
  heading,
  rows,
  columns,
  onResize,
  children,
}: {
  ref?: Ref<HTMLDivElement>;
  style?: CSSProperties;
  viewportHeight?: number;
  previewWidth?: number;
  heading?: ReactNode;
  rows: number;
  columns: number;
  onResize: (dimension: "rows" | "columns", value: number) => void;
  children: ReactNode;
}) {
  const dimensions = { rows, columns };
  const contentRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const columnControlsRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const content = contentRef.current;
    const viewport = viewportRef.current;
    const controls = columnControlsRef.current;
    const area = content?.parentElement;
    if (!content || !viewport || !controls || !area) return;
    const update = () => {
      const grid = viewport.getBoundingClientRect();
      const frame = area.getBoundingClientRect();
      controls.style.setProperty(
        "--column-control-offset",
        `${grid.top + viewport.clientHeight / 2 - frame.top - frame.height / 2}px`,
      );
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(content);
    observer.observe(viewport);
    observer.observe(area);
    return () => observer.disconnect();
  }, [viewportHeight, previewWidth]);
  return (
    <div
      ref={ref}
      style={style}
      data-resize-frame
      className="grid grid-cols-[44px_minmax(0,1fr)_44px] grid-rows-[minmax(0,1fr)_44px] gap-2"
    >
      <div className="col-start-2 row-start-1 flex min-h-0 min-w-0 items-center justify-center">
        <div
          ref={contentRef}
          data-preview-content
          style={{
            width: previewWidth,
            maxWidth: "100%",
            paddingTop: heading ? "var(--canvas-inset,0px)" : 0,
          }}
          className="relative isolate flex min-w-0 flex-col gap-(--heading-gap,0px) @container"
        >
          <span
            aria-hidden="true"
            data-image-canvas-background
            className="pointer-events-none absolute inset-y-0 left-0 right-(--preview-scrollbar-width,0px) -z-10 bg-(--board-bg)"
          />
          {heading && (
            <div className="overflow-hidden px-(--canvas-inset,0px) scrollbar-gutter-stable">
              {heading}
            </div>
          )}
          <div
            ref={viewportRef}
            data-canvas-viewport
            className="min-w-0 overflow-auto overscroll-contain scrollbar-gutter-stable"
            style={{ height: viewportHeight }}
          >
            {children}
          </div>
        </div>
      </div>
      {(["columns", "rows"] as const).map((dimension) => (
        <div
          key={dimension}
          ref={dimension === "columns" ? columnControlsRef : undefined}
          className={
            dimension === "columns"
              ? "pointer-events-none col-start-3 row-start-1 flex items-center justify-center translate-y-(--column-control-offset,0px)"
              : "col-start-2 row-start-2 flex items-center justify-center translate-x-(--row-control-offset,0px)"
          }
        >
          <ButtonGroup
            className="pointer-events-auto"
            label={
              dimension === "columns"
                ? t("editor.resize.columns")
                : t("editor.resize.rows")
            }
            orientation={dimension === "columns" ? "vertical" : "horizontal"}
          >
            {(dimension === "columns" ? [1, -1] : [-1, 1]).map((change) => {
              const label = `${change > 0 ? "Add" : "Remove"} ${dimension === "columns" ? "column" : "row"}`;
              const limited =
                change > 0
                  ? dimensions[dimension] >= gridLimit
                  : dimensions[dimension] <= 1;
              const limit =
                change > 0
                  ? `Maximum ${gridLimit} ${dimension}`
                  : `Minimum one ${dimension === "columns" ? "column" : "row"}`;
              const Arrow =
                dimension === "columns"
                  ? change > 0
                    ? ArrowRight
                    : ArrowLeft
                  : change > 0
                    ? ArrowDown
                    : ArrowUp;
              return (
                <Button
                  key={change}
                  variant="icon"
                  aria-label={label}
                  title={limited ? limit : label}
                  disabled={limited}
                  onClick={() =>
                    onResize(dimension, dimensions[dimension] + change)
                  }
                >
                  <Arrow aria-hidden="true" className="size-5.5!" />
                </Button>
              );
            })}
          </ButtonGroup>
        </div>
      ))}
    </div>
  );
}
