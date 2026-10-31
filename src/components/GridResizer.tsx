import { Minus, Plus, Undo2 } from "lucide-react";
import type { ReactNode } from "react";
import { gridLimit, type Asset, type OverflowCell } from "../model";
import { Button } from "./ui/controls";

export function GridResizer({
  rows,
  columns,
  onResize,
  onUndo,
  children,
}: {
  rows: number;
  columns: number;
  onResize: (dimension: "rows" | "columns", value: number) => void;
  onUndo?: () => void;
  children: ReactNode;
}) {
  const dimensions = { rows, columns };
  return (
    <div
      data-resize-frame
      className="tw:grid tw:grid-cols-[minmax(0,1fr)_44px] tw:gap-[8px]"
    >
      {children}
      {(["columns", "rows"] as const).map((dimension) => (
        <div
          key={dimension}
          role="group"
          aria-label={
            dimension === "columns" ? "Column controls" : "Row controls"
          }
          className={
            dimension === "columns"
              ? "tw:col-start-2 tw:row-start-1 tw:flex tw:flex-col tw:items-center tw:justify-center tw:gap-[8px]"
              : "tw:col-start-1 tw:row-start-2 tw:flex tw:items-center tw:justify-center tw:gap-[8px]"
          }
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
            const Icon = change > 0 ? Plus : Minus;
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
                <Icon aria-hidden="true" />
              </Button>
            );
          })}
        </div>
      ))}
      {onUndo && (
        <Button
          variant="icon"
          className="tw:col-start-2 tw:row-start-2"
          aria-label="Undo grid resize"
          title="Undo grid resize"
          onClick={onUndo}
        >
          <Undo2 aria-hidden="true" />
        </Button>
      )}
    </div>
  );
}

export function RemovedCells({
  entries,
  assets,
  onRecover,
}: {
  entries: OverflowCell[];
  assets: Asset[];
  onRecover: (entry: OverflowCell) => void;
}) {
  const occupied = entries.filter(
    (entry) => entry.cell.assetId || entry.cell.title,
  );
  if (!occupied.length) return null;
  return (
    <section aria-label="Removed cells" className="tw:mt-4">
      <h2>Removed cells</h2>
      <div className="tw:mt-2 tw:grid tw:grid-cols-[repeat(auto-fit,minmax(160px,1fr))] tw:gap-2">
        {occupied.map((entry) => {
          const asset = assets.find((item) => item.id === entry.cell.assetId);
          const title = entry.cell.title || asset?.title || "Untitled cell";
          const label = `Restore cell: ${title}`;
          return (
            <Button
              key={entry.cell.id}
              className="tw:min-h-[44px] tw:min-w-0 tw:justify-start"
              aria-label={label}
              title={label}
              onClick={() => onRecover(entry)}
            >
              {asset && (
                <img
                  src={asset.src}
                  alt=""
                  className="tw:size-[32px] tw:shrink-0 tw:object-contain"
                />
              )}
              <span className="tw:min-w-0 tw:flex-1 tw:break-words tw:text-left">
                {title}
              </span>
              <Undo2 aria-hidden="true" />
            </Button>
          );
        })}
      </div>
    </section>
  );
}
