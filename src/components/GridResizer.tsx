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
      className="tw:grid tw:grid-cols-[44px_minmax(0,1fr)_44px] tw:grid-rows-[minmax(0,1fr)_44px] tw:gap-[8px]"
    >
      <div className="tw:col-start-2 tw:row-start-1 tw:flex tw:min-h-0 tw:min-w-0 tw:items-center tw:justify-center">
        <div
          ref={contentRef}
          data-preview-content
          style={{
            width: previewWidth,
            maxWidth: "100%",
            paddingTop: heading ? "var(--canvas-inset,0px)" : 0,
          }}
          className="tw:relative tw:isolate tw:flex tw:min-w-0 tw:flex-col tw:gap-[var(--heading-gap,0px)] tw:[container-type:inline-size]"
        >
          <span
            aria-hidden="true"
            data-image-canvas-background
            className="tw:pointer-events-none tw:absolute tw:inset-y-0 tw:left-0 tw:right-[var(--preview-scrollbar-width,0px)] tw:-z-10 tw:bg-(--board-bg)"
          />
          {heading && (
            <div className="tw:overflow-hidden tw:px-[var(--canvas-inset,0px)] tw:[scrollbar-gutter:stable]">
              {heading}
            </div>
          )}
          <div
            ref={viewportRef}
            data-canvas-viewport
            className="tw:min-w-0 tw:overflow-auto tw:overscroll-contain tw:[scrollbar-gutter:stable]"
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
              ? "tw:pointer-events-none tw:col-start-3 tw:row-start-1 tw:flex tw:items-center tw:justify-center tw:translate-y-[var(--column-control-offset,0px)]"
              : "tw:col-start-2 tw:row-start-2 tw:flex tw:items-center tw:justify-center tw:translate-x-[var(--row-control-offset,0px)]"
          }
        >
          <ButtonGroup
            className="tw:pointer-events-auto"
            label={dimension === "columns" ? "Column controls" : "Row controls"}
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
                  <Arrow aria-hidden="true" className="tw:size-[22px]!" />
                </Button>
              );
            })}
          </ButtonGroup>
        </div>
      ))}
    </div>
  );
}
