import { z } from "zod";

export const fontOptions = ["Manrope", "Bangers", "Boogaloo", "Bebas Neue"];
export const storageKey = "grids-editor-v1";
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
  version: 1;
  assets: Asset[];
  grid: Board;
  exportSettings: ExportSettings;
}
export interface ExportSettings {
  format: ImageFormat;
  resolution: number;
  quality: number;
}
export const publishers = {
  none: { color: "transparent", caption: "#202325", text: "#d8f36a" },
  dc: { color: "#0085c7", caption: "#123c55", text: "#ffffff" },
  marvel: { color: "#ed1d24", caption: "#4b1a20", text: "#ffffff" },
};
export const makeCell = (asset: Asset | null = null): Cell => ({
  id: crypto.randomUUID(),
  assetId: asset?.id ?? null,
  title: asset?.title.slice(0, 120) ?? "",
  fit: "contain",
});
export const makeBoard = (name: string, assets: Asset[] = []): Board => ({
  id: crypto.randomUUID(),
  name,
  publisher: "none",
  heading: "",
  headingVisible: true,
  headingFont: "Manrope",
  cellFont: "Manrope",
  rows: 3,
  columns: 3,
  gap: 12,
  background: "#17191b",
  cells: Array.from({ length: 9 }, (_, index) => makeCell(assets[index])),
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
export const makeWorkspace = (): Workspace => ({
  version: 1,
  assets: [],
  grid: makeBoard("Grid"),
  exportSettings: { format: "image/png", resolution: 1200, quality: 95 },
});

export function resetWorkspace(workspace: Workspace): Workspace {
  const defaults = makeWorkspace();
  const resized = resizeBoard(
    workspace.grid,
    defaults.grid.rows,
    defaults.grid.columns,
  );
  return {
    ...defaults,
    assets: workspace.assets,
    grid: {
      ...defaults.grid,
      id: workspace.grid.id,
      cells: resized.cells,
      overflow: resized.overflow,
    },
  };
}

const cellSchema = z.strictObject({
  id: z.uuid(),
  assetId: z.uuid().nullable(),
  title: z.string().max(120),
  fit: z.enum(["contain", "cover"]),
});
const coordinate = z
  .number()
  .int()
  .min(0)
  .max(gridLimit - 1);
export const workspaceSchema = z
  .strictObject({
    version: z.literal(1),
    assets: z.array(
      z.strictObject({
        id: z.uuid(),
        category: z.string(),
        title: z.string(),
        src: z.string().min(1),
      }),
    ),
    grid: z.strictObject({
      id: z.uuid(),
      name: z.string().max(70),
      publisher: z.enum(["none", "dc", "marvel"]),
      heading: z.string().max(120),
      headingVisible: z.boolean(),
      headingFont: z.enum(["Manrope", "Bangers", "Boogaloo", "Bebas Neue"]),
      cellFont: z.enum(["Manrope", "Bangers", "Boogaloo", "Bebas Neue"]),
      rows: z.number().int().min(1).max(gridLimit),
      columns: z.number().int().min(1).max(gridLimit),
      gap: z.number().min(0).max(40),
      background: z.string().regex(/^#[0-9a-f]{6}$/i),
      cells: z.array(cellSchema).max(gridLimit * gridLimit),
      overflow: z
        .array(
          z.strictObject({
            row: coordinate,
            column: coordinate,
            cell: cellSchema,
          }),
        )
        .max(gridLimit * gridLimit),
    }),
    exportSettings: z.strictObject({
      format: z.enum(["image/png", "image/jpeg", "image/webp"]),
      resolution: z.union([
        z.literal(150),
        z.literal(300),
        z.literal(600),
        z.literal(1200),
        z.literal(1800),
      ]),
      quality: z.number().int().min(50).max(100),
    }),
  })
  .superRefine(({ assets, grid }, context) => {
    const assetIds = new Set(assets.map((asset) => asset.id));
    const cells = [...grid.cells, ...grid.overflow.map((entry) => entry.cell)];
    const positions = grid.overflow.map(
      (entry) => `${entry.row}:${entry.column}`,
    );
    if (
      assetIds.size !== assets.length ||
      new Set(cells.map((cell) => cell.id)).size !== cells.length ||
      grid.cells.length !== grid.rows * grid.columns ||
      new Set(positions).size !== positions.length ||
      grid.overflow.some(
        (entry) => entry.row < grid.rows && entry.column < grid.columns,
      ) ||
      cells.some((cell) => cell.assetId !== null && !assetIds.has(cell.assetId))
    ) {
      context.addIssue({
        code: "custom",
        message: "Invalid grid cells or media references.",
      });
    }
  });

export function loadWorkspace(): Workspace {
  try {
    const parsed = workspaceSchema.safeParse(
      JSON.parse(localStorage.getItem(storageKey) ?? "null"),
    );
    return parsed.success ? parsed.data : makeWorkspace();
  } catch {
    return makeWorkspace();
  }
}
