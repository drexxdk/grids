import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  PanelsTopLeft,
  Download,
  Plus,
  HardDrive,
  Type,
  ImagePlus,
  Scan,
  Crop,
  Trash2,
  Pencil,
  Undo2,
} from "lucide-react";
import {
  Accordion,
  ActionMenu,
  Button,
  Toggle,
} from "./components/ui/controls";
import { Modal } from "./components/ui/Modal";
import {
  fontOptions,
  loadWorkspace,
  makeBoard,
  makeCell,
  publishers,
  removeBoard,
  restoreBoard,
  storageKey,
} from "./model";
import { createExport, dimensions, fitTitle, loadImage } from "./export";

function BoardHeading({ board }) {
  const headingRef = useRef(null);
  useLayoutEffect(() => {
    const heading = headingRef.current;
    let cancelled = false;
    const fit = () => {
      if (cancelled || heading.hidden) return;
      const context = document.createElement("canvas").getContext("2d");
      context.letterSpacing = "0.5px";
      heading.style.fontSize = `${fitTitle(context, board.heading, board.headingFont, (heading.clientHeight * 0.18) / 0.28, heading.firstChild.clientWidth * 0.92, heading.clientHeight * 0.82).fontSize}px`;
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
  }, [board.heading, board.headingFont, board.headingVisible, board.columns]);
  return (
    <h2
      ref={headingRef}
      className="board-export-heading"
      hidden={board.headingVisible === false || !board.heading.trim()}
    >
      <span className="board-heading-text">{board.heading}</span>
    </h2>
  );
}

export default function App() {
  const [workspace, setWorkspace] = useState(loadWorkspace);
  const [selectedCell, setSelectedCell] = useState(0);
  const [filter, setFilter] = useState("All");
  const [toast, setToast] = useState("");
  const [saveStatus, setSaveStatus] = useState("Saved locally");
  const [format, setFormat] = useState("image/png");
  const [resolution, setResolution] = useState(1200);
  const [quality, setQuality] = useState(95);
  const [exporting, setExporting] = useState(false);
  const replaceUpload = useRef(null);
  const boardActions = useRef(null);
  const renameInput = useRef(null);
  const [renaming, setRenaming] = useState(null);
  const [draftName, setDraftName] = useState("");
  const [deletedBoards, setDeletedBoards] = useState([]);
  const addBoardButton = useRef(null);
  const board = workspace.boards[workspace.active];
  const cell = board?.cells[selectedCell];
  const palette = board ? publishers[board.publisher] : publishers.none;
  const size = board ? dimensions(board, resolution) : null;
  useEffect(() => {
    try {
      localStorage.setItem(storageKey, JSON.stringify(workspace));
      setSaveStatus("Saved locally");
    } catch {
      setSaveStatus("Session only");
      setToast(
        "Browser storage is full. Your current boards can still be exported.",
      );
    }
  }, [workspace]);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(""), 4500);
    return () => clearTimeout(timer);
  }, [toast]);
  const updateBoard = (update) =>
    setWorkspace((current) => ({
      ...current,
      boards: current.boards.map((item) =>
        item.id === board?.id ? update(item) : item,
      ),
    }));
  const patchBoard = (patch) => updateBoard((item) => ({ ...item, ...patch }));
  const patchCell = (patch) =>
    updateBoard((item) => ({
      ...item,
      cells: item.cells.map((entry, index) =>
        index === selectedCell ? { ...entry, ...patch } : entry,
      ),
    }));
  const placeAsset = (id, index) => {
    if (!board) return;
    const asset = workspace.assets.find((asset) => asset.id === id);
    if (!asset) return;
    updateBoard((item) => ({
      ...item,
      cells: item.cells.map((entry, position) =>
        position === index ? makeCell(asset) : entry,
      ),
    }));
    setSelectedCell(index);
  };
  const resize = (key, input) => {
    const value = Math.max(1, Math.min(6, Math.round(Number(input) || 1)));
    const count =
      (key === "rows" ? value : board.rows) *
      (key === "columns" ? value : board.columns);
    updateBoard((item) => ({
      ...item,
      [key]: value,
      cells: Array.from(
        { length: Math.max(count, item.cells.length) },
        (_, index) => item.cells[index] || makeCell(),
      ),
    }));
    setSelectedCell((current) => Math.min(current, count - 1));
  };
  const importFiles = async (files, targetIndex = null) => {
    const targetId = board?.id;
    const assets = [];
    for (const file of Array.from(files)) {
      if (!file.type.startsWith("image/")) {
        setToast(`${file.name} is not an image.`);
        continue;
      }
      try {
        const src = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result);
          reader.onerror = reject;
          reader.readAsDataURL(file);
        });
        await loadImage(src);
        assets.push({
          id: crypto.randomUUID(),
          category: "Imported",
          title: file.name.replace(/\.[^.]+$/, "").replace(/[-_]/g, " "),
          src,
        });
      } catch {
        setToast(
          `Could not load ${file.name}. Try a PNG, JPEG, or WebP image.`,
        );
      }
    }
    setWorkspace((current) => ({
      ...current,
      assets: [...current.assets, ...assets],
      boards: current.boards.map((item) =>
        item.id !== targetId || targetIndex === null
          ? item
          : {
              ...item,
              cells: item.cells.map((entry, index) =>
                index < item.rows * item.columns && assets[index - targetIndex]
                  ? makeCell(assets[index - targetIndex])
                  : entry,
              ),
            },
      ),
    }));
    setFilter("All");
  };
  const drop = (event, index) => {
    event.preventDefault();
    event.currentTarget.classList.remove("drag-over");
    const assetId = event.dataTransfer.getData("application/x-gridroom-asset");
    const sourceIndex = event.dataTransfer.getData(
      "application/x-gridroom-cell",
    );
    if (assetId) placeAsset(assetId, index);
    else if (sourceIndex !== "") {
      const source = Number(sourceIndex);
      if (
        Number.isInteger(source) &&
        source >= 0 &&
        source < board.rows * board.columns
      ) {
        updateBoard((item) => {
          const cells = [...item.cells];
          [cells[source], cells[index]] = [cells[index], cells[source]];
          return { ...item, cells };
        });
        setSelectedCell(index);
      }
    } else if (event.dataTransfer.files.length) {
      setSelectedCell(index);
      importFiles(event.dataTransfer.files, index);
    }
  };
  const exportBoards = async (all = false) => {
    if (exporting || !board) return;
    setExporting(true);
    const items = structuredClone(all ? workspace.boards : [board]);
    const extension = {
      "image/png": "png",
      "image/jpeg": "jpg",
      "image/webp": "webp",
    }[format];
    try {
      for (const item of items) {
        const blob = await createExport(
          item,
          workspace.assets,
          resolution,
          format,
          quality / 100,
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
      }
      setToast(
        all
          ? `${items.length} boards exported. Allow multiple downloads if your browser asks.`
          : "Board exported.",
      );
    } catch (error) {
      setToast(error.message || "Export failed. Try a smaller resolution.");
    } finally {
      setExporting(false);
    }
  };
  const upload = async (event, target = null) => {
    const input = event.currentTarget;
    await importFiles(input.files, target);
    input.value = "";
  };
  const addBoard = () => {
    setWorkspace((current) => ({
      ...current,
      boards: [
        ...current.boards,
        makeBoard(`Board ${current.boards.length + 1}`),
      ],
      active: current.boards.length,
    }));
    setSelectedCell(0);
  };
  const deleteActiveBoard = () => {
    if (!board) return;
    setDeletedBoards((current) => [
      ...current,
      { board, position: workspace.active, selectedCell },
    ]);
    setWorkspace((current) => removeBoard(current, board.id));
    setSelectedCell(0);
    setToast(`Deleted ${board.name}.`);
    if (workspace.boards.length === 1)
      requestAnimationFrame(() =>
        addBoardButton.current?.focus({ preventScroll: true }),
      );
  };
  const undoBoardDeletion = () => {
    const entry = deletedBoards.at(-1);
    if (!entry) return;
    setWorkspace((current) =>
      restoreBoard(current, entry.board, entry.position),
    );
    setDeletedBoards((current) => current.slice(0, -1));
    setSelectedCell(entry.selectedCell);
    setToast(`Restored ${entry.board.name}.`);
    requestAnimationFrame(() =>
      addBoardButton.current?.focus({ preventScroll: true }),
    );
  };
  return (
    <>
      <header className="app-header">
        <a className="brand" href="./">
          <span className="brand-mark">
            <PanelsTopLeft />
          </span>
          GRIDROOM<span className="brand-tag">IMAGE BOARDS</span>
        </a>
        <div className="header-actions">
          <span id="save-status" className="save-status">
            {saveStatus}
          </span>
          <button
            id="export-all"
            className="button secondary"
            disabled={exporting || !board}
            onClick={() => exportBoards(true)}
          >
            <Download />
            <span>Export all boards</span>
          </button>
        </div>
      </header>
      <main
        className={`app-layout${board ? "" : " tw:!grid-cols-1 tw:md:!grid-cols-[230px_minmax(0,1fr)]"}`}
      >
        <aside className="asset-panel">
          <div className="section-heading">
            <h2>Image library</h2>
            <span id="asset-count" className="count">
              {workspace.assets.length}
            </span>
          </div>
          <label className="upload-button" htmlFor="upload">
            <Plus />
            Add images
            <input
              id="upload"
              type="file"
              accept="image/*"
              multiple
              hidden
              onChange={(event) => upload(event)}
            />
          </label>
          <div className="filter-tabs" role="group" aria-label="Image category">
            {["All", "DC", "Marvel"].map((category) => (
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
          <div id="asset-library" className="asset-library">
            {workspace.assets
              .filter((asset) => filter === "All" || asset.category === filter)
              .map((asset) => (
                <button
                  key={asset.id}
                  className="asset"
                  disabled={!board}
                  title={`Place ${asset.title} in selected cell`}
                  draggable
                  onClick={() => placeAsset(asset.id, selectedCell)}
                  onDragStart={(event) => {
                    event.dataTransfer.setData(
                      "application/x-gridroom-asset",
                      asset.id,
                    );
                    event.dataTransfer.effectAllowed = "copy";
                  }}
                >
                  <img src={asset.src} alt={asset.title} draggable={false} />
                  <span className="asset-name">{asset.title}</span>
                  <span className="asset-category">{asset.category}</span>
                </button>
              ))}
          </div>
          <div className="library-footer">
            <span className="status-dot" />
            <span>Local workspace</span>
            <HardDrive />
          </div>
        </aside>
        <section className="workspace" aria-label="Board editor">
          <div className="workspace-toolbar">
            <div
              id="board-tabs"
              className="board-tabs"
              role="tablist"
              aria-label="Boards"
            >
              {workspace.boards.map((item, index) => (
                <button
                  key={item.id}
                  className="board-tab"
                  role="tab"
                  aria-selected={index === workspace.active}
                  onClick={() => {
                    setWorkspace((current) => ({ ...current, active: index }));
                    setSelectedCell(0);
                  }}
                >
                  <span>{String(index + 1).padStart(2, "0")}</span>
                  {item.name}
                </button>
              ))}
            </div>
            {board && (
              <ActionMenu
                buttonRef={boardActions}
                actions={[
                  {
                    label: "Rename board",
                    icon: Pencil,
                    onSelect: () => {
                      setDraftName(board.name);
                      setRenaming(board.id);
                    },
                  },
                  {
                    label: "Download image",
                    icon: Download,
                    onSelect: () => exportBoards(),
                    disabled: exporting,
                  },
                ]}
              />
            )}
            {board && (
              <Button
                variant="icon"
                aria-label={`Delete board: ${board.name}`}
                title={`Delete board: ${board.name}`}
                onClick={deleteActiveBoard}
              >
                <Trash2 aria-hidden="true" />
              </Button>
            )}
            {deletedBoards.length > 0 && (
              <Button
                variant="icon"
                aria-label="Undo board deletion"
                title="Undo board deletion"
                onClick={undoBoardDeletion}
              >
                <Undo2 aria-hidden="true" />
              </Button>
            )}
            <button
              id="add-board"
              ref={addBoardButton}
              className="icon-button"
              title="Add board"
              aria-label="Add board"
              onClick={addBoard}
            >
              <Plus />
            </button>
          </div>
          {board ? (
            <div className="canvas-area">
              <div className="canvas-heading">
                <div>
                  <span className="eyebrow">THE CANVAS</span>
                  <h1 id="canvas-title">{board.name}</h1>
                </div>
                <span id="board-summary" className="canvas-meta">
                  {board.rows} × {board.columns} /{" "}
                  {
                    board.cells
                      .slice(0, board.rows * board.columns)
                      .filter((item) => item.assetId).length
                  }{" "}
                  images
                </span>
              </div>
              <div
                id="board-grid"
                className="board-grid"
                aria-label="Image grid"
                style={{
                  "--columns": board.columns,
                  "--gap": `${board.gap}px`,
                  "--board-bg": board.background,
                  "--publisher-color": palette.color,
                  "--publisher-text": palette.text,
                  "--caption-color": palette.caption,
                  "--heading-font": `"${board.headingFont}"`,
                  "--cell-font": `"${board.cellFont}"`,
                }}
              >
                <BoardHeading board={board} />
                {board.cells
                  .slice(0, board.rows * board.columns)
                  .map((item, index) => {
                    const asset = workspace.assets.find(
                      (asset) => asset.id === item.assetId,
                    );
                    return (
                      <div
                        key={`${board.id}-${index}`}
                        className={`grid-cell${selectedCell === index ? " selected" : ""}`}
                        data-index={index}
                        onDragOver={(event) => {
                          event.preventDefault();
                          event.currentTarget.classList.add("drag-over");
                        }}
                        onDragLeave={(event) => {
                          if (
                            !event.currentTarget.contains(event.relatedTarget)
                          )
                            event.currentTarget.classList.remove("drag-over");
                        }}
                        onDrop={(event) => drop(event, index)}
                      >
                        <button
                          className="cell-image-button"
                          aria-label={`Select cell ${index + 1}${item.title ? `: ${item.title}` : ""}`}
                          draggable={Boolean(asset)}
                          onClick={() => setSelectedCell(index)}
                          onDoubleClick={() => {
                            setSelectedCell(index);
                            replaceUpload.current.click();
                          }}
                          onDragStart={(event) => {
                            event.dataTransfer.setData(
                              "application/x-gridroom-cell",
                              String(index),
                            );
                            event.dataTransfer.effectAllowed = "move";
                          }}
                        >
                          {asset ? (
                            <img
                              src={asset.src}
                              alt={item.title}
                              style={{ objectFit: item.fit }}
                              draggable={false}
                            />
                          ) : (
                            <span className="empty-cell">
                              <ImagePlus />
                              <span>Add image</span>
                            </span>
                          )}
                          <span className="cell-badge">
                            {String(index + 1).padStart(2, "0")}
                          </span>
                        </button>
                        <textarea
                          className="cell-heading"
                          rows={1}
                          maxLength={120}
                          value={item.title}
                          placeholder="ADD HEADING"
                          aria-label={`Heading for cell ${index + 1}`}
                          onFocus={() => setSelectedCell(index)}
                          onChange={(event) => {
                            const title = event.target.value;
                            updateBoard((current) => ({
                              ...current,
                              cells: current.cells.map((entry, position) =>
                                position === index
                                  ? { ...entry, title }
                                  : entry,
                              ),
                            }));
                          }}
                        />
                      </div>
                    );
                  })}
              </div>
              <div className="canvas-footer">
                <span>
                  <Type />
                  <span id="font-summary">
                    {`${board.headingFont} / ${board.cellFont}`.toUpperCase()}
                  </span>
                </span>
                <span id="canvas-dimensions">
                  {size.width} × {size.height} px
                </span>
              </div>
            </div>
          ) : (
            <div className="canvas-area tw:grid tw:min-h-[360px] tw:place-content-center tw:justify-items-center tw:gap-4">
              <PanelsTopLeft
                aria-hidden="true"
                className="tw:size-8 tw:text-[var(--muted)]"
              />
              <h1>No boards</h1>
              <Button onClick={addBoard}>
                <Plus aria-hidden="true" />
                Add board
              </Button>
            </div>
          )}
        </section>
        {board && (
          <aside className="settings-panel">
            <Accordion title="Board settings">
              <label className="field-label" htmlFor="board-name">
                Board name
              </label>
              <input
                id="board-name"
                maxLength={70}
                value={board.name}
                onChange={(event) => patchBoard({ name: event.target.value })}
              />
              <label className="field-label" htmlFor="image-heading">
                Image heading
              </label>
              <Toggle
                label="Show heading"
                checked={board.headingVisible !== false}
                onChange={(headingVisible) => patchBoard({ headingVisible })}
              />
              <input
                id="image-heading"
                maxLength={120}
                placeholder="Team name"
                value={board.heading}
                onChange={(event) =>
                  patchBoard({ heading: event.target.value })
                }
              />
              <label className="field-label" htmlFor="publisher">
                Publisher
              </label>
              <select
                id="publisher"
                value={board.publisher}
                onChange={(event) =>
                  patchBoard({ publisher: event.target.value })
                }
              >
                <option value="none">None</option>
                <option value="dc">DC</option>
                <option value="marvel">Marvel</option>
              </select>
              <label className="field-label" htmlFor="heading-font">
                Heading font
              </label>
              <select
                id="heading-font"
                value={board.headingFont}
                onChange={(event) =>
                  patchBoard({ headingFont: event.target.value })
                }
              >
                {fontOptions.map((font) => (
                  <option key={font}>{font}</option>
                ))}
              </select>
              <label className="field-label" htmlFor="cell-font">
                Character font
              </label>
              <select
                id="cell-font"
                value={board.cellFont}
                onChange={(event) =>
                  patchBoard({ cellFont: event.target.value })
                }
              >
                {fontOptions.map((font) => (
                  <option key={font}>{font}</option>
                ))}
              </select>
              <div className="field-pair">
                {["rows", "columns"].map((key) => (
                  <label key={key}>
                    {key === "rows" ? "Rows" : "Columns"}
                    <input
                      id={key}
                      type="number"
                      min="1"
                      max="6"
                      defaultValue={board[key]}
                      key={`${board.id}-${board[key]}`}
                      onBlur={(event) => resize(key, event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") event.currentTarget.blur();
                      }}
                    />
                  </label>
                ))}
              </div>
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
              <label className="field-label" htmlFor="background">
                Background
              </label>
              <div className="color-field">
                <input
                  id="background"
                  type="color"
                  value={board.background}
                  onChange={(event) =>
                    patchBoard({ background: event.target.value })
                  }
                />
                <span id="background-value">
                  {board.background.toUpperCase()}
                </span>
              </div>
            </Accordion>
            <section className="settings-section">
              <div className="section-heading">
                <span className="eyebrow">SELECTED CELL</span>
                <span id="cell-number" className="count">
                  {String(selectedCell + 1).padStart(2, "0")}
                </span>
              </div>
              <label className="field-label" htmlFor="cell-title">
                Heading
              </label>
              <textarea
                id="cell-title"
                rows={2}
                maxLength={120}
                value={cell.title}
                onChange={(event) => patchCell({ title: event.target.value })}
              />
              <span className="field-label">Image fit</span>
              <div className="segmented" role="group" aria-label="Image fit">
                <button
                  id="fit-contain"
                  aria-pressed={cell.fit === "contain"}
                  onClick={() => patchCell({ fit: "contain" })}
                >
                  <Scan />
                  Fit
                </button>
                <button
                  id="fit-cover"
                  aria-pressed={cell.fit === "cover"}
                  onClick={() => patchCell({ fit: "cover" })}
                >
                  <Crop />
                  Fill
                </button>
              </div>
              <div className="cell-actions">
                <button
                  id="replace-image"
                  className="text-button"
                  onClick={() => replaceUpload.current.click()}
                >
                  <ImagePlus />
                  Replace
                </button>
                <button
                  id="remove-image"
                  className="icon-button"
                  title="Clear selected cell"
                  aria-label="Clear selected cell"
                  onClick={() => patchCell(makeCell())}
                >
                  <Trash2 />
                </button>
              </div>
              <input
                ref={replaceUpload}
                id="replace-upload"
                type="file"
                accept="image/*"
                hidden
                onChange={(event) => upload(event, selectedCell)}
              />
            </section>
            <section className="settings-section export-section">
              <span className="eyebrow">EXPORT</span>
              <label className="field-label" htmlFor="format">
                File format
              </label>
              <select
                id="format"
                value={format}
                onChange={(event) => setFormat(event.target.value)}
              >
                <option value="image/png">PNG</option>
                <option value="image/jpeg">JPEG</option>
                <option value="image/webp">WebP</option>
              </select>
              <label className="field-label" htmlFor="resolution">
                Resolution
              </label>
              <select
                id="resolution"
                value={resolution}
                onChange={(event) => setResolution(Number(event.target.value))}
              >
                <option value="600">600 px / image</option>
                <option value="1200">1200 px / image</option>
                <option value="1800">1800 px / image</option>
              </select>
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
                onChange={(event) => setQuality(Number(event.target.value))}
              />
              <button
                id="export-board"
                className="button primary"
                disabled={exporting}
                onClick={() => exportBoards()}
              >
                <Download />
                Export board
              </button>
            </section>
          </aside>
        )}
      </main>
      <div id="toast" className="toast" role="status" hidden={!toast}>
        {toast}
      </div>
      <Modal
        open={renaming !== null}
        onClose={() => setRenaming(null)}
        title="Rename board"
        initialFocus={renameInput}
        returnFocus={boardActions}
      >
        <form
          onSubmit={(event) => {
            event.preventDefault();
            const name = draftName.trim();
            if (!name) return;
            setWorkspace((current) => ({
              ...current,
              boards: current.boards.map((item) =>
                item.id === renaming ? { ...item, name } : item,
              ),
            }));
            setRenaming(null);
          }}
        >
          <label
            htmlFor="rename-board-name"
            className="tw:mb-2 tw:block tw:text-sm tw:font-semibold"
          >
            Board name
          </label>
          <input
            ref={renameInput}
            id="rename-board-name"
            value={draftName}
            maxLength={70}
            required
            onChange={(event) => setDraftName(event.target.value)}
            className="tw:box-border tw:w-full tw:rounded-md tw:border tw:border-solid tw:border-[var(--line)] tw:bg-[var(--bg)] tw:px-3 tw:py-2 tw:text-[var(--text)]"
          />
          <div className="tw:mt-5 tw:flex tw:justify-end tw:gap-2">
            <Button onClick={() => setRenaming(null)}>Cancel</Button>
            <Button
              type="submit"
              variant="primary"
              disabled={!draftName.trim()}
            >
              Save
            </Button>
          </div>
        </form>
      </Modal>
    </>
  );
}
