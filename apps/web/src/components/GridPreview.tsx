import {
  useCallback,
  useLayoutEffect,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { flushSync } from "react-dom";
import {
  cellGeometry,
  gridSpacing,
  headingGeometry,
  previewCardMaxWidth,
  previewCardMinWidth,
  publishers,
  resolveFontWeight,
  type Asset,
  type Board,
} from "../model";
import { layoutHeading } from "../export";
import { GridResizer } from "./GridResizer";

export function GridPreview({
  board,
  assets,
  captionRows,
  onFrame,
  heading,
  bottomControls,
  sideControls,
  children,
}: {
  board: Board;
  assets: Asset[];
  captionRows: number;
  onFrame: (frame: HTMLDivElement | null) => void;
  heading: (rows: number) => ReactNode;
  bottomControls: ReactNode;
  sideControls: ReactNode;
  children: ReactNode;
}) {
  const [frame, setFrame] = useState<HTMLDivElement | null>(null);
  const attachFrame = useCallback(
    (node: HTMLDivElement | null) => {
      setFrame(node);
      onFrame(node);
    },
    [onFrame],
  );
  const [overflow, setOverflow] = useState({ width: 0, height: 0 });
  const [size, setSize] = useState<{
    width: number;
    frameHeight: number;
    previewWidth: number;
    controlsHeight: number;
    height: number;
    boardWidth: number;
    cellWidth: number;
    gap: number;
    padding: number;
    headingGap: number;
    headingRows: number;
  } | null>(null);
  useLayoutEffect(() => {
    const container = frame?.parentElement;
    if (!frame || !container) return;
    let disposed = false;
    const context = document.createElement("canvas").getContext("2d");
    if (!context) return;
    const { gap: gapRatio, padding: paddingRatio } = gridSpacing(board, 1);
    const headingGapRatio = board.headingVisible ? gapRatio : 0;
    const widthRatio =
      board.columns + (board.columns - 1) * gapRatio + paddingRatio * 2;
    const assetIds = new Set(assets.map((asset) => asset.id));
    const rowHeights = Array.from({ length: board.rows }, (_, row) => {
      const hasImage = board.cells
        .slice(row * board.columns, (row + 1) * board.columns)
        .some((cell) => cell.assetId !== null && assetIds.has(cell.assetId));
      return cellGeometry(board, 600, hasImage ? captionRows : 0).height;
    });
    const boardHeightRatio =
      rowHeights.reduce((total, height) => total + height, 0) / 600 +
      (board.rows - 1) * gapRatio +
      paddingRatio * 2;
    const fit = () => {
      if (disposed) return;
      const padding = getComputedStyle(container);
      const workspaceWidth =
        container.clientWidth - parseFloat(padding.paddingLeft) * 2;
      const toolbar = frame.previousElementSibling;
      const toolbarStyle = toolbar ? getComputedStyle(toolbar) : null;
      const toolbarHeight = toolbar
        ? toolbar.getBoundingClientRect().height +
          parseFloat(toolbarStyle!.marginTop) +
          parseFloat(toolbarStyle!.marginBottom)
        : 0;
      const workspaceHeight = Math.max(
        1,
        container.clientHeight -
          parseFloat(padding.paddingTop) * 2 -
          toolbarHeight -
          1,
      );
      const availableWidth = workspaceWidth + 12;
      const availableHeight = workspaceHeight + 12;
      const fitCellWidth = (headingRows: number) =>
        Math.max(
          previewCardMinWidth,
          Math.min(
            previewCardMaxWidth,
            availableWidth / widthRatio,
            availableHeight /
              (boardHeightRatio +
                (board.headingVisible
                  ? headingGeometry(board, 1, headingRows).height +
                    headingGapRatio
                  : 0)),
          ),
        );
      let headingRows = 1;
      if (board.headingVisible) {
        for (; headingRows < 3; headingRows++) {
          const width = fitCellWidth(headingRows);
          const headingWidth =
            Math.min(availableWidth, width * widthRatio) -
            width * paddingRatio -
            Math.max(12, width * paddingRatio);
          if (
            layoutHeading(context, board, width, headingWidth).lines.length <=
            headingRows
          )
            break;
        }
      }
      const headingRatio = board.headingVisible
        ? headingGeometry(board, 1, headingRows).height
        : 0;
      const headingAreaRatio = board.headingVisible
        ? headingRatio + headingGapRatio + paddingRatio
        : 0;
      const cellWidth = fitCellWidth(headingRows);
      const boardWidth = cellWidth * widthRatio;
      const viewportWidth = Math.max(1, Math.min(availableWidth, boardWidth));
      const height = Math.max(
        1,
        cellWidth *
          (boardHeightRatio - (board.headingVisible ? paddingRatio : 0)),
      );
      const next = {
        width: viewportWidth + 60,
        frameHeight: height + cellWidth * headingAreaRatio + 60,
        previewWidth: viewportWidth,
        controlsHeight: Math.min(
          availableHeight,
          height + cellWidth * headingAreaRatio,
        ),
        height,
        boardWidth,
        cellWidth,
        gap: cellWidth * gapRatio,
        padding: cellWidth * paddingRatio,
        headingGap: cellWidth * headingGapRatio,
        headingRows,
      };
      setSize((previous) =>
        previous &&
        (Object.keys(next) as (keyof typeof next)[]).every(
          (key) => Math.abs(previous[key] - next[key]) < 0.01,
        )
          ? previous
          : next,
      );
    };
    const observer = new ResizeObserver(() => flushSync(fit));
    observer.observe(container);
    if (frame.previousElementSibling)
      observer.observe(frame.previousElementSibling);
    fit();
    void document.fonts
      .load(
        `${resolveFontWeight(board.headingFont, board.headingFontWeight)} 48px "${board.headingFont}"`,
      )
      .then(fit);
    return () => {
      disposed = true;
      observer.disconnect();
    };
  }, [
    frame,
    board.rows,
    board.columns,
    board.gap,
    board.canvasPadding,
    board.imageAspect,
    board.captionPlacement,
    board.titlesVisible,
    board.captionAlignment,
    board.cellFontSize,
    board.headingVisible,
    board.heading,
    board.headingFont,
    board.headingFontWeight,
    board.headingFontSize,
    board.headingPadding,
    board.cells,
    assets,
    captionRows,
  ]);
  const palette = publishers[board.publisher];
  return (
    <div
      data-workspace-scroll
      data-overlay-scroll="both"
      className="relative min-h-0 flex-1 overflow-auto overscroll-x-contain"
    >
      <div className="canvas-area sticky top-0 left-0 m-0! flex h-full min-h-0 w-full shrink-0 flex-col justify-center-safe p-3! pr-0! pb-0!">
        <GridResizer
          ref={attachFrame}
          bottomControls={bottomControls}
          sideControls={sideControls}
          leadingSpace={false}
          viewportHeight={size?.height}
          controlsHeight={size?.controlsHeight}
          previewWidth={size?.previewWidth}
          onOverflowChange={setOverflow}
          heading={heading(size?.headingRows ?? 1)}
          style={
            {
              width: size?.width,
              height: size?.frameHeight,
              flexShrink: 0,
              marginInline: "auto",
              "--preview-board-width": size
                ? `${size.boardWidth}px`
                : undefined,
              "--grid-top-padding": board.headingVisible
                ? "0px"
                : `${size?.padding ?? board.canvasPadding ?? 60}px`,
              "--columns": board.columns,
              "--board-bg": board.background,
              "--gap": `${size?.gap ?? board.gap}px`,
              "--canvas-inset": `${size?.padding ?? board.canvasPadding ?? 60}px`,
              "--heading-gap": `${size?.headingGap ?? board.gap}px`,
              "--preview-cell-width": size ? `${size.cellWidth}px` : undefined,
              "--heading-font": `"${board.headingFont}"`,
              "--publisher-color": palette.color,
              "--publisher-text": board.headingTextColor ?? palette.text,
            } as CSSProperties
          }
        >
          {children}
        </GridResizer>
      </div>
      <div
        aria-hidden="true"
        data-workspace-extent
        className="pointer-events-none"
        style={{
          width: `calc(100% + ${overflow.width}px)`,
          height: overflow.height,
        }}
      />
    </div>
  );
}
