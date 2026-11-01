import {
  useEffect,
  useLayoutEffect,
  useReducer,
  useRef,
  useState,
  type ChangeEvent,
  type CSSProperties,
  type DragEvent,
} from "react";
import { createPortal, flushSync } from "react-dom";
import { Toaster, toast } from "sonner";
import {
  PanelsTopLeft,
  Download,
  ImagePlus,
  Trash2,
  RefreshCw,
  RectangleVertical,
  RectangleHorizontal,
  Square,
  PanelTop,
  PanelBottom,
  PanelTopDashed,
  PanelBottomDashed,
} from "lucide-react";
import { Tab, TabGroup, TabList, TabPanel, TabPanels } from "@headlessui/react";
import { Button, ColorField, SelectField } from "./components/ui/controls";
import { Modal } from "./components/ui/Modal";
import { GridResizer } from "./components/GridResizer";
import {
  GridCell,
  type CardDragSource,
  type CardDragVisual,
} from "./components/GridCell";
import { EditorLayout } from "./components/EditorLayout";
import { LibraryImage } from "./components/LibraryImage";
import { UploadTile } from "./components/UploadTile";
import { ImageTabs } from "./components/ui/ImageTabs";
import {
  fontOptions,
  fontWeightOptions,
  resolveFontWeight,
  gridLimit,
  makeWorkspace,
  createResetCommand,
  createResizeCommand,
  documentReducer,
  publishers,
  getEditorSettings,
  cellGeometry,
  gridSpacing,
  type Asset,
  type Board,
  type GridPatch,
  type ImageFormat,
  type ExportSettings,
  type GridStyle,
} from "./model";
import {
  createExport,
  dimensions,
  fitTitle,
  loadImage,
  sharedCaptionRows,
} from "./export";
import { LocalWorkspaceStore, LocalWorkspaceConflictError } from "./storage";

const previewCardMinWidth = 128;
const previewCardMaxWidth = 320;
const pickerGridClassName =
  "tw:grid tw:grid-cols-[repeat(auto-fill,minmax(min(100%,var(--picker-card-min-width)),1fr))] tw:gap-4 tw:[&>*]:max-w-(--picker-card-max-width)";

function BoardHeading({
  board,
  editing,
  onEdit,
  onChange,
}: {
  board: Board;
  editing: boolean;
  onEdit: (editing: boolean) => void;
  onChange: (heading: string) => void;
}) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const fieldClass =
    "board-heading-text tw:border-0! tw:rounded-none! tw:bg-transparent tw:p-0! tw:text-inherit tw:[font:inherit] tw:cursor-text! tw:outline-none! tw:hover:bg-white/8! tw:focus:bg-white/12! tw:placeholder:text-(--muted)/35 tw:focus:placeholder:text-(--muted)/80";
  useEffect(() => {
    if (editing) input.current?.focus();
  }, [editing]);
  useLayoutEffect(() => {
    const heading = headingRef.current;
    if (!heading || !heading.parentElement) return;
    let cancelled = false;
    const fit = () => {
      if (cancelled) return;
      const context = document.createElement("canvas").getContext("2d");
      if (!context || !heading.firstElementChild) return;
      context.letterSpacing = "0.5px";
      const fontRatio = (board.headingFontSize ?? 18) / 100;
      const heightRatio = Math.max(0.28, fontRatio * 1.4);
      heading.style.fontSize = `${fitTitle(context, board.heading || "Add heading", board.headingFont, (heading.clientHeight * fontRatio) / heightRatio, heading.firstElementChild.clientWidth * 0.92, heading.clientHeight * 0.82, resolveFontWeight(board.headingFont, board.headingFontWeight)).fontSize}px`;
    };
    const observer = new ResizeObserver(fit);
    observer.observe(heading.parentElement);
    fit();
    document.fonts
      .load(
        `${resolveFontWeight(board.headingFont, board.headingFontWeight)} 48px "${board.headingFont}"`,
      )
      .then(fit);
    document.fonts.ready.then(fit);
    return () => {
      cancelled = true;
      observer.disconnect();
    };
  }, [
    board.heading,
    board.headingFont,
    board.headingFontSize,
    board.headingFontWeight,
    board.columns,
    editing,
  ]);
  return (
    <h2
      ref={headingRef}
      className="board-export-heading tw:group tw:overflow-hidden tw:p-0!"
      style={{
        fontWeight: resolveFontWeight(
          board.headingFont,
          board.headingFontWeight,
        ),
        height: `calc(var(--preview-cell-width, calc(100cqw / var(--columns))) * ${Math.max(0.28, (board.headingFontSize ?? 18) * 0.014)})`,
        ...(!board.heading.trim()
          ? {
              background:
                board.headingBackgroundColor ??
                publishers[board.publisher].caption,
            }
          : board.headingBackgroundColor
            ? { background: board.headingBackgroundColor }
            : {}),
      }}
    >
      {editing ? (
        <input
          ref={input}
          className={fieldClass}
          aria-label="Grid heading"
          maxLength={120}
          value={board.heading}
          placeholder="Add heading"
          onChange={(event) => onChange(event.target.value)}
          onBlur={() => onEdit(false)}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === "Escape") {
              event.preventDefault();
              onEdit(false);
            }
          }}
          style={{
            font: "inherit",
            color: "inherit",
            background: "transparent",
            border: 0,
            textAlign: "center",
            width: "100%",
            padding: 0,
          }}
        />
      ) : (
        <button
          className={fieldClass}
          aria-label="Edit grid heading"
          onClick={() => onEdit(true)}
        >
          {board.heading.trim() ? (
            board.heading
          ) : (
            <span
              data-heading-placeholder
              className="tw:normal-case tw:text-(--muted) tw:opacity-35 tw:group-hover:opacity-80 tw:group-focus-within:opacity-80"
            >
              Add heading
            </span>
          )}
        </button>
      )}
    </h2>
  );
}

export default function App() {
  const [workspace, dispatchDocument] = useReducer(
    documentReducer,
    undefined,
    makeWorkspace,
  );
  const localStore = useRef<LocalWorkspaceStore | null>(null);
  const savedDocument = useRef(workspace);
  const deliberateReload = useRef(false);
  const reloadButton = useRef<HTMLButtonElement>(null);
  const [conflict, setConflict] = useState(false);
  const [reloadOpen, setReloadOpen] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [canSave, setCanSave] = useState(false);
  const activeAssets = workspace.assets.filter(
    (asset) => asset.trashedAt === undefined && !asset.libraryHidden,
  );
  const [headingEditing, setHeadingEditing] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const exportButton = useRef<HTMLButtonElement>(null);
  const [imageTarget, setImageTarget] = useState<string | null>(null);
  const closeImagePicker = () => {
    setImageTarget(null);
  };
  const imageReturnFocus = useRef<HTMLButtonElement>(null);
  const uploadTarget = useRef<string | null>(null);
  const addImagesButton = useRef<HTMLButtonElement>(null);
  const [libraryDragOver, setLibraryDragOver] = useState(false);
  const [cardDrag, setCardDrag] = useState<{
    source: CardDragSource;
    visual: CardDragVisual;
    targetId: string | null;
  } | null>(null);
  useEffect(() => {
    const finish = () => {
      setCardDrag(null);
      document
        .querySelectorAll(".image-card.drag-over")
        .forEach((element) => element.classList.remove("drag-over"));
    };
    const move = (event: globalThis.DragEvent) => {
      if (!event.clientX && !event.clientY) return;
      setCardDrag((current) =>
        current
          ? {
              ...current,
              visual: { ...current.visual, x: event.clientX, y: event.clientY },
            }
          : current,
      );
    };
    const cancel = (event: KeyboardEvent) => {
      if (event.key === "Escape") finish();
    };
    window.addEventListener("dragend", finish);
    window.addEventListener("dragover", move);
    window.addEventListener("drop", finish);
    window.addEventListener("keydown", cancel);
    window.addEventListener("blur", finish);
    return () => {
      window.removeEventListener("dragend", finish);
      window.removeEventListener("dragover", move);
      window.removeEventListener("drop", finish);
      window.removeEventListener("keydown", cancel);
      window.removeEventListener("blur", finish);
    };
  }, []);
  const [importProgress, setImportProgress] = useState<{
    completed: number;
    total: number;
    pending: number;
  } | null>(null);
  const [saveStatus, setSaveStatus] = useState("Saved locally");
  const { format, resolution, quality } = workspace.exportSettings;
  const patchExport = (patch: Partial<ExportSettings>) =>
    dispatchDocument({ type: "export/patch", patch });
  const [exporting, setExporting] = useState(false);
  const replaceUpload = useRef<HTMLInputElement>(null);
  const resetButton = useRef<HTMLButtonElement>(null);
  const [resetOpen, setResetOpen] = useState(false);
  const board = workspace.grid;
  const [captionRows, setCaptionRows] = useState(1);
  const [previewFrame, setPreviewFrame] = useState<HTMLDivElement | null>(null);
  const [previewSize, setPreviewSize] = useState<{
    width: number;
    frameHeight: number;
    previewWidth: number;
    rowOffset: number;
    height: number;
    boardWidth: number;
    cellWidth: number;
    gap: number;
    padding: number;
    headingGap: number;
  } | null>(null);
  useLayoutEffect(() => {
    const frame = previewFrame;
    const container = frame?.parentElement;
    if (!frame || !container) return;
    const fit = () => {
      const padding = getComputedStyle(container);
      const availableWidth =
        container.clientWidth -
        parseFloat(padding.paddingLeft) -
        parseFloat(padding.paddingRight) -
        104;
      const toolbar = frame.previousElementSibling;
      const toolbarStyle = toolbar ? getComputedStyle(toolbar) : null;
      const toolbarHeight = toolbar
        ? toolbar.getBoundingClientRect().height +
          parseFloat(toolbarStyle!.marginTop) +
          parseFloat(toolbarStyle!.marginBottom)
        : 0;
      const availableHeight = Math.max(
        1,
        container.clientHeight -
          parseFloat(padding.paddingTop) -
          parseFloat(padding.paddingBottom) -
          toolbarHeight -
          52 -
          1,
      );
      const {
        gap: gapRatio,
        padding: paddingRatio,
        headingGap: headingGapRatio,
      } = gridSpacing(board, 1);
      const widthRatio =
        board.columns + (board.columns - 1) * gapRatio + paddingRatio * 2;
      const headingRatio = Math.max(
        0.28,
        (board.headingFontSize ?? 18) * 0.014,
      );
      const boardHeightRatio =
        (board.rows * cellGeometry(board, 600, captionRows).height) / 600 +
        (board.rows - 1) * gapRatio +
        paddingRatio * 2;
      const heightRatio = boardHeightRatio + headingRatio + headingGapRatio;
      const viewport = frame.querySelector<HTMLElement>(
        "[data-canvas-viewport]",
      );
      const scrollbarWidth = viewport
        ? viewport.offsetWidth - viewport.clientWidth
        : 0;
      const cellWidth = Math.max(
        previewCardMinWidth,
        Math.min(
          previewCardMaxWidth,
          (availableWidth - scrollbarWidth) / widthRatio,
          availableHeight / heightRatio,
        ),
      );
      const boardWidth = cellWidth * widthRatio;
      const viewportWidth = Math.max(
        1,
        Math.min(availableWidth, boardWidth + scrollbarWidth),
      );
      const horizontalScrollbar =
        boardWidth > viewportWidth - scrollbarWidth + 1 ? scrollbarWidth : 0;
      const height = Math.max(
        1,
        Math.min(
          availableHeight -
            cellWidth * (headingRatio + headingGapRatio + paddingRatio),
          cellWidth * (boardHeightRatio - paddingRatio) + horizontalScrollbar,
        ),
      );
      const next = {
        width: viewportWidth + 104,
        frameHeight:
          height +
          cellWidth * (headingRatio + headingGapRatio + paddingRatio) +
          52,
        previewWidth: viewportWidth,
        rowOffset: -scrollbarWidth / 2,
        height,
        boardWidth,
        cellWidth,
        gap: cellWidth * gapRatio,
        padding: cellWidth * paddingRatio,
        headingGap: cellWidth * headingGapRatio,
      };
      setPreviewSize((previous) =>
        previous &&
        Math.abs(previous.width - next.width) < 0.01 &&
        Math.abs(previous.frameHeight - next.frameHeight) < 0.01 &&
        Math.abs(previous.previewWidth - next.previewWidth) < 0.01 &&
        Math.abs(previous.rowOffset - next.rowOffset) < 0.01 &&
        Math.abs(previous.height - next.height) < 0.01 &&
        Math.abs(previous.boardWidth - next.boardWidth) < 0.01 &&
        Math.abs(previous.cellWidth - next.cellWidth) < 0.01 &&
        Math.abs(previous.gap - next.gap) < 0.01 &&
        Math.abs(previous.padding - next.padding) < 0.01 &&
        Math.abs(previous.headingGap - next.headingGap) < 0.01
          ? previous
          : next,
      );
    };
    const fitBeforePaint = () => flushSync(fit);
    const observer = new ResizeObserver(fitBeforePaint);
    observer.observe(container);
    if (frame.previousElementSibling)
      observer.observe(frame.previousElementSibling);
    window.addEventListener("resize", fitBeforePaint);
    fit();
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", fitBeforePaint);
    };
  }, [
    previewFrame,
    board.rows,
    board.columns,
    board.gap,
    board.canvasPadding,
    board.imageAspect,
    board.captionPlacement,
    board.captionAlignment,
    board.headingFontSize,
    captionRows,
  ]);
  useLayoutEffect(() => {
    let active = true;
    const update = () => {
      if (active)
        setCaptionRows(sharedCaptionRows(board, workspace.assets, true));
    };
    update();
    void document.fonts
      .load(
        `${resolveFontWeight(board.cellFont, board.cellFontWeight)} 48px "${board.cellFont}"`,
      )
      .then(update);
    return () => {
      active = false;
    };
  }, [
    board.cells,
    board.cellFont,
    board.cellFontSize,
    board.cellFontWeight,
    workspace.assets,
  ]);
  const palette = publishers[board.publisher];
  const size = dimensions(
    board,
    resolution,
    sharedCaptionRows(board, workspace.assets),
  );
  useEffect(() => {
    let cancelled = false;
    const store = new LocalWorkspaceStore(() => {
      if (cancelled) return;
      setCanSave(false);
      setConflict(true);
      setSaveStatus("Changed in another tab");
    });
    localStore.current = store;
    const checkForChanges = () => {
      void store.checkForChanges().catch(() => undefined);
    };
    const visible = () => {
      if (document.visibilityState === "visible") checkForChanges();
    };
    window.addEventListener("focus", checkForChanges);
    document.addEventListener("visibilitychange", visible);
    store
      .load()
      .then((restored) => {
        if (cancelled) return;
        savedDocument.current = restored;
        dispatchDocument({ type: "workspace/restore", workspace: restored });
        setCanSave(true);
        setLoaded(true);
      })
      .catch((error) => {
        if (cancelled) return;
        setSaveStatus("Session only");
        toast.error(
          error instanceof Error
            ? `${error.message} Editing and exports remain available for this session.`
            : "Local storage is unavailable. Editing and exports remain available for this session.",
        );
        setLoaded(true);
      });
    return () => {
      cancelled = true;
      window.removeEventListener("focus", checkForChanges);
      document.removeEventListener("visibilitychange", visible);
      store.dispose();
      if (localStore.current === store) localStore.current = null;
    };
  }, []);
  useEffect(() => {
    if (!loaded) return;
    const store = localStore.current;
    let cancelled = false;
    let started = false;
    const save = () => {
      if (
        started ||
        !canSave ||
        !store ||
        (savedDocument.current === workspace && store.hasSavedSnapshot)
      )
        return;
      started = true;
      store
        .save(workspace)
        .then(() => {
          if (cancelled) return;
          savedDocument.current = workspace;
          setSaveStatus("Saved locally");
        })
        .catch((error) => {
          if (cancelled) return;
          if (error instanceof LocalWorkspaceConflictError) return;
          setSaveStatus("Save failed");
          toast.error(
            "Local save failed. Your current grid can still be exported.",
            { id: "local-save-failed" },
          );
        });
    };
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (deliberateReload.current || savedDocument.current === workspace)
        return;
      event.preventDefault();
      event.returnValue = "";
    };
    const visibilityChange = () => {
      if (document.visibilityState === "hidden") save();
    };
    let timer: ReturnType<typeof setTimeout> | undefined;
    if (
      canSave &&
      store &&
      !(savedDocument.current === workspace && store.hasSavedSnapshot)
    ) {
      setSaveStatus("Saving locally");
      if (document.visibilityState === "hidden") save();
      else timer = setTimeout(save, 300);
    }
    window.addEventListener("beforeunload", beforeUnload);
    window.addEventListener("pagehide", save);
    document.addEventListener("visibilitychange", visibilityChange);
    return () => {
      cancelled = true;
      if (timer !== undefined) clearTimeout(timer);
      window.removeEventListener("beforeunload", beforeUnload);
      window.removeEventListener("pagehide", save);
      document.removeEventListener("visibilitychange", visibilityChange);
    };
  }, [workspace, canSave, loaded]);
  const deleteImages = (assetIds: string[]) => {
    localStore.current?.scheduleImageDeletion(assetIds);
    dispatchDocument({ type: "assets/delete", assetIds });
    requestAnimationFrame(() =>
      addImagesButton.current?.focus({ preventScroll: true }),
    );
  };
  const patchBoard = (patch: GridPatch) =>
    dispatchDocument({ type: "grid/patch", gridId: board.id, patch });
  const placeAsset = (id: string, cellId: string) => {
    dispatchDocument({
      type: "cell/place",
      gridId: board.id,
      cellId,
      assetId: id,
    });
  };
  const resize = (key: "rows" | "columns", input: number) => {
    const value = Math.max(1, Math.min(gridLimit, Math.round(input) || 1));
    if (value === board[key]) return;
    const rows = key === "rows" ? value : board.rows;
    const columns = key === "columns" ? value : board.columns;
    dispatchDocument(createResizeCommand(board.id, rows, columns));
  };
  const importFiles = async (
    files: FileList | null,
    targetCellId: string | null = null,
  ) => {
    const store = localStore.current;
    if (!store) return;
    const batch = Array.from(files ?? []);
    if (!batch.length) return;
    setImportProgress((current) => ({
      completed: current?.completed ?? 0,
      total: (current?.total ?? 0) + batch.length,
      pending: (current?.pending ?? 0) + 1,
    }));
    const targetId = board.id;
    const assets: Asset[] = [];
    try {
      for (const file of batch) {
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
        if (!file.type.startsWith("image/")) {
          toast.error(`${file.name} is not an image.`);
          setImportProgress((current) =>
            current ? { ...current, completed: current.completed + 1 } : null,
          );
          continue;
        }
        let asset: Asset | null = null;
        try {
          if (localStore.current !== store) return;
          asset = store.createAsset(
            file,
            file.name
              .replace(/\.[^.]+$/, "")
              .replace(/[-_]/g, " ")
              .replace(/\s+/g, " ")
              .trim(),
          );
          await loadImage(asset.src);
          if (localStore.current !== store) return;
          assets.push(asset);
        } catch {
          if (asset) store.releaseAsset(asset.id);
          toast.error(
            `Could not load ${file.name}. Try a PNG, JPEG, or WebP image.`,
          );
        } finally {
          setImportProgress((current) =>
            current ? { ...current, completed: current.completed + 1 } : null,
          );
        }
      }
      dispatchDocument({
        type: "assets/import",
        gridId: targetId,
        cellId: targetCellId ?? null,
        assets,
      });
    } finally {
      setImportProgress((current) =>
        current && current.pending > 1
          ? { ...current, pending: current.pending - 1 }
          : null,
      );
    }
  };
  const touchDrag = (
    source: CardDragSource,
    visual: CardDragVisual,
    finished: boolean,
    cancelled: boolean,
  ) => {
    const targetId =
      document
        .elementFromPoint(visual.x, visual.y)
        ?.closest(".grid-cell")
        ?.getAttribute("data-cell-id") ?? null;
    const validTarget = board.cells.some((cell) => cell.id === targetId);
    if (finished || cancelled) {
      setCardDrag(null);
      if (!cancelled && validTarget && source.kind === "asset") {
        placeAsset(source.assetId, targetId!);
        if (imageTarget) closeImagePicker();
      }
      if (
        !cancelled &&
        validTarget &&
        source.kind === "cell" &&
        source.gridId === board.id &&
        source.cellId !== targetId &&
        board.cells.some((cell) => cell.id === source.cellId)
      ) {
        dispatchDocument({
          type: "cell/swap",
          gridId: board.id,
          sourceCellId: source.cellId,
          targetCellId: targetId!,
        });
      }
      return;
    }
    setCardDrag({
      source,
      visual,
      targetId:
        validTarget && (source.kind === "asset" || source.cellId !== targetId)
          ? targetId
          : null,
    });
  };
  const drop = (event: DragEvent<HTMLDivElement>, index: number) => {
    event.preventDefault();
    setCardDrag(null);
    event.currentTarget.classList.remove("drag-over");
    const assetId =
      event.dataTransfer.getData("application/x-gridroom-asset") ||
      (cardDrag?.source.kind === "asset" ? cardDrag.source.assetId : "");
    const sourceIndex = event.dataTransfer.getData(
      "application/x-gridroom-cell",
    );
    if (assetId) placeAsset(assetId, board.cells[index].id);
    else if (sourceIndex !== "" || cardDrag?.source.kind === "cell") {
      let dragged: { boardId?: string; cellId?: string } | null =
        cardDrag?.source.kind === "cell"
          ? { boardId: cardDrag.source.gridId, cellId: cardDrag.source.cellId }
          : null;
      try {
        if (sourceIndex !== "") dragged = JSON.parse(sourceIndex);
      } catch {
        return;
      }
      if (dragged?.boardId !== board.id) return;
      const source = board.cells.findIndex(
        (entry) => entry.id === dragged.cellId,
      );
      if (
        Number.isInteger(source) &&
        source >= 0 &&
        source < board.rows * board.columns
      ) {
        dispatchDocument({
          type: "cell/swap",
          gridId: board.id,
          sourceCellId: board.cells[source].id,
          targetCellId: board.cells[index].id,
        });
      }
    } else if (event.dataTransfer.files.length) {
      importFiles(event.dataTransfer.files, board.cells[index].id);
    }
  };
  const exportGrid = async () => {
    if (exporting) return;
    setExporting(true);
    const item = structuredClone(board);
    const extension = {
      "image/png": "png",
      "image/jpeg": "jpg",
      "image/webp": "webp",
    }[format];
    try {
      const blob = await createExport(
        item,
        workspace.assets,
        resolution,
        format,
        quality / 100,
        window.matchMedia("(max-width: 767px), (any-pointer: coarse)").matches
          ? 16_000_000
          : 32_000_000,
      );
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${
        item.name
          .replace(/[^a-z0-9 -]/gi, "")
          .trim()
          .replace(/\s+/g, "-")
          .toLowerCase() || "board"
      }.${extension}`;
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
      setExportOpen(false);
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Export failed. Try a smaller resolution.",
      );
    } finally {
      setExporting(false);
    }
  };
  const upload = async (
    event: ChangeEvent<HTMLInputElement>,
    target: string | null = null,
  ) => {
    const input = event.currentTarget;
    await importFiles(input.files, target);
    input.value = "";
  };
  const resetDefaults = () => {
    dispatchDocument(createResetCommand());
    setImageTarget(null);
    setResetOpen(false);
  };
  if (!loaded) {
    return (
      <main
        className="tw:grid tw:min-h-dvh tw:place-items-center"
        aria-busy="true"
      >
        <p role="status">Loading grid...</p>
      </main>
    );
  }
  return (
    <>
      <main className="app-layout tw:min-h-dvh! tw:min-[901px]:grid-cols-[250px_minmax(0,1fr)_250px]! tw:max-[900px]:block! tw:max-[900px]:pb-[var(--editor-drawer-height,160px)]">
        <EditorLayout
          actions={
            <div className="tw:flex tw:flex-col tw:items-end tw:gap-2 tw:max-[900px]:contents">
              <span
                id="save-status"
                className="save-status tw:max-[900px]:col-span-3 tw:max-[900px]:row-start-2 tw:max-[900px]:min-w-0 tw:max-[900px]:break-words"
                hidden={
                  saveStatus === "Saved locally" ||
                  saveStatus === "Saving locally"
                }
                title="Your grid is kept when you reload or reopen this page in the same browser. It is not synced to other devices."
              >
                {saveStatus === "Saved locally"
                  ? "Saved in this browser"
                  : saveStatus === "Saving locally"
                    ? "Saving changes..."
                    : saveStatus}
              </span>
              <button
                id="export-grid-header"
                ref={exportButton}
                type="button"
                aria-haspopup="dialog"
                title="Export grid"
                aria-label="Export grid"
                className="button secondary tw:min-[901px]:w-full tw:max-[900px]:col-start-3 tw:max-[900px]:row-start-1 tw:max-[900px]:h-[44px] tw:max-[900px]:w-[44px] tw:max-[900px]:p-0"
                disabled={exporting}
                onClick={() => setExportOpen(true)}
              >
                <Download />
                <span className="tw:max-[900px]:hidden">Export grid</span>
              </button>
            </div>
          }
        >
          {(drawerToggle, toolsExpanded) => (
            <aside
              className={`asset-panel tw:min-[901px]:p-0! tw:min-[901px]:sticky tw:min-[901px]:top-0 tw:min-[901px]:h-dvh tw:min-[901px]:self-start tw:min-[901px]:overflow-hidden tw:min-[901px]:[&_.asset-library]:grid-cols-2! ${libraryDragOver ? "tw:outline-2 tw:outline-offset-[-2px] tw:outline-(--mint)" : ""}`}
              aria-label="Image library drop zone"
              aria-busy={importProgress !== null}
              onDragOver={(event) => {
                if (event.dataTransfer.types.includes("Files")) {
                  event.preventDefault();
                  event.dataTransfer.dropEffect = "copy";
                  setLibraryDragOver(true);
                }
              }}
              onDragLeave={(event) => {
                if (
                  !(event.relatedTarget instanceof Node) ||
                  !event.currentTarget.contains(event.relatedTarget)
                )
                  setLibraryDragOver(false);
              }}
              onDrop={(event) => {
                event.preventDefault();
                setLibraryDragOver(false);
                if (event.dataTransfer.files.length)
                  void importFiles(event.dataTransfer.files);
              }}
            >
              <div
                data-sidebar-header
                className="tw:flex tw:min-h-[76px] tw:shrink-0 tw:items-center tw:border-0 tw:border-b tw:border-solid tw:border-(--line) tw:px-[16px] tw:py-[16px] tw:max-[900px]:hidden"
              >
                <a className="brand" href="./">
                  <span className="brand-mark">
                    <PanelsTopLeft />
                  </span>
                  Grids
                </a>
              </div>
              <div
                data-sidebar-content
                className="tw:contents tw:min-[901px]:flex tw:min-[901px]:min-h-0 tw:min-[901px]:flex-1 tw:min-[901px]:flex-col tw:min-[901px]:overflow-y-auto tw:min-[901px]:overflow-x-hidden tw:min-[901px]:px-[16px] tw:min-[901px]:pt-4 tw:min-[901px]:pb-[26px] tw:min-[901px]:[scrollbar-gutter:stable] tw:min-[901px]:[&>*]:shrink-0"
              >
                <div className="tw:mb-1 tw:flex tw:items-center tw:justify-between tw:gap-2">
                  <TabGroup>
                    <ImageTabs
                      label="Image source"
                      tabs={[
                        { label: "Imported" },
                        {
                          label: "Online",
                          disabled: true,
                          title: "Online providers are not available yet",
                        },
                      ]}
                    />
                  </TabGroup>
                  {drawerToggle}
                </div>
                <div id="asset-library" className="asset-library">
                  <UploadTile
                    ref={addImagesButton}
                    progress={importProgress}
                    gridStyle={board}
                    captionRows={captionRows}
                    className="tw:self-start tw:w-full tw:max-[900px]:w-[82px]"
                    onClick={() => document.getElementById("upload")?.click()}
                    onDropFiles={(files) => {
                      setLibraryDragOver(false);
                      void importFiles(files);
                    }}
                  />
                  {activeAssets.map((asset) => (
                    <LibraryImage
                      key={asset.id}
                      asset={asset}
                      cell={board.cells.find(
                        (cell) => cell.assetId === asset.id,
                      )}
                      gridStyle={board}
                      captionRows={captionRows}
                      onTitle={(title) =>
                        dispatchDocument({
                          type: "asset/title",
                          assetId: asset.id,
                          title,
                        })
                      }
                      disabled={false}
                      moving={cardDrag !== null}
                      dragAffected={
                        cardDrag?.source.kind === "asset" &&
                        cardDrag.source.assetId === asset.id
                      }
                      onMoveStart={(source, visual) =>
                        setCardDrag({ source, visual, targetId: null })
                      }
                      onTouchDrag={touchDrag}
                      onDelete={() => deleteImages([asset.id])}
                    />
                  ))}
                </div>
                <input
                  id="upload"
                  type="file"
                  accept="image/*"
                  multiple
                  hidden
                  onChange={(event) => upload(event)}
                />
                {toolsExpanded && activeAssets.length > 0 && (
                  <Button
                    className="tw:mt-2 tw:min-h-[44px] tw:w-full"
                    onClick={() =>
                      deleteImages(activeAssets.map((asset) => asset.id))
                    }
                  >
                    <Trash2 aria-hidden="true" />
                    Clear all images
                  </Button>
                )}
              </div>
            </aside>
          )}
          {(canvasActions) => (
            <section
              className="workspace tw:flex tw:h-dvh tw:flex-col tw:overflow-hidden tw:max-[900px]:h-[calc(100dvh-var(--editor-drawer-height,160px))]"
              style={
                {
                  backgroundColor: "#121415",
                } as CSSProperties
              }
              aria-label="Grid editor"
            >
              {conflict && (
                <div
                  role="alert"
                  className="tw:flex tw:flex-wrap tw:items-center tw:justify-between tw:gap-3 tw:border-0 tw:border-b tw:border-solid tw:border-(--line) tw:p-4"
                >
                  <p className="tw:m-0 tw:min-w-0 tw:text-sm">
                    Another tab saved a newer grid. This tab is not saving.
                  </p>
                  <Button
                    ref={reloadButton}
                    onClick={() => setReloadOpen(true)}
                  >
                    <RefreshCw aria-hidden="true" />
                    Reload saved grid
                  </Button>
                </div>
              )}
              <div className="canvas-area tw:m-0! tw:flex tw:min-h-0 tw:w-full tw:flex-1 tw:flex-col tw:justify-center tw:p-[12px]! tw:max-[900px]:pr-[calc(12px+var(--native-scrollbar-width,0px))]!">
                <div
                  role="toolbar"
                  aria-label="Grid appearance"
                  className="tw:mx-auto tw:mb-3 tw:grid tw:max-w-full tw:shrink-0 tw:grid-cols-[44px_minmax(0,1fr)_44px] tw:items-start tw:gap-[8px]"
                  style={{ width: previewSize?.width }}
                >
                  {canvasActions}
                  <div
                    className="tw:col-start-2 tw:row-start-1 tw:flex tw:min-w-0 tw:flex-wrap tw:items-center tw:justify-center tw:gap-2 tw:translate-x-[var(--row-control-offset,0px)]"
                    style={
                      {
                        "--row-control-offset": `${previewSize?.rowOffset ?? 0}px`,
                      } as CSSProperties
                    }
                  >
                    <div className="tw:w-[116px] tw:max-[600px]:w-[60px]">
                      <SelectField
                        compact
                        id="image-shape"
                        label="Image shape"
                        value={board.imageAspect ?? "square"}
                        options={[
                          {
                            value: "portrait",
                            label: "Portrait",
                            icon: RectangleVertical,
                          },
                          {
                            value: "landscape",
                            label: "Landscape",
                            icon: RectangleHorizontal,
                          },
                          { value: "square", label: "Square", icon: Square },
                        ]}
                        onChange={(imageAspect) =>
                          patchBoard({
                            imageAspect: imageAspect as NonNullable<
                              Board["imageAspect"]
                            >,
                          })
                        }
                      />
                    </div>
                    <div className="tw:w-[148px] tw:max-[600px]:w-[60px]">
                      <SelectField
                        compact
                        id="caption-position"
                        label="Caption position"
                        value={
                          board.captionPlacement === "overlay"
                            ? `overlay-${board.captionAlignment === "top" ? "top" : "bottom"}`
                            : (board.captionPlacement ?? "below")
                        }
                        options={[
                          {
                            value: "above",
                            label: "Above image",
                            icon: PanelTop,
                          },
                          {
                            value: "below",
                            label: "Below image",
                            icon: PanelBottom,
                          },
                          {
                            value: "overlay-top",
                            label: "Overlay top",
                            icon: PanelTopDashed,
                          },
                          {
                            value: "overlay-bottom",
                            label: "Overlay bottom",
                            icon: PanelBottomDashed,
                          },
                        ]}
                        onChange={(position) =>
                          patchBoard(
                            position === "above" || position === "below"
                              ? { captionPlacement: position }
                              : {
                                  captionPlacement: "overlay",
                                  captionAlignment:
                                    position === "overlay-top"
                                      ? "top"
                                      : "bottom",
                                },
                          )
                        }
                      />
                    </div>
                  </div>
                </div>
                <GridResizer
                  ref={setPreviewFrame}
                  viewportHeight={previewSize?.height}
                  previewWidth={previewSize?.previewWidth}
                  heading={
                    <BoardHeading
                      board={board}
                      editing={headingEditing}
                      onEdit={setHeadingEditing}
                      onChange={(heading) => patchBoard({ heading })}
                    />
                  }
                  style={
                    {
                      width: previewSize?.width,
                      height: previewSize?.frameHeight,
                      flexShrink: 0,
                      "--row-control-offset": `${previewSize?.rowOffset ?? 0}px`,
                      "--preview-scrollbar-width": `${-(previewSize?.rowOffset ?? 0) * 2}px`,
                      "--grid-top-padding": "0px",
                      maxWidth: "100%",
                      marginInline: "auto",
                      "--columns": board.columns,
                      "--board-bg": board.background,
                      "--gap": `${previewSize?.gap ?? board.gap}px`,
                      "--canvas-inset": `${previewSize?.padding ?? board.canvasPadding ?? 12}px`,
                      "--heading-gap": `${previewSize?.headingGap ?? board.gap}px`,
                      "--preview-cell-width": previewSize
                        ? `${previewSize.cellWidth}px`
                        : undefined,
                      "--heading-font": `"${board.headingFont}"`,
                      "--publisher-color": palette.color,
                      "--publisher-text":
                        board.headingTextColor ?? palette.text,
                    } as CSSProperties
                  }
                  rows={board.rows}
                  columns={board.columns}
                  onResize={resize}
                >
                  <div
                    id="board-grid"
                    className="board-grid"
                    aria-label="Image grid"
                    style={
                      {
                        width: previewSize?.boardWidth,
                        "--columns": board.columns,
                        "--gap": `${previewSize?.gap ?? board.gap}px`,
                        "--preview-cell-width": previewSize
                          ? `${previewSize.cellWidth}px`
                          : undefined,
                        "--board-bg": board.background,
                        "--publisher-color": palette.color,
                        "--publisher-text":
                          board.headingTextColor ?? palette.text,
                        "--caption-color": palette.caption,
                        "--heading-font": `"${board.headingFont}"`,
                        "--cell-font": `"${board.cellFont}"`,
                      } as CSSProperties
                    }
                  >
                    {board.cells
                      .slice(0, board.rows * board.columns)
                      .map((item, index) => {
                        const asset = workspace.assets.find(
                          (asset) => asset.id === item.assetId,
                        );
                        const isSource =
                          cardDrag?.source.kind === "cell" &&
                          cardDrag.source.gridId === board.id &&
                          cardDrag.source.cellId === item.id;
                        return (
                          <GridCell
                            key={item.id}
                            cell={item}
                            asset={asset}
                            canChoose={activeAssets.length > 0}
                            index={index}
                            gridId={board.id}
                            gridStyle={board}
                            captionRows={captionRows}
                            moving={cardDrag !== null}
                            dragSource={isSource}
                            dragAffected={
                              isSource || cardDrag?.targetId === item.id
                            }
                            onMoveStart={(source, visual) =>
                              setCardDrag({ source, visual, targetId: null })
                            }
                            onTouchDrag={touchDrag}
                            onMoveOver={() =>
                              setCardDrag((current) =>
                                current && current.targetId !== item.id
                                  ? { ...current, targetId: item.id }
                                  : current,
                              )
                            }
                            onMoveLeave={() =>
                              setCardDrag((current) =>
                                current?.targetId === item.id
                                  ? { ...current, targetId: null }
                                  : current,
                              )
                            }
                            onCrop={(crop, assetId) =>
                              dispatchDocument({
                                type: "cell/crop",
                                gridId: board.id,
                                cellId: item.id,
                                assetId,
                                crop,
                              })
                            }
                            onPatch={(patch) =>
                              dispatchDocument(
                                asset && patch.title !== undefined
                                  ? {
                                      type: "asset/title",
                                      assetId: asset.id,
                                      title: patch.title,
                                    }
                                  : {
                                      type: "cell/patch",
                                      gridId: board.id,
                                      cellId: item.id,
                                      patch,
                                    },
                              )
                            }
                            onClear={() =>
                              dispatchDocument({
                                type: "cell/clear",
                                gridId: board.id,
                                cellId: item.id,
                              })
                            }
                            onChoose={(trigger) => {
                              imageReturnFocus.current = trigger;
                              setImageTarget(item.id);
                            }}
                            onUpload={() => {
                              uploadTarget.current = item.id;
                              replaceUpload.current?.click();
                            }}
                            onDrop={(event) => drop(event, index)}
                          />
                        );
                      })}
                  </div>
                </GridResizer>
              </div>
            </section>
          )}
          {(settingsActions) => (
            <aside
              className="settings-panel tw:block! tw:min-[901px]:flex! tw:min-[901px]:flex-col tw:min-[901px]:p-0! tw:min-[901px]:sticky tw:min-[901px]:top-0 tw:min-[901px]:h-dvh tw:min-[901px]:self-start tw:min-[901px]:overflow-hidden"
              aria-label="Grid settings"
            >
              {settingsActions && (
                <div
                  data-sidebar-header
                  className="tw:min-h-[76px] tw:shrink-0 tw:border-0 tw:border-b tw:border-solid tw:border-(--line) tw:p-[16px]"
                >
                  {settingsActions}
                </div>
              )}
              <div
                data-sidebar-content
                className="tw:contents tw:min-[901px]:block tw:min-[901px]:min-h-0 tw:min-[901px]:flex-1 tw:min-[901px]:overflow-y-auto tw:min-[901px]:overflow-x-hidden tw:min-[901px]:px-[16px] tw:min-[901px]:[scrollbar-gutter:stable]"
              >
                <div className="tw:flex tw:flex-col tw:gap-3 tw:py-3">
                  <fieldset
                    className="tw:m-0 tw:min-w-0 tw:rounded-[6px] tw:border tw:border-solid tw:border-[#3c4248] tw:bg-[#24282c] tw:p-3"
                    aria-label="Canvas style"
                  >
                    <h3 className="tw:mt-0 tw:text-sm tw:font-semibold">
                      Canvas style
                    </h3>
                    <ColorField
                      id="background"
                      label="Background"
                      value={board.background}
                      onChange={(background) => patchBoard({ background })}
                    />
                    <label className="field-label" htmlFor="canvas-padding">
                      Padding{" "}
                      <output id="canvas-padding-value">
                        {Math.round(((board.canvasPadding ?? 12) / 6) * 10) /
                          10}
                        %
                      </output>
                    </label>
                    <input
                      id="canvas-padding"
                      type="range"
                      min="0"
                      max="20"
                      step="0.5"
                      value={(board.canvasPadding ?? 12) / 6}
                      onChange={(event) =>
                        patchBoard({
                          canvasPadding: Number(event.target.value) * 6,
                        })
                      }
                    />
                    <label className="field-label" htmlFor="gap">
                      Gap{" "}
                      <output id="gap-value">
                        {Math.round((board.gap / 6) * 10) / 10}%
                      </output>
                    </label>
                    <input
                      id="gap"
                      type="range"
                      min="0"
                      max="20"
                      step="0.5"
                      value={board.gap / 6}
                      onChange={(event) =>
                        patchBoard({ gap: Number(event.target.value) * 6 })
                      }
                    />
                  </fieldset>
                  <fieldset
                    className="tw:m-0 tw:min-w-0 tw:rounded-[6px] tw:border tw:border-solid tw:border-[#3a4b3e] tw:bg-[#202a24] tw:p-3"
                    aria-label="Heading style"
                  >
                    <h3 className="tw:mt-0 tw:text-sm tw:font-semibold">
                      Heading style
                    </h3>
                    <SelectField
                      id="heading-font"
                      largeFontPreview
                      label="Font"
                      value={board.headingFont}
                      options={fontOptions.map((font) => ({
                        value: font,
                        label: font,
                        fontFamily: font,
                        fontWeight: resolveFontWeight(
                          font,
                          board.headingFontWeight,
                        ),
                      }))}
                      onChange={(headingFont) =>
                        patchBoard({
                          headingFont,
                          headingFontWeight: resolveFontWeight(
                            headingFont,
                            board.headingFontWeight,
                          ),
                        })
                      }
                    />
                    <label
                      className="field-label"
                      htmlFor="heading-font-weight"
                    >
                      Font weight{" "}
                      <output>
                        {resolveFontWeight(
                          board.headingFont,
                          board.headingFontWeight,
                        )}
                      </output>
                    </label>
                    <input
                      id="heading-font-weight"
                      type="range"
                      min={board.headingFont === "Manrope" ? 100 : 400}
                      max={board.headingFont === "Manrope" ? 900 : 700}
                      step={board.headingFont === "Manrope" ? 100 : 300}
                      value={resolveFontWeight(
                        board.headingFont,
                        board.headingFontWeight,
                      )}
                      aria-valuetext={
                        fontWeightOptions(board.headingFont).find(
                          (option) =>
                            option.value ===
                            resolveFontWeight(
                              board.headingFont,
                              board.headingFontWeight,
                            ),
                        )?.label
                      }
                      onChange={(event) =>
                        patchBoard({
                          headingFontWeight: Number(event.target.value),
                        })
                      }
                    />
                    <label className="field-label" htmlFor="heading-font-size">
                      Font size <output>{board.headingFontSize ?? 18}%</output>
                    </label>
                    <input
                      id="heading-font-size"
                      type="range"
                      min="6"
                      max="36"
                      value={board.headingFontSize ?? 18}
                      onChange={(event) =>
                        patchBoard({
                          headingFontSize: Number(event.target.value),
                        })
                      }
                    />
                    <ColorField
                      id="heading-text-color"
                      label="Text color"
                      value={board.headingTextColor ?? palette.text}
                      onChange={(headingTextColor) =>
                        patchBoard({ headingTextColor })
                      }
                    />
                    <ColorField
                      id="heading-background-color"
                      label="Background"
                      value={
                        board.headingBackgroundColor ??
                        (!board.heading.trim()
                          ? palette.caption
                          : palette.color === "transparent"
                            ? board.background
                            : palette.color)
                      }
                      onChange={(headingBackgroundColor) =>
                        patchBoard({ headingBackgroundColor })
                      }
                    />
                  </fieldset>
                  <fieldset
                    className="tw:m-0 tw:min-w-0 tw:rounded-[6px] tw:border tw:border-solid tw:border-[#4b3b45] tw:bg-[#2b2328] tw:p-3"
                    aria-label="Card style"
                  >
                    <h3 className="tw:mt-0 tw:text-sm tw:font-semibold">
                      Card style
                    </h3>
                    <SelectField
                      id="cell-font"
                      largeFontPreview
                      label="Font"
                      value={board.cellFont}
                      options={fontOptions.map((font) => ({
                        value: font,
                        label: font,
                        fontFamily: font,
                        fontWeight: resolveFontWeight(
                          font,
                          board.cellFontWeight,
                        ),
                      }))}
                      onChange={(cellFont) =>
                        patchBoard({
                          cellFont,
                          cellFontWeight: resolveFontWeight(
                            cellFont,
                            board.cellFontWeight,
                          ),
                        })
                      }
                    />
                    <label className="field-label" htmlFor="cell-font-weight">
                      Font weight{" "}
                      <output>
                        {resolveFontWeight(
                          board.cellFont,
                          board.cellFontWeight,
                        )}
                      </output>
                    </label>
                    <input
                      id="cell-font-weight"
                      type="range"
                      min={board.cellFont === "Manrope" ? 100 : 400}
                      max={board.cellFont === "Manrope" ? 900 : 700}
                      step={board.cellFont === "Manrope" ? 100 : 300}
                      value={resolveFontWeight(
                        board.cellFont,
                        board.cellFontWeight,
                      )}
                      aria-valuetext={
                        fontWeightOptions(board.cellFont).find(
                          (option) =>
                            option.value ===
                            resolveFontWeight(
                              board.cellFont,
                              board.cellFontWeight,
                            ),
                        )?.label
                      }
                      onChange={(event) =>
                        patchBoard({
                          cellFontWeight: Number(event.target.value),
                        })
                      }
                    />
                    <label className="field-label" htmlFor="cell-font-size">
                      Font size <output>{board.cellFontSize ?? 11}%</output>
                    </label>
                    <input
                      id="cell-font-size"
                      type="range"
                      min="6"
                      max="36"
                      value={board.cellFontSize ?? 11}
                      onChange={(event) =>
                        patchBoard({ cellFontSize: Number(event.target.value) })
                      }
                    />
                    <ColorField
                      id="cell-text-color"
                      label="Text color"
                      value={board.cellTextColor ?? "#f4f4ef"}
                      onChange={(cellTextColor) =>
                        patchBoard({ cellTextColor })
                      }
                    />
                    <ColorField
                      id="cell-background-color"
                      label="Background"
                      value={board.cellBackgroundColor ?? "#111315"}
                      onChange={(cellBackgroundColor) =>
                        patchBoard({ cellBackgroundColor })
                      }
                    />
                    <ColorField
                      id="caption-overlay"
                      label="Overlay color"
                      value={board.captionOverlayColor ?? "#000000"}
                      onChange={(captionOverlayColor) =>
                        patchBoard({ captionOverlayColor })
                      }
                    />
                    <label className="field-label" htmlFor="caption-opacity">
                      Overlay opacity{" "}
                      <output>{board.captionOverlayOpacity ?? 60}%</output>
                    </label>
                    <input
                      id="caption-opacity"
                      type="range"
                      min="0"
                      max="100"
                      value={board.captionOverlayOpacity ?? 60}
                      onChange={(event) =>
                        patchBoard({
                          captionOverlayOpacity: Number(event.target.value),
                        })
                      }
                    />
                  </fieldset>
                </div>
                <div className="tw:border-0 tw:border-t tw:border-solid tw:border-(--line) tw:py-3">
                  <Button
                    ref={resetButton}
                    className="tw:min-h-[44px] tw:w-full"
                    title="Restore default grid settings; keep library images and cell captions"
                    onClick={() => setResetOpen(true)}
                  >
                    <PanelsTopLeft aria-hidden="true" />
                    Reset grid settings
                  </Button>
                </div>
              </div>
            </aside>
          )}
        </EditorLayout>
      </main>
      {cardDrag?.visual &&
        createPortal(
          <div
            aria-hidden="true"
            inert
            data-drag-floating
            className="tw:pointer-events-none tw:fixed tw:z-[100] tw:opacity-100"
            style={{
              width: cardDrag.visual.width,
              height: cardDrag.visual.height,
              left: cardDrag.visual.x - cardDrag.visual.offsetX,
              top: cardDrag.visual.y - cardDrag.visual.offsetY - 8,
              transform: "rotate(-2deg)",
              transformOrigin: `${cardDrag.visual.offsetX}px ${cardDrag.visual.offsetY}px`,
              boxShadow: "0 18px 32px #0008, 0 3px 8px #0006",
              borderRadius: "var(--board-item-radius)",
            }}
          >
            <GridCell
              cell={cardDrag.visual.cell}
              asset={cardDrag.visual.asset}
              index={0}
              gridId={board.id}
              gridStyle={board}
              captionRows={captionRows}
              previewOnly
              canChoose={false}
              onPatch={() => {}}
              onCrop={() => {}}
              onClear={() => {}}
              onChoose={() => {}}
              onUpload={() => {}}
              onDrop={(event) => event.preventDefault()}
            />
          </div>,
          document.body,
        )}
      <Toaster
        position="top-right"
        expand
        visibleToasts={3}
        closeButton
        richColors
      />
      <input
        ref={replaceUpload}
        id="replace-upload"
        type="file"
        accept="image/*"
        hidden
        onChange={(event) => upload(event, uploadTarget.current)}
      />
      <Modal
        open={exportOpen}
        onClose={() => setExportOpen(false)}
        title="Export grid"
        returnFocus={exportButton}
      >
        <SelectField
          id="format"
          label="File format"
          value={format}
          options={[
            { value: "image/png", label: "PNG" },
            { value: "image/jpeg", label: "JPEG" },
            { value: "image/webp", label: "WebP" },
          ]}
          onChange={(format) => patchExport({ format: format as ImageFormat })}
        />
        <SelectField
          id="resolution"
          label="Resolution"
          value={String(resolution)}
          options={[150, 300, 600, 1200, 1800].map((size) => ({
            value: String(size),
            label: `${size} px / image`,
          }))}
          onChange={(resolution) =>
            patchExport({ resolution: Number(resolution) })
          }
        />
        <label className="field-label quality-label" htmlFor="quality">
          Quality <output id="quality-value">{quality}%</output>
        </label>
        <input
          id="quality"
          type="range"
          min="50"
          max="100"
          value={quality}
          disabled={format === "image/png"}
          onChange={(event) =>
            patchExport({ quality: Number(event.target.value) })
          }
        />
        <p className="tw:text-sm tw:text-(--muted)">
          {size.width} × {size.height} px
        </p>
        <div className="tw:mt-5 tw:flex tw:flex-wrap tw:justify-end tw:gap-2">
          <Button onClick={() => setExportOpen(false)}>Cancel</Button>
          <Button
            variant="primary"
            className="tw:min-h-[44px]"
            disabled={exporting}
            onClick={exportGrid}
          >
            <Download aria-hidden="true" />
            {exporting ? "Exporting..." : "Download image"}
          </Button>
        </div>
      </Modal>
      <Modal
        open={imageTarget !== null}
        onClose={closeImagePicker}
        title="Choose image"
        returnFocus={imageReturnFocus}
        size="wide"
      >
        <TabGroup
          style={
            {
              "--picker-card-min-width": `${previewCardMinWidth}px`,
              "--picker-card-max-width": `${previewCardMaxWidth}px`,
            } as CSSProperties
          }
        >
          <div className="tw:mb-4 tw:flex tw:flex-wrap tw:items-center tw:justify-between tw:gap-2">
            <ImageTabs
              label="Image source"
              tabs={[
                { label: "Imported" },
                {
                  label: "Online",
                  disabled: true,
                  title: "Online providers are not available yet",
                },
              ]}
            />
          </div>
          <TabPanels>
            <TabPanel>
              <div className={pickerGridClassName}>
                <UploadTile
                  progress={importProgress}
                  gridStyle={board}
                  captionRows={captionRows}
                  onClick={() =>
                    document.getElementById("picker-cell-upload")?.click()
                  }
                  onDropFiles={(files) => {
                    void importFiles(files, imageTarget);
                    closeImagePicker();
                  }}
                />
                {activeAssets.map((asset) => (
                  <LibraryImage
                    key={asset.id}
                    className=""
                    asset={asset}
                    cell={board.cells.find((cell) => cell.assetId === asset.id)}
                    gridStyle={board}
                    captionRows={captionRows}
                    disabled={false}
                    onTitle={(title) =>
                      dispatchDocument({
                        type: "asset/title",
                        assetId: asset.id,
                        title,
                      })
                    }
                    onDelete={() => deleteImages([asset.id])}
                    onSelect={() => {
                      if (imageTarget) placeAsset(asset.id, imageTarget);
                      closeImagePicker();
                    }}
                  />
                ))}
              </div>
              <input
                id="picker-cell-upload"
                type="file"
                accept="image/*"
                multiple
                hidden
                onChange={(event) => {
                  if (!event.currentTarget.files?.length) return;
                  void upload(event, imageTarget);
                  closeImagePicker();
                }}
              />
              {activeAssets.length === 0 && <p>No images yet.</p>}
              {activeAssets.length > 0 && (
                <Button
                  className="tw:mt-2 tw:min-h-[44px] tw:w-full"
                  onClick={() =>
                    deleteImages(activeAssets.map((asset) => asset.id))
                  }
                >
                  <Trash2 aria-hidden="true" />
                  Clear all images
                </Button>
              )}
            </TabPanel>
          </TabPanels>
        </TabGroup>
      </Modal>
      <Modal
        open={reloadOpen}
        onClose={() => setReloadOpen(false)}
        title="Reload saved grid"
        returnFocus={reloadButton}
      >
        <p>
          Reloading replaces this tab's grid and unsaved images with the saved
          version.
        </p>
        <div className="tw:mt-5 tw:flex tw:flex-wrap tw:justify-end tw:gap-2">
          <Button onClick={() => setReloadOpen(false)}>Cancel</Button>
          <Button
            variant="primary"
            onClick={() => {
              deliberateReload.current = true;
              window.location.reload();
            }}
          >
            <RefreshCw aria-hidden="true" />
            Reload saved grid
          </Button>
        </div>
      </Modal>
      <Modal
        open={resetOpen}
        onClose={() => setResetOpen(false)}
        title="Reset grid settings"
        returnFocus={resetButton}
      >
        <p>
          Restore the default 3x3 layout, styling and export settings, and clear
          the banner heading?
        </p>
        <p>
          Library images, cell captions and placements are kept. Cells outside
          3x3 remain recoverable.
        </p>
        <div className="tw:mt-5 tw:flex tw:justify-end tw:gap-2">
          <Button onClick={() => setResetOpen(false)}>Cancel</Button>
          <Button variant="primary" onClick={resetDefaults}>
            <PanelsTopLeft aria-hidden="true" />
            Reset settings
          </Button>
        </div>
      </Modal>
    </>
  );
}
