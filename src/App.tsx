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
  HardDrive,
  Type,
  ImagePlus,
  Trash2,
  RefreshCw,
  Images,
} from "lucide-react";
import { Tab, TabGroup, TabList, TabPanel, TabPanels } from "@headlessui/react";
import {
  Button,
  ColorField,
  SelectField,
  Toggle,
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
import { createExport, dimensions, fitTitle, loadImage } from "./export";
import {
  LocalWorkspaceStore,
  LocalWorkspaceConflictError,
  getBrowserStorageStatus,
  requestPersistentStorage,
  type BrowserStorageStatus,
} from "./storage";

function formatBytes(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined) return "Unavailable";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
}

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
  useEffect(() => {
    if (editing) input.current?.focus();
  }, [editing]);
  useLayoutEffect(() => {
    const heading = headingRef.current;
    if (!heading || !heading.parentElement) return;
    let cancelled = false;
    const fit = () => {
      if (cancelled || heading.hidden) return;
      const context = document.createElement("canvas").getContext("2d");
      if (!context || !heading.firstElementChild) return;
      context.letterSpacing = "0.5px";
      heading.style.fontSize = `${fitTitle(context, board.heading, board.headingFont, (heading.clientHeight * 0.18) / 0.28, heading.firstElementChild.clientWidth * 0.92, heading.clientHeight * 0.82).fontSize}px`;
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
    board.headingVisible,
    board.columns,
    editing,
  ]);
  return (
    <h2
      ref={headingRef}
      className="board-export-heading"
      hidden={
        board.headingVisible === false || (!board.heading.trim() && !editing)
      }
    >
      {editing ? (
        <input
          ref={input}
          aria-label="Grid heading"
          maxLength={120}
          value={board.heading}
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
          className="board-heading-text tw:border-0 tw:bg-transparent tw:p-0 tw:text-inherit tw:[font:inherit] tw:cursor-text"
          aria-label="Edit grid heading"
          onClick={() => onEdit(true)}
        >
          {board.heading}
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
  const storageButton = useRef<HTMLButtonElement>(null);
  const [storageOpen, setStorageOpen] = useState(false);
  const activeAssets = workspace.assets.filter(
    (asset) => asset.trashedAt === undefined,
  );
  const [storageInfo, setStorageInfo] = useState<
    | (BrowserStorageStatus & {
        images: { count: number; bytes: number } | null;
      })
    | null
  >(null);
  const [requestingPersistence, setRequestingPersistence] = useState(false);
  const [headingEditing, setHeadingEditing] = useState(false);
  const [settingsTab, setSettingsTab] = useState(0);
  const [imageTarget, setImageTarget] = useState<string | null>(null);
  const imageReturnFocus = useRef<HTMLButtonElement>(null);
  const uploadTarget = useRef<string | null>(null);
  const addImagesButton = useRef<HTMLButtonElement>(null);
  const [filter, setFilter] = useState("All");
  const [libraryDragOver, setLibraryDragOver] = useState(false);
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
  const imageCategories = [
    ...new Set(activeAssets.map((asset) => asset.category)),
  ];
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
  const size = dimensions(board, resolution);
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
  useEffect(() => {
    if (!storageOpen) return;
    let cancelled = false;
    Promise.all([
      getBrowserStorageStatus(),
      localStore.current?.usage().catch(() => null) ?? Promise.resolve(null),
    ]).then(([browser, images]) => {
      if (!cancelled) setStorageInfo({ ...browser, images });
    });
    return () => {
      cancelled = true;
    };
  }, [storageOpen, saveStatus]);
  const requestPersistence = async () => {
    if (requestingPersistence) return;
    setRequestingPersistence(true);
    const persisted = await requestPersistentStorage();
    setStorageInfo((current) =>
      current ? { ...current, persisted } : current,
    );
    setToast(
      persisted === true
        ? "Persistent storage granted."
        : persisted === false
          ? "Persistent storage not granted."
          : "Persistent storage unavailable.",
    );
    setRequestingPersistence(false);
  };
  const deleteImages = (assetIds: string[]) => {
    localStore.current?.scheduleImageDeletion(assetIds);
    dispatchDocument({ type: "assets/delete", assetIds });
    setFilter("All");
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
    const targetId = board.id;
    const assets: Asset[] = [];
    for (const file of Array.from(files ?? [])) {
      if (!file.type.startsWith("image/")) {
        setToast(`${file.name} is not an image.`);
        continue;
      }
      let asset: Asset | null = null;
      try {
        if (localStore.current !== store) return;
        asset = store.createAsset(
          file,
          file.name.replace(/\.[^.]+$/, "").replace(/[-_]/g, " "),
        );
        await loadImage(asset.src);
        if (localStore.current !== store) return;
        assets.push(asset);
      } catch {
        if (asset) store.releaseAsset(asset.id);
        setToast(
          `Could not load ${file.name}. Try a PNG, JPEG, or WebP image.`,
        );
      }
    }
    dispatchDocument({
      type: "assets/import",
      gridId: targetId,
      cellId: targetCellId ?? null,
      assets,
    });
    setFilter("All");
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
    setFilter("All");
    setSettingsTab(0);
    setResetOpen(false);
    setToast("Defaults restored. Images kept.");
  };
  const loadExample = async () => {
    if (loadingExample) return;
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
      setFilter("All");
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
            className="button secondary"
            disabled={exporting}
            onClick={exportGrid}
          >
            <Download />
            <span>Export grid</span>
          </button>
        </div>
      </header>
      <main className="app-layout tw:max-[900px]:block! tw:max-[900px]:pb-[280px]">
        <EditorLayout>
          <aside
            className={`asset-panel ${libraryDragOver ? "tw:outline-2 tw:outline-offset-[-2px] tw:outline-(--mint)" : ""}`}
            aria-label="Image library drop zone"
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
            </div>
            {imageCategories.length > 1 && (
              <div
                className="filter-tabs"
                role="group"
                aria-label="Image category"
              >
                {["All", ...imageCategories].map((category) => (
                  <button
                    key={category}
                    className={filter === category ? "active" : ""}
                    data-filter={category}
                    onClick={() => setFilter(category)}
                  >
                    {category}
                  </button>
                ))}
              </div>
            )}
            <div id="asset-library" className="asset-library">
              <button
                ref={addImagesButton}
                type="button"
                aria-label="Add images"
                title="Add or drop images"
                className={`tw:flex tw:shrink-0 tw:flex-col tw:items-center tw:justify-center tw:gap-1 tw:rounded-sm tw:border tw:border-dashed tw:border-(--line) tw:bg-transparent tw:text-(--muted) tw:enabled:hover:border-(--accent) ${activeAssets.length ? "tw:aspect-square tw:self-start tw:w-full tw:max-[900px]:w-[82px]" : "tw:col-span-full tw:min-h-[140px] tw:w-full!"}`}
                onClick={() => document.getElementById("upload")?.click()}
              >
                <ImagePlus aria-hidden="true" />
                <span className="tw:text-[11px]">Add images</span>
                <span className="tw:text-[9px]">Drop here</span>
              </button>
              {activeAssets
                .filter(
                  (asset) =>
                    imageCategories.length < 2 ||
                    filter === "All" ||
                    asset.category === filter,
                )
                .map((asset) => (
                  <LibraryImage
                    key={asset.id}
                    asset={asset}
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
            {workspace.assets.length > 0 && (
              <Button
                className="tw:mt-2 tw:min-h-[44px] tw:w-full"
                disabled={loadingExample}
                onClick={() =>
                  deleteImages(workspace.assets.map((asset) => asset.id))
                }
              >
                <Trash2 aria-hidden="true" />
                Clear all images
              </Button>
            )}
          </aside>
          <section className="workspace" aria-label="Grid editor">
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
              {(!board.heading.trim() || !board.headingVisible) &&
                !headingEditing && (
                  <Button
                    className="tw:mb-3 tw:border-0 tw:bg-transparent tw:text-(--muted)"
                    onClick={() => {
                      patchBoard({ headingVisible: true });
                      setHeadingEditing(true);
                    }}
                  >
                    <Type aria-hidden="true" />
                    Add heading
                  </Button>
                )}
              <GridResizer
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
                      "--columns": board.columns,
                      "--gap": `${board.gap}px`,
                      "--board-bg": board.background,
                      "--publisher-color": palette.color,
                      "--publisher-text": palette.text,
                      "--caption-color": palette.caption,
                      "--heading-font": `"${board.headingFont}"`,
                      "--cell-font": `"${board.cellFont}"`,
                    } as CSSProperties
                  }
                >
                  <BoardHeading
                    board={board}
                    editing={headingEditing}
                    onEdit={setHeadingEditing}
                    onChange={(heading) => patchBoard({ heading })}
                  />
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
                          onPatch={(patch) =>
                            dispatchDocument({
                              type: "cell/patch",
                              gridId: board.id,
                              cellId: item.id,
                              patch,
                            })
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
            className="settings-panel tw:block!"
            aria-label="Grid settings"
          >
            <div className="tw:flex tw:flex-wrap tw:gap-2 tw:border-0 tw:border-b tw:border-solid tw:border-(--line) tw:py-3">
              <Button
                ref={resetButton}
                title="Restore default grid settings; keep library images and cell captions"
                onClick={() => setResetOpen(true)}
              >
                <PanelsTopLeft aria-hidden="true" />
                Reset grid settings
              </Button>
              <Button
                aria-label="Local storage"
                onClick={(event) => {
                  storageButton.current = event.currentTarget;
                  setStorageInfo(null);
                  setStorageOpen(true);
                }}
              >
                <HardDrive aria-hidden="true" />
                Local storage
              </Button>
            </div>
            <TabGroup selectedIndex={settingsTab} onChange={setSettingsTab}>
              <TabList className="tw:flex tw:gap-1 tw:border-0 tw:border-b tw:border-solid tw:border-(--line) tw:py-3">
                {["Templates", "Export"].map((label) => (
                  <Tab
                    key={label}
                    className="tw:min-h-[44px] tw:border-0 tw:bg-transparent tw:px-2 tw:text-xs tw:text-(--muted) tw:data-selected:bg-(--bg) tw:data-selected:text-(--text) tw:enabled:hover:bg-(--line) tw:enabled:hover:text-(--text) tw:transition-colors"
                  >
                    {label}
                  </Tab>
                ))}
              </TabList>
              <TabPanels>
                <TabPanel className="tw:py-5">
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
                            aria-pressed={board.publisher === publisher}
                            onClick={() => patchBoard({ publisher })}
                          >
                            {publisher === "dc" ? "DC" : "Marvel"}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                  <Toggle
                    label="Show heading"
                    checked={board.headingVisible !== false}
                    onChange={(headingVisible) =>
                      patchBoard({ headingVisible })
                    }
                  />
                  <SelectField
                    id="heading-font"
                    label="Heading font"
                    value={board.headingFont}
                    options={fontOptions.map((font) => ({
                      value: font,
                      label: font,
                    }))}
                    onChange={(headingFont) => patchBoard({ headingFont })}
                  />
                  <SelectField
                    id="cell-font"
                    label="Cell font"
                    value={board.cellFont}
                    options={fontOptions.map((font) => ({
                      value: font,
                      label: font,
                    }))}
                    onChange={(cellFont) => patchBoard({ cellFont })}
                  />
                  <label className="field-label" htmlFor="gap">
                    Grid spacing <output id="gap-value">{board.gap} px</output>
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
                </TabPanel>
                <TabPanel className="settings-section export-section">
                  <SelectField
                    id="format"
                    label="File format"
                    value={format}
                    options={[
                      { value: "image/png", label: "PNG" },
                      { value: "image/jpeg", label: "JPEG" },
                      { value: "image/webp", label: "WebP" },
                    ]}
                    onChange={(format) =>
                      patchExport({ format: format as ImageFormat })
                    }
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
                  <label
                    className="field-label quality-label"
                    htmlFor="quality"
                  >
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
                  <p className="tw:text-xs tw:text-(--muted)">
                    {size.width} × {size.height} px
                  </p>
                </TabPanel>
              </TabPanels>
            </TabGroup>
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
        open={storageOpen}
        onClose={() => setStorageOpen(false)}
        title="Local storage"
        returnFocus={storageButton}
      >
        <>
          <div aria-busy={storageInfo === null}>
            {storageInfo === null ? (
              <p role="status">Checking storage...</p>
            ) : (
              <>
                <dl className="tw:m-0 tw:grid tw:grid-cols-[minmax(0,1fr)_auto] tw:gap-x-4 tw:gap-y-3 tw:text-sm">
                  <dt>Stored images</dt>
                  <dd className="tw:m-0 tw:text-right">
                    {storageInfo.images?.count ?? "Unavailable"}
                  </dd>
                  <dt>Image data</dt>
                  <dd className="tw:m-0 tw:text-right">
                    {formatBytes(storageInfo.images?.bytes)}
                  </dd>
                  <dt>Browser usage</dt>
                  <dd className="tw:m-0 tw:text-right">
                    {formatBytes(storageInfo.usage)}
                  </dd>
                  <dt>Browser quota</dt>
                  <dd className="tw:m-0 tw:text-right">
                    {formatBytes(storageInfo.quota)}
                  </dd>
                  <dt>Persistence</dt>
                  <dd className="tw:m-0 tw:text-right">
                    {storageInfo.persisted === true
                      ? "Persistent"
                      : storageInfo.persisted === false
                        ? "Best-effort"
                        : "Unavailable"}
                  </dd>
                </dl>
                {storageInfo.quota !== null &&
                  storageInfo.quota > 0 &&
                  storageInfo.usage !== null && (
                    <progress
                      aria-label="Browser storage usage"
                      value={Math.min(storageInfo.usage, storageInfo.quota)}
                      max={storageInfo.quota}
                      className="tw:mt-4 tw:h-2 tw:w-full tw:accent-(--accent)"
                    />
                  )}
              </>
            )}
          </div>
          <div className="tw:mt-5 tw:flex tw:flex-wrap tw:justify-end tw:gap-2">
            <Button
              onClick={() => {
                setStorageOpen(false);
              }}
            >
              Close
            </Button>
            <Button
              variant="primary"
              onClick={requestPersistence}
              disabled={
                requestingPersistence ||
                !storageInfo?.canRequestPersistence ||
                storageInfo.persisted === true
              }
            >
              <HardDrive aria-hidden="true" />
              {requestingPersistence
                ? "Requesting..."
                : "Request persistent storage"}
            </Button>
          </div>
        </>
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
