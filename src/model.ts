export const fontOptions = ["Bangers", "Boogaloo", "Bebas Neue"];
export const storageKey = "gridroom-v1";
export const gridLimit = 12;
export type Publisher = "none" | "dc" | "marvel";
export type ImageFormat = "image/png" | "image/jpeg" | "image/webp";
export interface Asset {
  id: string;
  category: string;
  title: string;
  src: string;
}
export interface Cell {
  id: string;
  assetId: string | null;
  title: string;
  fit: "contain" | "cover";
}
export interface OverflowCell {
  row: number;
  column: number;
  cell: Cell;
}
export interface Board {
  id: string;
  name: string;
  publisher: Publisher;
  heading: string;
  headingVisible: boolean;
  headingFont: string;
  cellFont: string;
  rows: number;
  columns: number;
  gap: number;
  background: string;
  cells: Cell[];
  overflow: OverflowCell[];
}
export interface Workspace {
  assets: Asset[];
  boards: Board[];
  active: number;
}
export const publishers = {
  none: { color: "transparent", caption: "#202325", text: "#d8f36a" },
  dc: { color: "#0085c7", caption: "#123c55", text: "#ffffff" },
  marvel: { color: "#ed1d24", caption: "#4b1a20", text: "#ffffff" },
};
const sources = [
  ["DC", "Color Kid"],
  ["DC", "Condiment King"],
  ["DC", "Friendly Fire"],
  ["DC", "Kite Man"],
  ["Marvel", "Eye-Boy"],
  ["Marvel", "Hindsight"],
  ["Marvel", "Paste-Pot Pete"],
  ["Marvel", "Soft Serve"],
];
export const initialAssets: Asset[] = sources.map(
  ([category, title], index) => ({
    id: `asset-${index}`,
    category,
    title,
    src: `assets/${category} - ${title}.jpg`,
  }),
);
export const makeCell = (asset: Asset | null = null): Cell => ({
  id: crypto.randomUUID(),
  assetId: asset?.id ?? null,
  title: asset?.title ?? "",
  fit: "contain",
});
const defaultHeading = (name: string) =>
  (
    ({
      "DC Characters": "Team DC",
      "Marvel Characters": "Team Marvel",
    }) as Record<string, string>
  )[name] || "";
const defaultPublisher = (
  name: string,
  assets: (Asset | undefined)[] = [],
): Publisher => {
  const named: Record<string, Publisher> = {
    "DC Characters": "dc",
    "Marvel Characters": "marvel",
  };
  if (named[name]) return named[name];
  const category = assets[0]?.category;
  return assets.length &&
    category &&
    assets.every((asset) => asset?.category === category) &&
    ["DC", "Marvel"].includes(category)
    ? category === "DC"
      ? "dc"
      : "marvel"
    : "none";
};
export const makeBoard = (name: string, assets: Asset[] = []): Board => ({
  id: crypto.randomUUID(),
  name,
  publisher: defaultPublisher(name, assets),
  heading: defaultHeading(name),
  headingVisible: true,
  headingFont: "Bangers",
  cellFont: "Boogaloo",
  rows: 2,
  columns: 2,
  gap: 12,
  background: "#17191b",
  cells: Array.from({ length: 4 }, (_, index) => makeCell(assets[index])),
  overflow: [],
});
export function resizeBoard(
  board: Board,
  rows: number,
  columns: number,
): Board {
  rows = Math.max(1, Math.min(gridLimit, Math.round(Number(rows) || 1)));
  columns = Math.max(1, Math.min(gridLimit, Math.round(Number(columns) || 1)));
  const positions = new Map<string, OverflowCell>();
  board.cells.forEach((cell, index) => {
    const row = Math.floor(index / board.columns);
    const column = index % board.columns;
    positions.set(`${row}:${column}`, { row, column, cell });
  });
  for (const entry of board.overflow ?? []) {
    const key = `${entry.row}:${entry.column}`;
    if (!positions.has(key)) positions.set(key, entry);
  }
  const cells = Array.from({ length: rows * columns }, (_, index) => {
    const row = Math.floor(index / columns);
    const column = index % columns;
    const key = `${row}:${column}`;
    const cell = positions.get(key)?.cell ?? makeCell();
    positions.delete(key);
    return cell;
  });
  return { ...board, rows, columns, cells, overflow: [...positions.values()] };
}
export function removeBoard(workspace: Workspace, boardId: string): Workspace {
  const position = workspace.boards.findIndex((board) => board.id === boardId);
  if (position < 0) return workspace;
  const activeId = workspace.boards[workspace.active]?.id;
  const boards = workspace.boards.filter((board) => board.id !== boardId);
  const survivingActive = boards.findIndex((board) => board.id === activeId);
  return {
    ...workspace,
    boards,
    active:
      survivingActive >= 0
        ? survivingActive
        : Math.max(0, Math.min(position, boards.length - 1)),
  };
}
export function restoreBoard(
  workspace: Workspace,
  board: Board,
  position: number,
): Workspace {
  if (workspace.boards.some((item) => item.id === board.id)) return workspace;
  const insertion = Math.max(0, Math.min(position, workspace.boards.length));
  const boards = [...workspace.boards];
  boards.splice(insertion, 0, board);
  return { ...workspace, boards, active: insertion };
}
export function loadWorkspace(): Workspace {
  const fallback: Workspace = {
    assets: initialAssets,
    boards: [
      makeBoard("DC Characters", initialAssets.slice(0, 4)),
      makeBoard("Marvel Characters", initialAssets.slice(4)),
    ],
    active: 0,
  };
  try {
    const saved = JSON.parse(
      localStorage.getItem(storageKey) ?? "null",
    ) as Workspace | null;
    if (
      !saved ||
      !Array.isArray(saved.boards) ||
      !Array.isArray(saved.assets) ||
      !saved.boards.every(
        (board) =>
          Number.isInteger(board.rows) &&
          board.rows >= 1 &&
          board.rows <= gridLimit &&
          Number.isInteger(board.columns) &&
          board.columns >= 1 &&
          board.columns <= gridLimit &&
          Array.isArray(board.cells) &&
          board.cells.length >= board.rows * board.columns,
      )
    )
      return fallback;
    saved.active = Math.max(
      0,
      Math.min(saved.active || 0, saved.boards.length - 1),
    );
    saved.boards.forEach((item) => {
      const seen = new Set();
      const identify = (cell: Cell): Cell => {
        const id =
          typeof cell.id === "string" && !seen.has(cell.id)
            ? cell.id
            : crypto.randomUUID();
        seen.add(id);
        return { ...cell, id };
      };
      item.cells = item.cells.map(identify);
      item.overflow = Array.isArray(item.overflow)
        ? item.overflow
            .filter(
              (entry) =>
                Number.isInteger(entry.row) &&
                entry.row >= 0 &&
                Number.isInteger(entry.column) &&
                entry.column >= 0 &&
                entry.cell &&
                typeof entry.cell === "object",
            )
            .map((entry) => ({ ...entry, cell: identify(entry.cell) }))
        : [];
      Object.assign(item, resizeBoard(item, item.rows, item.columns));
      if (!Object.hasOwn(publishers, item.publisher))
        item.publisher = defaultPublisher(
          item.name,
          item.cells
            .filter((entry) => entry.assetId)
            .map((entry) =>
              saved.assets.find((asset) => asset.id === entry.assetId),
            ),
        );
      if (typeof item.heading !== "string")
        item.heading = defaultHeading(item.name);
      if (typeof item.headingVisible !== "boolean") item.headingVisible = true;
      if (!fontOptions.includes(item.headingFont)) item.headingFont = "Bangers";
      if (!fontOptions.includes(item.cellFont)) item.cellFont = "Boogaloo";
    });
    return saved;
  } catch {
    return fallback;
  }
}
