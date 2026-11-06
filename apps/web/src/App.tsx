import { t } from "./i18n";
import {
  captionMaxLength,
  imageUploadAccept,
} from "./config";
import {
  useEffect,
  useLayoutEffect,
  useMemo,
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
  RefreshCw,
  RotateCcw,
  RectangleVertical,
  RectangleHorizontal,
  Square,
  PanelTop,
  PanelBottom,
  PanelTopDashed,
  PanelBottomDashed,
  Check,
  X,
} from "lucide-react";
import {
  Button,
  ColorField,
  IconRadioField,
  PercentField,
  SelectField,
  Toggle,
} from "./components/ui/controls";
import { Modal } from "./components/ui/Modal";
import { GridResizer, GridResizeControls } from "./components/GridResizer";
import {
  GridCell,
  type CardDragSource,
  type CardDragVisual,
} from "./components/GridCell";
import { EditorLayout } from "./components/EditorLayout";
import { PresetsPanel } from "./components/PresetsPanel";
import {
  presetPreviewWorkspace,
  presetSettingsForLayout,
  samePresetSettings,
  starterPresets,
  type PresetChoice,
} from "./presets";
import { isLightCanvasColor } from "./canvasTheme";
import {
  LibraryImage,
  LibraryImagePlaceholder,
} from "./components/LibraryImage";
import { UploadTile } from "./components/UploadTile";
import { useEditorState } from "./browser/navigation";
import {
  fontOptions,
  fontWeightOptions,
  previewCardMinWidth,
  previewCardMaxWidth,
  resolveFontWeight,
  gridLimit,
  makeWorkspace,
  createResetGridCommand,
  createResizeCommand,
  documentReducer,
  publishers,
  getEditorSettings,
  editorSettingsSchema,
  applyEditorSettings,
  cellGeometry,
  headingGeometry,
  gridSpacing,
  removeCreditRequiredImages,
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

const pickerGridClassName =
  "grid grid-cols-[repeat(auto-fill,minmax(min(100%,var(--picker-card-min-width)),1fr))] gap-2.5 *:max-w-(--picker-card-max-width)";

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
    "board-heading-text border-0! rounded-none! bg-transparent p-(--heading-padding)! text-inherit [font:inherit] cursor-text! outline-none! hover:bg-white/8! focus:bg-white/12! placeholder:text-current placeholder:opacity-70";
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
      const fontRatio = (board.headingFontSize ?? 21) / 100;
      const geometry = headingGeometry(board, 1);
      const cellWidth = heading.clientHeight / geometry.height;
      heading.style.fontSize = `${fitTitle(context, board.heading || "Add heading", board.headingFont, cellWidth * fontRatio, (heading.firstElementChild.clientWidth - cellWidth * geometry.padding * 2) * 0.92, cellWidth * geometry.contentHeight * 0.82, resolveFontWeight(board.headingFont, board.headingFontWeight)).fontSize}px`;
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
    board.headingPadding,
    board.headingFontWeight,
    board.columns,
    editing,
  ]);
  return (
    <h2
      ref={headingRef}
      className="board-export-heading group relative overflow-hidden p-0! after:pointer-events-none after:absolute after:inset-0 after:rounded-[inherit] after:border after:border-solid after:border-transparent after:transition-colors hover:after:border-(--heading-feedback-color) focus-within:after:border-(--heading-feedback-color)"
      style={
        {
          borderRadius: `calc(var(--preview-cell-width, calc(100cqw / var(--columns))) * ${(board.cornerRadius ?? 12.5) / 100})`,
          fontWeight: resolveFontWeight(
            board.headingFont,
            board.headingFontWeight,
          ),
          textShadow: board.publisher === "none" ? "none" : undefined,
          "--heading-feedback-color": isLightCanvasColor(
            board.headingBackgroundColor ?? board.background,
          )
            ? "#202325"
            : "var(--accent)",
          height: `calc(var(--preview-cell-width, calc(100cqw / var(--columns))) * ${headingGeometry(board, 1).height})`,
          "--heading-padding": `calc(var(--preview-cell-width, calc(100cqw / var(--columns))) * ${headingGeometry(board, 1).padding})`,
          ...(!board.heading.trim()
            ? {
                background:
                  board.headingBackgroundColor ??
                  publishers[board.publisher].caption,
              }
            : board.headingBackgroundColor
              ? { background: board.headingBackgroundColor }
              : {}),
        } as React.CSSProperties
      }
    >
      {editing ? (
        <input
          ref={input}
          className={fieldClass}
          aria-label={t("editor.headingLabel")}
          maxLength={captionMaxLength}
          value={board.heading}
          placeholder={t("editor.headingPlaceholder")}
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
          aria-label={t("editor.editHeading", {
            value1: board.heading.trim()
              ? board.heading
              : t("editor.headingPlaceholder"),
          })}
          onClick={() => onEdit(true)}
        >
          {board.heading.trim() ? (
            board.heading
          ) : (
            <span
              data-heading-placeholder
              className="normal-case text-inherit opacity-70"
            >
              {t("editor.headingPlaceholder")}
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
  const [presetPreview, setPresetPreview] = useState<{
    choice: PresetChoice;
    key: string;
  } | null>(null);
  const [selectedPanel, setSelectedPanel] = useEditorState("selectedPanel");
  const [sidebarOpen, setSidebarOpen] = useEditorState("sidebarOpen");
  const [appliedPreset, setAppliedPreset] = useEditorState("appliedPreset");
  const [presetCustomizations, setPresetCustomizations] = useEditorState(
    "presetCustomizations",
  );
  const currentSettings = getEditorSettings(workspace);
  const currentSettingsSignature = JSON.stringify(currentSettings);
  useEffect(() => {
    const starter = starterPresets.find(
      (choice) => choice.id === appliedPreset?.id,
    );
    if (!loaded || conflict || !starter) return;
    const customized = !samePresetSettings(starter.settings, currentSettings);
    const saved = presetCustomizations[starter.id];
    if (customized && saved && samePresetSettings(saved, currentSettings))
      return;
    if (!customized && !saved) return;
    setPresetCustomizations((previous) => {
      const next = { ...previous };
      if (customized)
        next[starter.id] = editorSettingsSchema.parse(
          presetSettingsForLayout(currentSettings, starter.settings.layout),
        );
      else delete next[starter.id];
      return next;
    });
  }, [
    loaded,
    conflict,
    appliedPreset?.id,
    currentSettingsSignature,
    presetCustomizations,
  ]);
  const previewWorkspace = useMemo(
    () =>
      presetPreview
        ? presetPreviewWorkspace(presetPreview.choice, workspace.grid)
        : null,
    [presetPreview?.choice, workspace.grid.rows, workspace.grid.columns],
  );
  const displayAssets = previewWorkspace?.assets ?? workspace.assets;
  function applyPreset(choice: PresetChoice) {
    dispatchDocument({
      type: "workspace/restore",
      workspace: applyEditorSettings(
        workspace,
        presetSettingsForLayout(choice.settings, workspace.grid),
      ),
    });
    setAppliedPreset({
      id: choice.id,
      settings: editorSettingsSchema.parse(choice.settings),
      updatedAt: choice.updatedAt,
    });
    setPresetPreview(null);
    setHeadingEditing(false);
  }
  useEffect(() => {
    if (
      selectedPanel !== 2 ||
      (!sidebarOpen && !window.matchMedia("(width < 901px)").matches)
    )
      setPresetPreview(null);
  }, [selectedPanel, sidebarOpen]);
  useEffect(() => {
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") setPresetPreview(null);
    };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, []);
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
    loadingCards: number;
  } | null>(null);
  const [saveStatus, setSaveStatus] = useState("Saved locally");
  const { format, resolution, quality } = workspace.exportSettings;
  const patchExport = (patch: Partial<ExportSettings>) =>
    dispatchDocument({ type: "export/patch", patch });
  const [exporting, setExporting] = useState(false);
  const replaceUpload = useRef<HTMLInputElement>(null);
  const resetGridButton = useRef<HTMLButtonElement>(null);
  const [resetGridOpen, setResetGridOpen] = useState(false);
  const board = previewWorkspace?.grid ?? workspace.grid;
  useLayoutEffect(() => {
    const cleaned = removeCreditRequiredImages(workspace);
    if (cleaned === workspace) return;
    dispatchDocument({ type: "workspace/restore", workspace: cleaned });
    toast.info(t("save.removedAttributed"), {
      id: "unsupported-image-licenses",
    });
  }, [workspace]);
  const [captionRows, setCaptionRows] = useState(1);
  const [previewFrame, setPreviewFrame] = useState<HTMLDivElement | null>(null);
  const [canvasOverflow, setCanvasOverflow] = useState({ width: 0, height: 0 });
  const pendingResizeScroll = useRef({ rows: false, columns: false });
  const [previewSize, setPreviewSize] = useState<{
    width: number;
    frameHeight: number;
    previewWidth: number;
    controlsHeight: number;
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
      // Keep the height budget stable when the native horizontal scrollbar appears.
      const scroller = container.parentElement;
      const nativeBar =
        parseFloat(
          getComputedStyle(document.documentElement).getPropertyValue(
            "--native-scrollbar-width",
          ),
        ) || 0;
      const stableHeight = scroller
        ? workspaceHeight +
          (scroller.offsetHeight - scroller.clientHeight) -
          nativeBar
        : workspaceHeight;
      const availableWidth = workspaceWidth + 12;
      const availableHeight = stableHeight + 12;
      const { gap: gapRatio, padding: paddingRatio } = gridSpacing(board, 1);
      const headingGapRatio = board.headingVisible ? gapRatio : 0;
      const widthRatio =
        board.columns + (board.columns - 1) * gapRatio + paddingRatio * 2;
      const headingRatio = board.headingVisible
        ? headingGeometry(board, 1).height
        : 0;
      const headingAreaRatio = board.headingVisible
        ? headingRatio + headingGapRatio + paddingRatio
        : 0;
      const assetIds = new Set(displayAssets.map((asset) => asset.id));
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
        cellWidth *
          (boardHeightRatio - (board.headingVisible ? paddingRatio : 0)) +
          horizontalScrollbar,
      );
      const next = {
        width: viewportWidth + 60,
        frameHeight: height + cellWidth * headingAreaRatio + 60,
        previewWidth: viewportWidth,
        controlsHeight: Math.min(
          availableHeight,
          height + cellWidth * headingAreaRatio,
        ),
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
        Math.abs(previous.controlsHeight - next.controlsHeight) < 0.01 &&
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
    board.titlesVisible,
    board.captionAlignment,
    board.headingVisible,
    board.headingFontSize,
    board.headingPadding,
    board.cells,
    displayAssets,
    captionRows,
  ]);
  useLayoutEffect(() => {
    if (
      !pendingResizeScroll.current.rows &&
      !pendingResizeScroll.current.columns
    )
      return;
    let animationFrame = requestAnimationFrame(() => {
      animationFrame = requestAnimationFrame(() => {
        const scroller = previewFrame?.closest<HTMLElement>(
          "[data-workspace-scroll]",
        );
        const pending = pendingResizeScroll.current;
        pendingResizeScroll.current = { rows: false, columns: false };
        if (scroller) {
          scroller.scrollTo({
            top: pending.rows ? scroller.scrollHeight : scroller.scrollTop,
            left: pending.columns ? scroller.scrollWidth : scroller.scrollLeft,
          });
        }
      });
    });
    return () => cancelAnimationFrame(animationFrame);
  }, [board.id, board.rows, board.columns, previewFrame]);
  useLayoutEffect(() => {
    let active = true;
    const update = () => {
      if (active) setCaptionRows(sharedCaptionRows(board, displayAssets, true));
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
    displayAssets,
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
    pendingResizeScroll.current[key] = true;
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
    const chooseImportedImage = batch.length > 1 && targetCellId !== null;
    if (chooseImportedImage) {
      setImageTarget(targetCellId);
    }
    setImportProgress((current) => ({
      completed: current?.completed ?? 0,
      total: (current?.total ?? 0) + batch.length,
      pending: (current?.pending ?? 0) + 1,
      loadingCards: (current?.loadingCards ?? 0) + batch.length,
    }));
    const targetId = board.id;
    let remaining = batch.length;
    const finishFile = () => {
      remaining -= 1;
      setImportProgress((current) =>
        current
          ? {
              ...current,
              completed: current.completed + 1,
              loadingCards: current.loadingCards - 1,
            }
          : null,
      );
    };
    try {
      for (const file of batch) {
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
        const gif =
          file.type === "image/gif" ||
          /\.gif$/i.test(file.name) ||
          ["GIF87a", "GIF89a"].includes(await file.slice(0, 6).text());
        if (!file.type.startsWith("image/") || gif) {
          toast.error(
            gif
              ? t("library.gifUnsupported", { value1: file.name })
              : `${file.name} is not an image.`,
          );
          finishFile();
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
          dispatchDocument({
            type: "assets/import",
            gridId: targetId,
            cellId: chooseImportedImage ? null : targetCellId,
            assets: [asset],
          });
        } catch {
          if (asset) store.releaseAsset(asset.id);
          toast.error(
            `Could not load ${file.name}. Try a PNG, JPEG, or WebP image.`,
          );
        } finally {
          finishFile();
        }
      }
    } finally {
      setImportProgress((current) =>
        current && current.pending > 1
          ? {
              ...current,
              pending: current.pending - 1,
              loadingCards: current.loadingCards - remaining,
            }
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
        validTarget && (source.kind !== "cell" || source.cellId !== targetId)
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
  const resetGrid = () => {
    localStore.current?.scheduleImageDeletion(
      workspace.assets.map((asset) => asset.id),
    );
    setAppliedPreset(null);
    dispatchDocument(createResetGridCommand());
    setHeadingEditing(false);
    setImageTarget(null);
    setCardDrag(null);
    setResetGridOpen(false);
    previewFrame
      ?.closest("[data-workspace-scroll]")
      ?.scrollTo({ top: 0, left: 0 });
  };
  if (!loaded) {
    return (
      <main className="grid min-h-dvh place-items-center" aria-busy="true">
        <p role="status">{t("editor.loading")}</p>
      </main>
    );
  }
  return (
    <>
      <main className="app-layout relative h-dvh! min-h-0! min-w-0 grid-rows-[auto_minmax(0,1fr)]! transition-[grid-template-columns] duration-180 ease-in-out motion-reduce:transition-none min-[901px]:grid-cols-[minmax(0,1fr)_0px]! min-[901px]:has-data-sidebar-open:grid-cols-[minmax(0,1fr)_calc(350px-var(--native-scrollbar-width,0px))]! max-[901px]:flex! max-[901px]:flex-col!">
        <EditorLayout
          previewing={presetPreview !== null}
          previewId={presetPreview?.key}
          previewBar={
            presetPreview && (
              <div
                role="status"
                data-preset-preview
                className="flex w-full min-w-0 items-center justify-between gap-3"
              >
                <div className="hidden min-w-0 text-sm @min-[30rem]:block">
                  <strong className="block truncate">
                    {t("presets.previewing", {
                      value1: presetPreview.choice.name,
                    })}
                  </strong>
                  <p className="m-0 truncate text-xs text-(--muted)">
                    {t("presets.samples")}
                  </p>
                </div>
                <div className="ml-auto flex shrink-0 gap-2">
                  <Button
                    variant="success"
                    className="h-11 shrink-0 py-0"
                    onClick={() => applyPreset(presetPreview.choice)}
                  >
                    <Check aria-hidden="true" className="size-4" />
                    <span className="@max-[13rem]:sr-only">
                      {t("presets.apply")}
                    </span>
                  </Button>
                  <Button
                    className="size-11 shrink-0 p-0"
                    title={t("presets.close")}
                    aria-label={t("presets.close")}
                    onClick={() => setPresetPreview(null)}
                  >
                    <X aria-hidden="true" className="size-4" />
                  </Button>
                </div>
              </div>
            )
          }
          canvasControls={null}
          status={
            <span
              id="save-status"
              data-save-state={
                saveStatus === "Saved locally" &&
                savedDocument.current === workspace &&
                canSave
                  ? "saved"
                  : saveStatus === "Saving locally"
                    ? "saving"
                    : "blocked"
              }
              hidden
            >
              {saveStatus === "Saved locally"
                ? t("save.saved")
                : saveStatus === "Saving locally"
                  ? t("save.saving")
                  : saveStatus}
            </span>
          }
          actions={
            <>
              <Button
                ref={resetGridButton}
                variant="icon"
                aria-haspopup="dialog"
                aria-label={t("editor.reset.title")}
                title={t("editor.reset.tooltip")}
                disabled={
                  importProgress !== null || exporting || presetPreview !== null
                }
                onClick={() => setResetGridOpen(true)}
              >
                <RotateCcw aria-hidden="true" className="size-5!" />
              </Button>
              <Button
                id="export-grid-header"
                ref={exportButton}
                aria-haspopup="dialog"
                title={t("export.title")}
                aria-label={t("export.title")}
                className="h-11 shrink-0 py-0 group-data-compact-export/header:size-11 group-data-compact-export/header:gap-0 group-data-compact-export/header:p-0 [&_svg]:size-5 [&_svg]:shrink-0"
                disabled={exporting || presetPreview !== null}
                onClick={() => setExportOpen(true)}
              >
                <Download />
                <span className="whitespace-nowrap group-data-compact-export/header:sr-only">
                  {t("export.title")}
                </span>
              </Button>
            </>
          }
        >
          {() => (
            <aside
              className={`asset-panel max-[901px]:p-0! min-[901px]:p-0! min-[901px]:sticky min-[901px]:top-0 min-[901px]:h-dvh min-[901px]:self-start min-[901px]:overflow-hidden min-[901px]:[&_.asset-library]:grid-cols-2! ${libraryDragOver ? "outline-2 -outline-offset-2 outline-(--mint)" : ""}`}
              aria-label={t("library.dropZone")}
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
                className="flex min-h-19 shrink-0 items-center border-0 border-b border-solid border-(--line) px-4 py-4 max-[901px]:hidden"
              >
                <a className="brand" href="./">
                  <span className="brand-mark">
                    <PanelsTopLeft />
                  </span>
                  Gridz
                </a>
              </div>
              <div
                data-sidebar-content
                className="contents min-[901px]:flex min-[901px]:min-h-0 min-[901px]:flex-1 min-[901px]:flex-col min-[901px]:overflow-y-auto min-[901px]:overflow-x-hidden min-[901px]:px-4 min-[901px]:pb-6.5 min-[901px]:scrollbar-gutter-stable min-[901px]:*:shrink-0 max-[901px]:block"
              >
                <div
                  id="asset-library"
                  className="asset-library max-[901px]:h-(--shelf-content-height) max-[901px]:grid-flow-col max-[901px]:grid-rows-[minmax(0,1fr)] max-[901px]:auto-cols-max max-[901px]:grid-cols-none! max-[901px]:overflow-x-auto max-[901px]:overflow-y-hidden max-[901px]:m-0! max-[901px]:p-3!"
                >
                  <UploadTile
                    ref={addImagesButton}
                    squareOnShelf
                    progress={importProgress}
                    gridStyle={board}
                    captionRows={captionRows}
                    className="self-start w-full max-[901px]:h-full max-[901px]:w-auto max-[901px]:self-auto"
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
                      onCrop={(crop, assetId) =>
                        dispatchDocument({ type: "asset/crop", assetId, crop })
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
                  {Array.from(
                    { length: importProgress?.loadingCards ?? 0 },
                    (_, index) => (
                      <LibraryImagePlaceholder
                        key={`upload:${index}`}
                        gridStyle={board}
                        captionRows={captionRows}
                        loading
                      />
                    ),
                  )}
                </div>
                <input
                  id="upload"
                  type="file"
                  accept={imageUploadAccept}
                  multiple
                  hidden
                  onChange={(event) => upload(event)}
                />
              </div>
            </aside>
          )}
          {() => (
            <section
              className="workspace relative flex h-full min-h-0 flex-1 flex-col overflow-hidden in-[.app-layout:not(:has([data-sidebar-open]))]:w-[calc(100%+var(--native-scrollbar-width,0px))]"
              aria-label={t("editor.region")}
            >
              {conflict && (
                <div
                  role="alert"
                  className="flex flex-wrap items-center justify-between gap-3 border-0 border-b border-solid border-(--line) p-4"
                >
                  <p className="m-0 min-w-0 text-sm">{t("save.conflict")}</p>
                  <Button
                    ref={reloadButton}
                    onClick={() => setReloadOpen(true)}
                  >
                    <RefreshCw aria-hidden="true" />
                    {t("save.reload")}
                  </Button>
                </div>
              )}
              <div
                data-workspace-scroll
                className="relative min-h-0 flex-1 overflow-auto overscroll-x-contain scrollbar-gutter-stable"
              >
                <div
                  inert={presetPreview !== null}
                  className="canvas-area sticky top-0 left-0 m-0! flex h-full min-h-0 w-full shrink-0 flex-col justify-center-safe p-3! pr-0! pb-0!"
                >
                  <GridResizer
                    ref={setPreviewFrame}
                    bottomControls={
                      <GridResizeControls
                        dimension="rows"
                        rows={board.rows}
                        columns={board.columns}
                        onResize={resize}
                      />
                    }
                    sideControls={
                      <GridResizeControls
                        dimension="columns"
                        orientation="vertical"
                        rows={board.rows}
                        columns={board.columns}
                        onResize={resize}
                      />
                    }
                    leadingSpace={false}
                    viewportHeight={previewSize?.height}
                    controlsHeight={previewSize?.controlsHeight}
                    previewWidth={previewSize?.previewWidth}
                    onOverflowChange={setCanvasOverflow}
                    heading={
                      board.headingVisible && (
                        <BoardHeading
                          board={board}
                          editing={headingEditing}
                          onEdit={setHeadingEditing}
                          onChange={(heading) => patchBoard({ heading })}
                        />
                      )
                    }
                    style={
                      {
                        width: previewSize?.width,
                        height: previewSize?.frameHeight,
                        flexShrink: 0,
                        "--preview-scrollbar-width": `${-(previewSize?.rowOffset ?? 0) * 2}px`,
                        "--grid-top-padding": board.headingVisible
                          ? "0px"
                          : `${previewSize?.padding ?? board.canvasPadding ?? 60}px`,
                        marginInline: "auto",
                        "--columns": board.columns,
                        "--board-bg": board.background,
                        "--gap": `${previewSize?.gap ?? board.gap}px`,
                        "--canvas-inset": `${previewSize?.padding ?? board.canvasPadding ?? 60}px`,
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
                  >
                    <div
                      id="board-grid"
                      className="board-grid"
                      aria-label={t("editor.gridLabel")}
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
                          const asset = displayAssets.find(
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
                </div>
                <div
                  aria-hidden="true"
                  data-workspace-extent
                  className="pointer-events-none"
                  style={{
                    width: `calc(100% + ${canvasOverflow.width}px + ${canvasOverflow.width > 0 && canvasOverflow.height === 0 ? "var(--native-scrollbar-width,0px)" : "0px"})`,
                    height: canvasOverflow.height,
                  }}
                />
              </div>
            </section>
          )}
          {(settingsActions) => (
            <aside
              className="settings-panel max-[901px]:px-0! min-[901px]:flex! min-[901px]:flex-col min-[901px]:p-0! min-[901px]:sticky min-[901px]:top-0 min-[901px]:h-dvh min-[901px]:self-start min-[901px]:overflow-hidden"
              aria-label={t("settings.title")}
            >
              {settingsActions && (
                <div
                  data-sidebar-header
                  className="min-h-19 shrink-0 border-0 border-b border-solid border-(--line) py-3"
                >
                  {settingsActions}
                </div>
              )}
              <div
                data-sidebar-content
                className="contents min-[901px]:flex min-[901px]:flex-col min-[901px]:min-h-0 min-[901px]:flex-1 min-[901px]:overflow-y-auto min-[901px]:overflow-x-hidden min-[901px]:px-4 min-[901px]:pb-6 min-[901px]:scrollbar-gutter-stable min-[901px]:*:shrink-0"
              >
                <div className="flex flex-col gap-6 max-[901px]:p-3">
                  <fieldset
                    className="@container/settings m-0 flex min-w-0 flex-col gap-4 border-0 p-0"
                    aria-label={t("settings.canvas")}
                  >
                    <h3 className="m-0 text-sm font-semibold text-(--text)">
                      {t("settings.canvas")}
                    </h3>
                    <ColorField
                      id="background"
                      label={t("settings.fields.background")}
                      value={board.background}
                      onChange={(background) => patchBoard({ background })}
                    />
                    <div className="grid grid-cols-2 gap-4 @max-[260px]/settings:grid-cols-1">
                      <PercentField
                        id="canvas-padding"
                        label={t("settings.fields.padding")}
                        outputId="canvas-padding-value"
                        max={120}
                        value={board.canvasPadding ?? 60}
                        onChange={(canvasPadding) =>
                          patchBoard({ canvasPadding })
                        }
                      />
                      <PercentField
                        id="gap"
                        label={t("settings.fields.gap")}
                        outputId="gap-value"
                        max={120}
                        value={board.gap}
                        onChange={(gap) => patchBoard({ gap })}
                      />
                    </div>
                    <PercentField
                      id="corner-rounding"
                      label={t("settings.fields.rounding")}
                      max={25}
                      value={board.cornerRadius ?? 12.5}
                      onChange={(cornerRadius) => patchBoard({ cornerRadius })}
                    />
                  </fieldset>
                  <fieldset
                    className="@container/settings m-0 flex min-w-0 flex-col gap-4 border-0 border-t border-solid border-(--line) p-0 pt-6"
                    aria-label={t("settings.heading")}
                  >
                    <h3 className="m-0 text-sm font-semibold text-(--text)">
                      {t("settings.heading")}
                    </h3>
                    <Toggle
                      label={t("settings.fields.showHeading")}
                      checked={board.headingVisible}
                      onChange={(headingVisible) => {
                        setHeadingEditing(false);
                        patchBoard({ headingVisible });
                      }}
                    />
                    {board.headingVisible && (
                      <>
                        <SelectField
                          id="heading-font"
                          largeFontPreview
                          label={t("settings.fields.font")}
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
                        <div className="grid grid-cols-2 gap-4 @max-[260px]/settings:grid-cols-1">
                          <PercentField
                            id="heading-font-weight"
                            label={t("settings.fields.fontWeight")}
                            outputValue={resolveFontWeight(
                              board.headingFont,
                              board.headingFontWeight,
                            )}
                            min={board.headingFont === "Manrope" ? 100 : 400}
                            max={board.headingFont === "Manrope" ? 900 : 700}
                            step={board.headingFont === "Manrope" ? 100 : 300}
                            value={resolveFontWeight(
                              board.headingFont,
                              board.headingFontWeight,
                            )}
                            valueText={
                              fontWeightOptions(board.headingFont).find(
                                (option) =>
                                  option.value ===
                                  resolveFontWeight(
                                    board.headingFont,
                                    board.headingFontWeight,
                                  ),
                              )?.label
                            }
                            onChange={(headingFontWeight) =>
                              patchBoard({ headingFontWeight })
                            }
                          />
                          <PercentField
                            id="heading-font-size"
                            label={t("settings.fields.fontSize")}
                            min={6}
                            max={36}
                            value={board.headingFontSize ?? 21}
                            onChange={(headingFontSize) =>
                              patchBoard({ headingFontSize })
                            }
                          />
                        </div>
                        <PercentField
                          id="heading-padding"
                          label={t("settings.fields.padding")}
                          max={60}
                          value={board.headingPadding ?? 30}
                          onChange={(headingPadding) =>
                            patchBoard({ headingPadding })
                          }
                        />
                        <div className="grid grid-cols-2 gap-4 @max-[260px]/settings:grid-cols-1">
                          <ColorField
                            id="heading-background-color"
                            label={t("settings.fields.background")}
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
                          <ColorField
                            id="heading-text-color"
                            label={t("settings.fields.textColor")}
                            value={board.headingTextColor ?? palette.text}
                            onChange={(headingTextColor) =>
                              patchBoard({ headingTextColor })
                            }
                          />
                        </div>
                      </>
                    )}
                  </fieldset>
                  <fieldset
                    className="@container/settings m-0 flex min-w-0 flex-col gap-4 border-0 border-t border-solid border-(--line) p-0 pt-6"
                    aria-label={t("settings.card")}
                  >
                    <h3 className="m-0 text-sm font-semibold text-(--text)">
                      {t("settings.card")}
                    </h3>
                    <IconRadioField
                      id="image-shape"
                      label={t("editor.imageShape.label")}
                      value={board.imageAspect ?? "square"}
                      columns={3}
                      options={[
                        {
                          value: "portrait",
                          label: t("editor.imageShape.portrait"),
                          icon: RectangleVertical,
                        },
                        {
                          value: "landscape",
                          label: t("editor.imageShape.landscape"),
                          icon: RectangleHorizontal,
                        },
                        {
                          value: "square",
                          label: t("editor.imageShape.square"),
                          icon: Square,
                        },
                      ]}
                      onChange={(imageAspect) =>
                        patchBoard({
                          imageAspect: imageAspect as NonNullable<
                            Board["imageAspect"]
                          >,
                        })
                      }
                    />
                    <Toggle
                      label={t("settings.fields.showTitles")}
                      checked={board.titlesVisible !== false}
                      onChange={(titlesVisible) =>
                        patchBoard({ titlesVisible })
                      }
                    />
                    {board.titlesVisible !== false && (
                      <>
                        <IconRadioField
                          id="caption-position"
                          label={t("editor.captionPosition.label")}
                          value={
                            board.captionPlacement === "overlay"
                              ? `overlay-${board.captionAlignment === "top" ? "top" : "bottom"}`
                              : (board.captionPlacement ?? "below")
                          }
                          columns={2}
                          options={[
                            {
                              value: "above",
                              label: t("editor.captionPosition.above"),
                              icon: PanelTop,
                            },
                            {
                              value: "below",
                              label: t("editor.captionPosition.below"),
                              icon: PanelBottom,
                            },
                            {
                              value: "overlay-top",
                              label: t("editor.captionPosition.overlayTop"),
                              icon: PanelTopDashed,
                            },
                            {
                              value: "overlay-bottom",
                              label: t("editor.captionPosition.overlayBottom"),
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
                        <SelectField
                          id="cell-font"
                          largeFontPreview
                          label={t("settings.fields.font")}
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
                        <div className="grid grid-cols-2 gap-4 @max-[260px]/settings:grid-cols-1">
                          <PercentField
                            id="cell-font-weight"
                            label={t("settings.fields.fontWeight")}
                            outputValue={resolveFontWeight(
                              board.cellFont,
                              board.cellFontWeight,
                            )}
                            min={board.cellFont === "Manrope" ? 100 : 400}
                            max={board.cellFont === "Manrope" ? 900 : 700}
                            step={board.cellFont === "Manrope" ? 100 : 300}
                            value={resolveFontWeight(
                              board.cellFont,
                              board.cellFontWeight,
                            )}
                            valueText={
                              fontWeightOptions(board.cellFont).find(
                                (option) =>
                                  option.value ===
                                  resolveFontWeight(
                                    board.cellFont,
                                    board.cellFontWeight,
                                  ),
                              )?.label
                            }
                            onChange={(cellFontWeight) =>
                              patchBoard({ cellFontWeight })
                            }
                          />
                          <PercentField
                            id="cell-font-size"
                            label={t("settings.fields.fontSize")}
                            min={6}
                            max={36}
                            value={board.cellFontSize ?? 12}
                            onChange={(cellFontSize) =>
                              patchBoard({ cellFontSize })
                            }
                          />
                        </div>
                        <div className="grid grid-cols-2 gap-4 @max-[260px]/settings:grid-cols-1">
                          <ColorField
                            id="cell-background-color"
                            label={t("settings.fields.background")}
                            value={board.cellBackgroundColor ?? "#111315"}
                            onChange={(cellBackgroundColor) =>
                              patchBoard({ cellBackgroundColor })
                            }
                          />
                          <ColorField
                            id="cell-text-color"
                            label={t("settings.fields.textColor")}
                            value={board.cellTextColor ?? "#f4f4ef"}
                            onChange={(cellTextColor) =>
                              patchBoard({ cellTextColor })
                            }
                          />
                        </div>
                        <div className="grid grid-cols-2 gap-4 @max-[260px]/settings:grid-cols-1">
                          <ColorField
                            id="caption-overlay"
                            label={t("settings.fields.overlayColor")}
                            value={board.captionOverlayColor ?? "#000000"}
                            onChange={(captionOverlayColor) =>
                              patchBoard({ captionOverlayColor })
                            }
                          />
                          <div className="flex flex-col gap-2">
                            <label
                              className="field-label"
                              htmlFor="caption-opacity"
                            >
                              {t("settings.fields.overlayOpacity")}{" "}
                              <output>
                                {board.captionOverlayOpacity ?? 60}%
                              </output>
                            </label>
                            <input
                              id="caption-opacity"
                              type="range"
                              min="0"
                              max="100"
                              value={board.captionOverlayOpacity ?? 60}
                              onChange={(event) =>
                                patchBoard({
                                  captionOverlayOpacity: Number(
                                    event.target.value,
                                  ),
                                })
                              }
                            />
                          </div>
                        </div>
                      </>
                    )}
                  </fieldset>
                </div>
              </div>
            </aside>
          )}
          {() => (
            <PresetsPanel
              currentSettings={currentSettings}
              appliedPresetId={appliedPreset?.id ?? null}
              customizations={presetCustomizations}
              previewId={presetPreview?.choice.id}
              disabled={
                !loaded || conflict || importProgress !== null || exporting
              }
              onPreview={(choice) => {
                setHeadingEditing(false);
                setPresetPreview({ choice, key: crypto.randomUUID() });
              }}
              onReset={(choice) => applyPreset(choice)}
            />
          )}
        </EditorLayout>
      </main>
      {cardDrag?.visual &&
        createPortal(
          <div
            aria-hidden="true"
            inert
            data-drag-floating
            className="pointer-events-none fixed z-100 opacity-100"
            style={{
              width: cardDrag.visual.width,
              height: cardDrag.visual.height,
              left: cardDrag.visual.x - cardDrag.visual.offsetX,
              top: cardDrag.visual.y - cardDrag.visual.offsetY - 8,
              transform: "rotate(-2deg)",
              transformOrigin: `${cardDrag.visual.offsetX}px ${cardDrag.visual.offsetY}px`,
              boxShadow: "0 18px 32px #0008, 0 3px 8px #0006",
              borderRadius: `${board.cornerRadius ?? 12.5}% / ${((board.cornerRadius ?? 12.5) * cardDrag.visual.width) / cardDrag.visual.height}%`,
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
        accept={imageUploadAccept}
        multiple
        hidden
        onChange={(event) => upload(event, uploadTarget.current)}
      />
      <Modal
        open={exportOpen}
        onClose={() => setExportOpen(false)}
        title={t("export.title")}
        returnFocus={exportButton}
      >
        <div className="flex flex-col gap-4">
          <SelectField
            id="format"
            label={t("export.format")}
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
            label={t("export.resolution")}
            value={String(resolution)}
            options={[150, 300, 600, 1200, 1800].map((size) => ({
              value: String(size),
              label: t("export.imageResolution", { value1: size }),
            }))}
            onChange={(resolution) =>
              patchExport({ resolution: Number(resolution) })
            }
          />
          {format !== "image/png" && (
            <PercentField
              id="quality"
              label={t("export.quality")}
              outputId="quality-value"
              min={50}
              max={100}
              step={1}
              value={quality}
              onChange={(quality) => patchExport({ quality })}
            />
          )}
          <p className="text-sm text-(--muted)">
            {size.width} × {size.height}
            {t("export.pixelUnit")}
          </p>
          <div className="flex flex-wrap justify-end gap-2">
            <Button onClick={() => setExportOpen(false)}>
              {t("common.actions.cancel")}
            </Button>
            <Button
              variant="primary"
              className="min-h-11"
              disabled={exporting}
              onClick={exportGrid}
            >
              <Download aria-hidden="true" />
              {exporting ? t("export.progress") : t("export.download")}
            </Button>
          </div>
        </div>
      </Modal>
      <Modal
        open={imageTarget !== null}
        onClose={closeImagePicker}
        title={t("cell.actions.chooseImage")}
        returnFocus={imageReturnFocus}
        size="wide"
      >
        <div
          style={
            {
              "--picker-card-min-width": `${previewCardMinWidth}px`,
              "--picker-card-max-width": `${previewCardMaxWidth}px`,
            } as CSSProperties
          }
        >
          <div
            role="region"
            aria-label={t("library.source.imported")}
          >
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
                  if (files.length === 1) closeImagePicker();
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
                  onCrop={(crop, assetId) =>
                    dispatchDocument({ type: "asset/crop", assetId, crop })
                  }
                  onDelete={() => deleteImages([asset.id])}
                  onSelect={() => {
                    if (imageTarget) placeAsset(asset.id, imageTarget);
                    closeImagePicker();
                  }}
                />
              ))}
              {Array.from(
                { length: importProgress?.loadingCards ?? 0 },
                (_, index) => (
                  <LibraryImagePlaceholder
                    key={`upload:${index}`}
                    gridStyle={board}
                    captionRows={captionRows}
                    loading
                  />
                ),
              )}
            </div>
            <input
              id="picker-cell-upload"
              type="file"
              accept={imageUploadAccept}
              multiple
              hidden
              onChange={(event) => {
                if (!event.currentTarget.files?.length) return;
                const singleImage = event.currentTarget.files.length === 1;
                void upload(event, imageTarget);
                if (singleImage) closeImagePicker();
              }}
            />
          </div>
        </div>
      </Modal>
      <Modal
        open={reloadOpen}
        onClose={() => setReloadOpen(false)}
        title={t("save.reload")}
        returnFocus={reloadButton}
      >
        <p>{t("save.reloadPrompt")}</p>
        <div className="mb-4 flex flex-wrap justify-end gap-2">
          <Button onClick={() => setReloadOpen(false)}>
            {t("common.actions.cancel")}
          </Button>
          <Button
            variant="primary"
            onClick={() => {
              deliberateReload.current = true;
              window.location.reload();
            }}
          >
            <RefreshCw aria-hidden="true" />
            {t("save.reload")}
          </Button>
        </div>
      </Modal>
      <Modal
        open={resetGridOpen}
        onClose={() => setResetGridOpen(false)}
        title={t("editor.reset.title")}
        returnFocus={resetGridButton}
      >
        <p>{t("editor.reset.prompt")}</p>
        <p>{t("editor.reset.retention")}</p>
        <div className="mt-4 mb-4 flex justify-end gap-2">
          <Button onClick={() => setResetGridOpen(false)}>
            {t("common.actions.cancel")}
          </Button>
          <Button
            variant="danger"
            disabled={importProgress !== null}
            onClick={resetGrid}
          >
            <RotateCcw aria-hidden="true" />
            {t("editor.reset.title")}
          </Button>
        </div>
      </Modal>
    </>
  );
}
