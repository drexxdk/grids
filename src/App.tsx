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
import {
  PanelsTopLeft,
  Download,
  ImagePlus,
  Trash2,
  RefreshCw,
  Images,
  LoaderCircle,
  RectangleVertical,
  RectangleHorizontal,
  Square,
  PanelTop,
  PanelBottom,
  Layers,
  AlignStartVertical,
  AlignCenterVertical,
  AlignEndVertical,
  SlidersHorizontal,
} from "lucide-react";
import {
  Popover,
  PopoverButton,
  PopoverPanel,
  Tab,
  TabGroup,
  TabList,
} from "@headlessui/react";
import {
  Button,
  ButtonGroup,
  ColorField,
  SelectField,
} from "./components/ui/controls";
import { Modal } from "./components/ui/Modal";
import { GridResizer, RemovedCells } from "./components/GridResizer";
import { GridCell } from "./components/GridCell";
import { EditorLayout } from "./components/EditorLayout";
import { LibraryImage } from "./components/LibraryImage";
import {
  fontOptions,
  gridLimit,
  makeWorkspace,
  createResetCommand,
  createResizeCommand,
  documentReducer,
  publishers,
  getEditorSettings,
  cellGeometry,
  type Asset,
  type Board,
  type GridPatch,
  type ImageFormat,
  type OverflowCell,
  type ExportSettings,
  type Publisher,
  type GridStyle,
  type TemplateName,
} from "./model";
import {
  createExport,
  dimensions,
  fitTitle,
  loadImage,
  sharedCaptionRows,
} from "./export";
import { LocalWorkspaceStore, LocalWorkspaceConflictError } from "./storage";

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
      heading.style.fontSize = `${fitTitle(context, board.heading || "Add heading", board.headingFont, (heading.clientHeight * fontRatio) / heightRatio, heading.firstElementChild.clientWidth * 0.92, heading.clientHeight * 0.82).fontSize}px`;
    };
    const observer = new ResizeObserver(fit);
    observer.observe(heading.parentElement);
    fit();
    document.fonts.load(`48px "${board.headingFont}"`).then(fit);
    document.fonts.ready.then(fit);
    return () => {
      cancelled = true;
      observer.disconnect();
    };
  }, [
    board.heading,
    board.headingFont,
    board.headingFontSize,
    board.columns,
    editing,
  ]);
  return (
    <h2
      ref={headingRef}
      className="board-export-heading tw:group"
      style={{
        height: `calc(var(--preview-cell-width, calc(100cqw / var(--columns))) * ${Math.max(0.28, (board.headingFontSize ?? 18) * 0.014)})`,
        ...(!board.heading.trim()
          ? {
              background: publishers[board.publisher].caption,
              borderRadius: "6px",
            }
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

const templates = [
  {
    name: "Clean",
    style: {
      headingVisible: true,
      headingFont: "Manrope",
      cellFont: "Manrope",
      background: "#17191b",
      gap: 12,
      publisher: "none" as const,
    },
  },
  {
    name: "Editorial",
    style: {
      headingVisible: true,
      headingFont: "Bebas Neue",
      cellFont: "Manrope",
      background: "#292e2c",
      gap: 8,
      publisher: "none" as const,
    },
  },
  {
    name: "Superhero",
    style: {
      headingVisible: true,
      headingFont: "Bangers",
      cellFont: "Boogaloo",
      background: "#17191b",
      gap: 12,
      publisher: "dc" as const,
    },
  },
] satisfies { name: TemplateName; style: GridStyle }[];

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
  const imageReturnFocus = useRef<HTMLButtonElement>(null);
  const uploadTarget = useRef<string | null>(null);
  const addImagesButton = useRef<HTMLButtonElement>(null);
  const [libraryDragOver, setLibraryDragOver] = useState(false);
  const [importProgress, setImportProgress] = useState<{
    completed: number;
    total: number;
    pending: number;
  } | null>(null);
  const localExamples = ["localhost", "127.0.0.1", "[::1]"].includes(
    window.location.hostname,
  );
  const [toast, setToast] = useState("");
  const [saveStatus, setSaveStatus] = useState("Saved locally");
  const { format, resolution, quality } = workspace.exportSettings;
  const patchExport = (patch: Partial<ExportSettings>) =>
    dispatchDocument({ type: "export/patch", patch });
  const [exporting, setExporting] = useState(false);
  const [loadingExample, setLoadingExample] = useState(false);
  const [exampleOpen, setExampleOpen] = useState(false);
  const [examplePublisher, setExamplePublisher] = useState<Publisher>("dc");
  const exampleButton = useRef<HTMLButtonElement>(null);
  const replaceUpload = useRef<HTMLInputElement>(null);
  const resetButton = useRef<HTMLButtonElement>(null);
  const [resetOpen, setResetOpen] = useState(false);
  const [resizeHistory, setResizeHistory] = useState<
    { boardId: string; rows: number; columns: number }[]
  >([]);
  const board = workspace.grid;
  const [captionRows, setCaptionRows] = useState(1);
  const [previewFrame, setPreviewFrame] = useState<HTMLDivElement | null>(null);
  const [previewSize, setPreviewSize] = useState<{
    width: number;
    height: number;
    boardWidth: number;
    cellWidth: number;
    gap: number;
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
        52;
      const top = frame.getBoundingClientRect().top + window.scrollY;
      const availableHeight = Math.max(
        100,
        window.innerHeight - top - 52 - (window.innerWidth <= 900 ? 160 : 28),
      );
      const gapRatio = board.gap / 600;
      const widthRatio = board.columns + (board.columns + 1) * gapRatio;
      const headingRatio = Math.max(
        0.28,
        (board.headingFontSize ?? 18) * 0.014,
      );
      const boardHeightRatio =
        (board.rows * cellGeometry(board, 600, captionRows).height) / 600 +
        (board.rows + 1) * gapRatio;
      const heightRatio = boardHeightRatio + headingRatio + gapRatio;
      const viewport = frame.querySelector<HTMLElement>(
        "[data-canvas-viewport]",
      );
      const scrollbarWidth = viewport
        ? viewport.offsetWidth - viewport.clientWidth
        : 0;
      const cellWidth = Math.max(
        128,
        Math.min(
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
        boardWidth > viewportWidth - scrollbarWidth ? scrollbarWidth : 0;
      const next = {
        width: viewportWidth + 52,
        height: Math.max(
          1,
          Math.min(
            availableHeight - cellWidth * (headingRatio + gapRatio),
            cellWidth * boardHeightRatio + horizontalScrollbar,
          ),
        ),
        boardWidth,
        cellWidth,
        gap: cellWidth * gapRatio,
      };
      setPreviewSize((previous) =>
        previous &&
        Math.abs(previous.width - next.width) < 0.01 &&
        Math.abs(previous.height - next.height) < 0.01 &&
        Math.abs(previous.boardWidth - next.boardWidth) < 0.01 &&
        Math.abs(previous.cellWidth - next.cellWidth) < 0.01 &&
        Math.abs(previous.gap - next.gap) < 0.01
          ? previous
          : next,
      );
    };
    const observer = new ResizeObserver(fit);
    observer.observe(container);
    window.addEventListener("resize", fit);
    fit();
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", fit);
    };
  }, [
    previewFrame,
    board.rows,
    board.columns,
    board.gap,
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
    void document.fonts.load(`48px "${board.cellFont}"`).then(update);
    return () => {
      active = false;
    };
  }, [board.cells, board.cellFont, board.cellFontSize, workspace.assets]);
  const matchedTemplate = templates.find((template) =>
    Object.entries(template.style).every(([key, value]) =>
      key === "publisher" && template.name === "Superhero"
        ? board.publisher !== "none"
        : board[key as keyof Board] === value,
    ),
  );
  const selectedTemplate = board.template ?? matchedTemplate?.name ?? "Custom";
  const resizeUndo = resizeHistory
    .slice()
    .reverse()
    .find((entry) => entry.boardId === board.id);
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
        setToast(
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
          setToast(
            "Local save failed. Your current grid can still be exported.",
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
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(""), 4500);
    return () => clearTimeout(timer);
  }, [toast]);
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
    setResizeHistory((current) => [
      ...current,
      {
        boardId: board.id,
        rows: board.rows,
        columns: board.columns,
      },
    ]);
    dispatchDocument(createResizeCommand(board.id, rows, columns));
  };
  const undoResize = () => {
    if (!resizeUndo) return;
    dispatchDocument(
      createResizeCommand(board.id, resizeUndo.rows, resizeUndo.columns),
    );
    setResizeHistory((current) =>
      current.filter((entry) => entry !== resizeUndo),
    );
  };
  const recoverCell = (entry: OverflowCell) => {
    setResizeHistory((current) => [
      ...current,
      { boardId: board.id, rows: board.rows, columns: board.columns },
    ]);
    dispatchDocument(
      createResizeCommand(
        board.id,
        Math.max(board.rows, entry.row + 1),
        Math.max(board.columns, entry.column + 1),
      ),
    );
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
          setToast(`${file.name} is not an image.`);
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
          setToast(
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
  const drop = (event: DragEvent<HTMLDivElement>, index: number) => {
    event.preventDefault();
    event.currentTarget.classList.remove("drag-over");
    const assetId = event.dataTransfer.getData("application/x-gridroom-asset");
    const sourceIndex = event.dataTransfer.getData(
      "application/x-gridroom-cell",
    );
    if (assetId) placeAsset(assetId, board.cells[index].id);
    else if (sourceIndex !== "") {
      let dragged: { boardId?: string; cellId?: string } | null;
      try {
        dragged = JSON.parse(sourceIndex);
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
      setToast("Grid exported.");
    } catch (error) {
      setToast(
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
    setResizeHistory([]);
    setImageTarget(null);
    setResetOpen(false);
    setToast("Defaults restored. Images kept.");
  };
  const loadExample = async () => {
    if (!localExamples || loadingExample) return;
    setLoadingExample(true);
    try {
      const { loadComicExample } = await import("./demo/comics");
      const example = loadComicExample(workspace, examplePublisher);
      dispatchDocument({
        type: "grid/replace",
        grid: example.grid,
        assets: example.assets,
      });
      setResizeHistory([]);
      setImageTarget(null);
      setToast("Example loaded.");
      setExampleOpen(false);
    } catch (error) {
      setToast(
        error instanceof Error ? error.message : "Example could not be loaded.",
      );
    } finally {
      setLoadingExample(false);
    }
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
      <header className="app-header">
        <a className="brand" href="./">
          <span className="brand-mark">
            <PanelsTopLeft />
          </span>
          Grids
        </a>
        <div className="header-actions">
          <span
            id="save-status"
            className="save-status"
            hidden={
              saveStatus === "Saved locally" || saveStatus === "Saving locally"
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
            className="button secondary"
            disabled={exporting}
            onClick={() => setExportOpen(true)}
          >
            <Download />
            <span>Export grid</span>
          </button>
        </div>
      </header>
      <main className="app-layout tw:min-[901px]:grid-cols-[250px_minmax(0,1fr)_250px]! tw:max-[900px]:block! tw:max-[900px]:pb-[160px]">
        <EditorLayout>
          {(drawerToggle, toolsExpanded) => (
            <aside
              className={`asset-panel tw:min-[901px]:px-[16px]! tw:min-[901px]:sticky tw:min-[901px]:top-0 tw:min-[901px]:h-[calc(100dvh-80px)] tw:min-[901px]:self-start tw:min-[901px]:overflow-y-auto tw:min-[901px]:overflow-x-hidden tw:min-[901px]:[scrollbar-gutter:stable] tw:min-[901px]:[&>*]:shrink-0 tw:min-[901px]:[&_.asset-library]:grid-cols-2! ${libraryDragOver ? "tw:outline-2 tw:outline-offset-[-2px] tw:outline-(--mint)" : ""}`}
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
              <div className="section-heading">
                <h2>Image library</h2>
                {localExamples && (
                  <Button
                    ref={exampleButton}
                    variant="icon"
                    aria-label="Load example"
                    title="Load example: Legacy comics"
                    disabled={loadingExample}
                    onClick={() => setExampleOpen(true)}
                  >
                    <Images aria-hidden="true" />
                  </Button>
                )}
              </div>
              <div className="tw:mb-1 tw:flex tw:items-center tw:justify-between tw:gap-2">
                <TabGroup>
                  <TabList
                    className="tw:flex tw:overflow-hidden tw:rounded-[4px] tw:border tw:border-solid tw:border-(--line)"
                    aria-label="Image source"
                  >
                    <Tab className="tw:min-h-[44px] tw:border-0 tw:border-r tw:border-solid tw:border-(--line) tw:bg-transparent tw:px-3 tw:text-(--muted) tw:data-selected:bg-(--line) tw:data-selected:text-(--accent) tw:focus-visible:outline-2 tw:focus-visible:outline-(--accent) tw:focus-visible:-outline-offset-2!">
                      Imported
                    </Tab>
                    <Tab
                      className="tw:min-h-[44px] tw:border-0 tw:bg-transparent tw:px-3 tw:text-(--muted) tw:disabled:cursor-default tw:disabled:opacity-50"
                      disabled
                      title="Online providers are not available yet"
                    >
                      Online
                    </Tab>
                  </TabList>
                </TabGroup>
                {drawerToggle}
              </div>
              <div id="asset-library" className="asset-library">
                <button
                  ref={addImagesButton}
                  data-upload-tile
                  type="button"
                  aria-label="Add images"
                  disabled={importProgress !== null}
                  title="Add or drop images"
                  className={`image-frame tw:flex tw:shrink-0 tw:flex-col tw:items-center tw:justify-center tw:gap-1 tw:rounded-[4px] tw:border-0 tw:bg-transparent tw:text-(--muted) tw:outline-none! tw:focus-visible:[--frame-color:var(--accent)] tw:disabled:cursor-default! tw:disabled:opacity-100! tw:disabled:text-(--text)! tw:enabled:hover:[--frame-color:var(--accent)] ${activeAssets.length ? "tw:aspect-square tw:self-start tw:w-full tw:max-[900px]:w-[82px]" : "tw:col-span-full tw:min-h-[140px] tw:w-full!"}`}
                  onClick={() => document.getElementById("upload")?.click()}
                >
                  {importProgress ? (
                    <>
                      <LoaderCircle
                        aria-hidden="true"
                        className="tw:animate-spin tw:motion-reduce:animate-none"
                      />
                      <span
                        role="status"
                        aria-live="polite"
                        className="tw:flex tw:flex-col tw:items-center tw:gap-1"
                      >
                        <span className="tw:text-[11px]">Importing...</span>
                        <span className="tw:text-[9px]">
                          {importProgress.completed} / {importProgress.total}
                        </span>
                      </span>
                    </>
                  ) : (
                    <>
                      <ImagePlus aria-hidden="true" />
                      <span data-upload-label className="tw:text-[11px]">
                        Add images
                      </span>
                      <span data-upload-label className="tw:text-[9px]">
                        Drop here
                      </span>
                    </>
                  )}
                </button>
                {activeAssets.map((asset) => (
                  <LibraryImage
                    key={asset.id}
                    asset={asset}
                    cell={board.cells.find((cell) => cell.assetId === asset.id)}
                    gridStyle={board}
                    captionRows={captionRows}
                    onTitle={(title) =>
                      dispatchDocument({
                        type: "asset/title",
                        assetId: asset.id,
                        title,
                      })
                    }
                    disabled={loadingExample}
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
                  disabled={loadingExample}
                  onClick={() =>
                    deleteImages(activeAssets.map((asset) => asset.id))
                  }
                >
                  <Trash2 aria-hidden="true" />
                  Clear all images
                </Button>
              )}
            </aside>
          )}
          <section
            className="workspace tw:min-[901px]:h-[calc(100dvh-80px)] tw:min-[901px]:overflow-y-auto tw:min-[901px]:[scrollbar-gutter:stable]"
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
                <Button ref={reloadButton} onClick={() => setReloadOpen(true)}>
                  <RefreshCw aria-hidden="true" />
                  Reload saved grid
                </Button>
              </div>
            )}
            <div className="canvas-area">
              <div
                role="toolbar"
                aria-label="Grid appearance"
                className="tw:mb-3 tw:flex tw:flex-wrap tw:items-center tw:gap-3"
              >
                <ButtonGroup label="Image aspect ratio">
                  {(
                    [
                      ["portrait", RectangleVertical],
                      ["landscape", RectangleHorizontal],
                      ["square", Square],
                    ] as const
                  ).map(([imageAspect, Icon]) => (
                    <Button
                      key={imageAspect}
                      variant="icon"
                      title={`${imageAspect[0].toUpperCase()}${imageAspect.slice(1)} images`}
                      aria-label={`${imageAspect[0].toUpperCase()}${imageAspect.slice(1)} images`}
                      aria-pressed={
                        (board.imageAspect ?? "square") === imageAspect
                      }
                      className="tw:aria-pressed:bg-(--line) tw:aria-pressed:text-(--accent)"
                      onClick={() => patchBoard({ imageAspect })}
                    >
                      <Icon aria-hidden="true" />
                    </Button>
                  ))}
                </ButtonGroup>
                <ButtonGroup label="Caption placement">
                  {(
                    [
                      ["above", PanelTop, "Text above image"],
                      ["below", PanelBottom, "Text below image"],
                      ["overlay", Layers, "Text on image"],
                    ] as const
                  ).map(([captionPlacement, Icon, label]) => (
                    <Button
                      key={captionPlacement}
                      variant="icon"
                      title={label}
                      aria-label={label}
                      aria-pressed={
                        (board.captionPlacement ?? "below") === captionPlacement
                      }
                      className="tw:aria-pressed:bg-(--line) tw:aria-pressed:text-(--accent)"
                      onClick={() => patchBoard({ captionPlacement })}
                    >
                      <Icon aria-hidden="true" />
                    </Button>
                  ))}
                </ButtonGroup>
                {board.captionPlacement === "overlay" && (
                  <>
                    <ButtonGroup label="Caption alignment">
                      {(
                        [
                          ["top", AlignStartVertical],
                          ["middle", AlignCenterVertical],
                          ["bottom", AlignEndVertical],
                        ] as const
                      ).map(([captionAlignment, Icon]) => (
                        <Button
                          key={captionAlignment}
                          variant="icon"
                          title={`Text at ${captionAlignment}`}
                          aria-label={`Text at ${captionAlignment}`}
                          aria-pressed={
                            (board.captionAlignment ?? "bottom") ===
                            captionAlignment
                          }
                          className="tw:aria-pressed:bg-(--line) tw:aria-pressed:text-(--accent)"
                          onClick={() => patchBoard({ captionAlignment })}
                        >
                          <Icon aria-hidden="true" />
                        </Button>
                      ))}
                    </ButtonGroup>
                    <Popover>
                      <PopoverButton
                        as={Button}
                        variant="icon"
                        aria-label="Text overlay settings"
                        title="Text overlay settings"
                      >
                        <SlidersHorizontal aria-hidden="true" />
                      </PopoverButton>
                      <PopoverPanel
                        anchor="bottom"
                        className="tw:z-70 tw:w-64 tw:max-w-[calc(100vw-24px)] tw:rounded-md tw:border tw:border-solid tw:border-(--line) tw:bg-(--panel) tw:p-3 tw:[--anchor-gap:4px] tw:[--anchor-padding:12px]"
                      >
                        <ColorField
                          id="caption-overlay"
                          label="Overlay color"
                          value={board.captionOverlayColor ?? "#000000"}
                          onChange={(captionOverlayColor) =>
                            patchBoard({ captionOverlayColor })
                          }
                        />
                        <label
                          className="field-label"
                          htmlFor="caption-opacity"
                        >
                          Opacity{" "}
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
                      </PopoverPanel>
                    </Popover>
                  </>
                )}
              </div>
              <GridResizer
                ref={setPreviewFrame}
                viewportHeight={previewSize?.height}
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
                    maxWidth: "100%",
                    marginInline: "auto",
                    "--columns": board.columns,
                    "--gap": `${previewSize?.gap ?? board.gap}px`,
                    "--preview-cell-width": previewSize
                      ? `${previewSize.cellWidth}px`
                      : undefined,
                    "--heading-font": `"${board.headingFont}"`,
                    "--publisher-color": palette.color,
                    "--publisher-text": board.headingTextColor ?? palette.text,
                  } as CSSProperties
                }
                rows={board.rows}
                columns={board.columns}
                onResize={resize}
                onUndo={resizeUndo ? undoResize : undefined}
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
              <RemovedCells
                entries={board.overflow}
                assets={workspace.assets}
                onRecover={recoverCell}
              />
            </div>
          </section>
          <aside
            className="settings-panel tw:block! tw:min-[901px]:px-[16px]! tw:min-[901px]:sticky tw:min-[901px]:top-0 tw:min-[901px]:h-[calc(100dvh-80px)] tw:min-[901px]:self-start tw:min-[901px]:overflow-y-auto tw:min-[901px]:overflow-x-hidden tw:min-[901px]:[scrollbar-gutter:stable]"
            aria-label="Grid settings"
          >
            <div className="tw:flex tw:flex-col tw:gap-3 tw:py-3">
              <fieldset
                className="tw:m-0 tw:min-w-0 tw:rounded-[6px] tw:border tw:border-solid tw:border-[#35424b] tw:bg-[#1d252b] tw:p-3"
                aria-label="Grid style"
              >
                <h2 className="tw:mt-0 tw:text-sm tw:font-semibold">
                  Grid style
                </h2>
                <SelectField
                  id="theme-selector"
                  label="Theme"
                  value={selectedTemplate}
                  options={[
                    ...templates.map((item) => item.name),
                    "Custom",
                  ].map((name) => ({ value: name, label: name }))}
                  onChange={(name) => {
                    const template = name as TemplateName;
                    dispatchDocument({
                      type: "grid/template",
                      gridId: board.id,
                      template,
                      previousTemplate: selectedTemplate,
                      defaults:
                        templates.find((item) => item.name === template)
                          ?.style ?? getEditorSettings(workspace).style,
                    });
                  }}
                />
                {selectedTemplate === "Superhero" && (
                  <div>
                    <span className="field-label">Sub-theme</span>
                    <div
                      className="segmented"
                      role="group"
                      aria-label="Superhero sub-theme"
                    >
                      {(["dc", "marvel"] as const).map((publisher) => (
                        <button
                          key={publisher}
                          className="tw:enabled:hover:bg-(--line)! tw:enabled:hover:text-(--accent)! tw:transition-colors tw:focus-visible:outline-2 tw:focus-visible:outline-offset-2 tw:focus-visible:outline-(--accent)"
                          aria-pressed={board.publisher === publisher}
                          onClick={() => patchBoard({ publisher })}
                        >
                          {publisher === "dc" ? "DC" : "Marvel"}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                <label className="field-label" htmlFor="gap">
                  Spacing <output id="gap-value">{board.gap} px</output>
                </label>
                <input
                  id="gap"
                  type="range"
                  min="0"
                  max="40"
                  value={board.gap}
                  onChange={(event) =>
                    patchBoard({ gap: Number(event.target.value) })
                  }
                />
                <ColorField
                  id="background"
                  label="Background"
                  value={board.background}
                  onChange={(background) => patchBoard({ background })}
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
                  label="Font"
                  value={board.headingFont}
                  options={fontOptions.map((font) => ({
                    value: font,
                    label: font,
                  }))}
                  onChange={(headingFont) => patchBoard({ headingFont })}
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
                    patchBoard({ headingFontSize: Number(event.target.value) })
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
                  label="Font"
                  value={board.cellFont}
                  options={fontOptions.map((font) => ({
                    value: font,
                    label: font,
                  }))}
                  onChange={(cellFont) => patchBoard({ cellFont })}
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
                  onChange={(cellTextColor) => patchBoard({ cellTextColor })}
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
          </aside>
        </EditorLayout>
      </main>
      <div id="toast" className="toast" role="status" hidden={!toast}>
        {toast}
      </div>
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
        onClose={() => setImageTarget(null)}
        title="Choose image"
        returnFocus={imageReturnFocus}
      >
        <div className="tw:grid tw:grid-cols-3 tw:gap-3">
          {activeAssets.map((asset) => (
            <button
              key={asset.id}
              className="tw:min-w-0 tw:border-0 tw:bg-transparent tw:p-0 tw:text-left"
              aria-label={`Use ${asset.title}`}
              onClick={() => {
                if (imageTarget) placeAsset(asset.id, imageTarget);
                setImageTarget(null);
              }}
            >
              <img
                src={asset.src}
                alt=""
                className="tw:aspect-square tw:w-full tw:object-contain"
              />
              <span className="tw:block tw:break-words tw:text-xs">
                {asset.title}
              </span>
            </button>
          ))}
        </div>
        {activeAssets.length === 0 && <p>No images yet.</p>}
        <div className="tw:mt-5 tw:flex tw:justify-end tw:gap-2">
          <Button onClick={() => setImageTarget(null)}>Cancel</Button>
          <Button
            variant="primary"
            onClick={() => {
              uploadTarget.current = imageTarget;
              setImageTarget(null);
              replaceUpload.current?.click();
            }}
          >
            <ImagePlus aria-hidden="true" />
            Upload image
          </Button>
        </div>
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
      <Modal
        open={exampleOpen}
        onClose={() => !loadingExample && setExampleOpen(false)}
        title="Load example"
        returnFocus={exampleButton}
      >
        <div className="segmented" role="group" aria-label="Example">
          {(["dc", "marvel"] as const).map((publisher) => (
            <button
              key={publisher}
              type="button"
              aria-pressed={examplePublisher === publisher}
              onClick={() => setExamplePublisher(publisher)}
              disabled={loadingExample}
            >
              {publisher === "dc" ? "DC" : "Marvel"}
            </button>
          ))}
        </div>
        <p>Replace the current grid? Images will stay in your library.</p>
        <div className="tw:mt-5 tw:flex tw:justify-end tw:gap-2">
          <Button
            onClick={() => setExampleOpen(false)}
            disabled={loadingExample}
          >
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={loadExample}
            disabled={loadingExample}
          >
            Use example
          </Button>
        </div>
      </Modal>
    </>
  );
}
