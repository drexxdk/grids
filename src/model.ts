import { z } from "zod";

export const fontOptions = ["Manrope", "Bangers", "Boogaloo", "Bebas Neue"];
export const gridLimit = 12;
export type Publisher = "none" | "dc" | "marvel";
export type TemplateName = "Clean" | "Editorial" | "Superhero" | "Custom";
export type ImageFormat = "image/png" | "image/jpeg" | "image/webp";
export interface Asset {
  id: string;
  category: string;
  title: string;
  src: string;
  source?: string;
  trashedAt?: number;
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
export interface GridLayout {
  rows: number;
  columns: number;
}
export interface GridStyle {
  template?: TemplateName;
  publisher: Publisher;
  headingVisible: boolean;
  headingFont: string;
  cellFont: string;
  gap: number;
  background: string;
}
export interface GridContent {
  id: string;
  name: string;
  heading: string;
  cells: Cell[];
  overflow: OverflowCell[];
}
export interface Board extends GridLayout, GridStyle, GridContent {}
export interface Workspace {
  version: 1;
  assets: Asset[];
  grid: Board;
  exportSettings: ExportSettings;
  themeSettings?: Partial<Record<TemplateName, GridStyle>>;
}
export interface ExportSettings {
  format: ImageFormat;
  resolution: number;
  quality: number;
}
export interface EditorSettings {
  version: 1;
  layout: GridLayout;
  style: GridStyle;
  exportSettings: ExportSettings;
  themeSettings?: Partial<Record<TemplateName, GridStyle>>;
}
export type GridPatch = Partial<
  GridStyle & Pick<GridContent, "name" | "heading">
>;
export type CellPatch = Partial<Pick<Cell, "title" | "fit">>;
export type DocumentCommand =
  | { type: "workspace/restore"; workspace: Workspace }
  | { type: "assets/trash-unused"; assetIds: string[]; trashedAt: number }
  | { type: "assets/restore"; assetIds: string[] }
  | { type: "assets/purge"; assetIds: string[] }
  | { type: "assets/delete"; assetIds: string[] }
  | { type: "grid/patch"; gridId: string; patch: GridPatch }
  | {
      type: "grid/template";
      gridId: string;
      template: TemplateName;
      previousTemplate: TemplateName;
      defaults: GridStyle;
    }
  | { type: "export/patch"; patch: Partial<ExportSettings> }
  | { type: "cell/patch"; gridId: string; cellId: string; patch: CellPatch }
  | { type: "cell/clear"; gridId: string; cellId: string }
  | { type: "cell/place"; gridId: string; cellId: string; assetId: string }
  | {
      type: "cell/swap";
      gridId: string;
      sourceCellId: string;
      targetCellId: string;
    }
  | {
      type: "cell/recover";
      gridId: string;
      cellId: string;
      overflowCellId: string;
    }
  | {
      type: "grid/resize";
      gridId: string;
      rows: number;
      columns: number;
      newCells: Cell[];
    }
  | { type: "grid/reset"; defaults: Workspace }
  | {
      type: "assets/import";
      gridId: string;
      cellId: string | null;
      assets: Asset[];
    }
  | { type: "grid/replace"; grid: Board; assets: Asset[] };
type CellFactory = (row: number, column: number) => Cell;
const clampGridSize = (value: number) =>
  Math.max(1, Math.min(gridLimit, Math.round(Number(value) || 1)));
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
  createCell: CellFactory = () => makeCell(),
): Board {
  rows = clampGridSize(rows);
  columns = clampGridSize(columns);
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
    const cell = positions.get(key)?.cell ?? createCell(row, column);
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

export function resetWorkspace(
  workspace: Workspace,
  defaults = makeWorkspace(),
): Workspace {
  const configured = applyEditorSettings(
    workspace,
    getEditorSettings(defaults),
    (row, column) => defaults.grid.cells[row * defaults.grid.columns + column],
  );
  return {
    ...configured,
    themeSettings: defaults.themeSettings,
    grid: {
      ...configured.grid,
      template: defaults.grid.template,
      name: defaults.grid.name,
      heading: defaults.grid.heading,
    },
  };
}

const layoutSchema = z.strictObject({
  rows: z.number().int().min(1).max(gridLimit),
  columns: z.number().int().min(1).max(gridLimit),
});
const styleSchema = z.strictObject({
  template: z.enum(["Clean", "Editorial", "Superhero", "Custom"]).optional(),
  publisher: z.enum(["none", "dc", "marvel"]),
  headingVisible: z.boolean(),
  headingFont: z.enum(["Manrope", "Bangers", "Boogaloo", "Bebas Neue"]),
  cellFont: z.enum(["Manrope", "Bangers", "Boogaloo", "Bebas Neue"]),
  gap: z.number().min(0).max(40),
  background: z.string().regex(/^#[0-9a-f]{6}$/i),
});
const exportSettingsSchema = z.strictObject({
  format: z.enum(["image/png", "image/jpeg", "image/webp"]),
  resolution: z.union([
    z.literal(150),
    z.literal(300),
    z.literal(600),
    z.literal(1200),
    z.literal(1800),
  ]),
  quality: z.number().int().min(50).max(100),
});
export const editorSettingsSchema = z.strictObject({
  version: z.literal(1),
  layout: layoutSchema,
  style: styleSchema,
  themeSettings: z
    .partialRecord(
      z.enum(["Clean", "Editorial", "Superhero", "Custom"]),
      styleSchema,
    )
    .optional(),
  exportSettings: exportSettingsSchema,
});

export function getEditorSettings(workspace: Workspace): EditorSettings {
  const { grid, exportSettings } = workspace;
  return editorSettingsSchema.parse({
    version: 1,
    ...(workspace.themeSettings
      ? { themeSettings: workspace.themeSettings }
      : {}),
    layout: { rows: grid.rows, columns: grid.columns },
    style: {
      ...(grid.template ? { template: grid.template } : {}),
      publisher: grid.publisher,
      headingVisible: grid.headingVisible,
      headingFont: grid.headingFont,
      cellFont: grid.cellFont,
      gap: grid.gap,
      background: grid.background,
    },
    exportSettings: {
      format: exportSettings.format,
      resolution: exportSettings.resolution,
      quality: exportSettings.quality,
    },
  });
}

export function applyEditorSettings(
  workspace: Workspace,
  input: unknown,
  createCell: CellFactory = () => makeCell(),
): Workspace {
  const settings = editorSettingsSchema.parse(input);
  return {
    ...workspace,
    themeSettings: settings.themeSettings,
    grid: {
      ...resizeBoard(
        workspace.grid,
        settings.layout.rows,
        settings.layout.columns,
        createCell,
      ),
      ...settings.style,
    },
    exportSettings: settings.exportSettings,
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
    themeSettings: editorSettingsSchema.shape.themeSettings,
    version: z.literal(1),
    assets: z.array(
      z.strictObject({
        id: z.uuid(),
        category: z.string(),
        title: z.string(),
        src: z.string().min(1),
        source: z.string().min(1).optional(),
        trashedAt: z.number().int().nonnegative().optional(),
      }),
    ),
    grid: z.strictObject({
      ...layoutSchema.shape,
      ...styleSchema.shape,
      id: z.uuid(),
      name: z.string().max(70),
      heading: z.string().max(120),
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
    exportSettings: exportSettingsSchema,
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
      cells.some(
        (cell) => cell.assetId !== null && !assetIds.has(cell.assetId),
      ) ||
      cells.some((cell) =>
        assets.some(
          (asset) => asset.id === cell.assetId && asset.trashedAt !== undefined,
        ),
      )
    ) {
      context.addIssue({
        code: "custom",
        message: "Invalid grid cells or media references.",
      });
    }
  });

export function createResizeCommand(
  gridId: string,
  rows: number,
  columns: number,
): DocumentCommand {
  rows = clampGridSize(rows);
  columns = clampGridSize(columns);
  return {
    type: "grid/resize",
    gridId,
    rows,
    columns,
    newCells: Array.from({ length: rows * columns }, () => makeCell()),
  };
}

export const createResetCommand = (): DocumentCommand => ({
  type: "grid/reset",
  defaults: makeWorkspace(),
});

function mergeAssets(existing: Asset[], incoming: Asset[]): Asset[] {
  const ids = new Set(existing.map((asset) => asset.id));
  const additions = incoming.filter((asset) => {
    if (ids.has(asset.id)) return false;
    ids.add(asset.id);
    return true;
  });
  return additions.length ? [...existing, ...additions] : existing;
}

export function referencedAssetIds(workspace: Workspace): Set<string> {
  return new Set(
    [
      ...workspace.grid.cells,
      ...workspace.grid.overflow.map((entry) => entry.cell),
    ].flatMap((cell) => (cell.assetId === null ? [] : [cell.assetId])),
  );
}

export function documentReducer(
  workspace: Workspace,
  command: DocumentCommand,
): Workspace {
  const grid = workspace.grid;
  if (
    "gridId" in command &&
    command.type !== "assets/import" &&
    command.gridId !== grid.id
  )
    return workspace;
  const withGrid = (updated: Board): Workspace => ({
    ...workspace,
    grid: updated,
  });
  const updateCell = (
    cellId: string,
    update: (cell: Cell) => Cell,
  ): Workspace => {
    if (!grid.cells.some((cell) => cell.id === cellId)) return workspace;
    return withGrid({
      ...grid,
      cells: grid.cells.map((cell) =>
        cell.id === cellId ? update(cell) : cell,
      ),
    });
  };
  switch (command.type) {
    case "assets/trash-unused": {
      const ids = new Set(command.assetIds);
      const referenced = referencedAssetIds(workspace);
      return {
        ...workspace,
        assets: workspace.assets.map((asset) =>
          ids.has(asset.id) &&
          asset.trashedAt === undefined &&
          !referenced.has(asset.id)
            ? { ...asset, trashedAt: command.trashedAt }
            : asset,
        ),
      };
    }
    case "assets/restore": {
      const ids = new Set(command.assetIds);
      return {
        ...workspace,
        assets: workspace.assets.map((asset) =>
          ids.has(asset.id) && asset.trashedAt !== undefined
            ? { ...asset, trashedAt: undefined }
            : asset,
        ),
      };
    }
    case "assets/purge": {
      const ids = new Set(command.assetIds);
      const referenced = referencedAssetIds(workspace);
      return {
        ...workspace,
        assets: workspace.assets.filter(
          (asset) =>
            !ids.has(asset.id) ||
            asset.trashedAt === undefined ||
            referenced.has(asset.id),
        ),
      };
    }
    case "assets/delete": {
      const ids = new Set(command.assetIds);
      if (!workspace.assets.some((asset) => ids.has(asset.id)))
        return workspace;
      const clearImage = (cell: Cell) =>
        cell.assetId && ids.has(cell.assetId)
          ? { ...cell, assetId: null }
          : cell;
      return {
        ...workspace,
        assets: workspace.assets.filter((asset) => !ids.has(asset.id)),
        grid: {
          ...grid,
          cells: grid.cells.map(clearImage),
          overflow: grid.overflow.map((entry) => ({
            ...entry,
            cell: clearImage(entry.cell),
          })),
        },
      };
    }
    case "workspace/restore":
      return command.workspace;
    case "grid/template": {
      if (grid.id !== command.gridId) return workspace;
      const previousTemplate = grid.template ?? command.previousTemplate;
      if (previousTemplate === command.template && grid.template)
        return workspace;
      const themeSettings = {
        ...workspace.themeSettings,
        [previousTemplate]: getEditorSettings(workspace).style,
      };
      const style = themeSettings[command.template] ?? command.defaults;
      return {
        ...workspace,
        themeSettings,
        grid: { ...grid, ...style, template: command.template },
      };
    }
    case "grid/patch":
      return withGrid({ ...grid, ...command.patch });
    case "export/patch":
      return {
        ...workspace,
        exportSettings: { ...workspace.exportSettings, ...command.patch },
      };
    case "cell/patch":
      return updateCell(command.cellId, (cell) => ({
        ...cell,
        ...command.patch,
      }));
    case "cell/clear":
      return updateCell(command.cellId, (cell) => ({
        ...cell,
        assetId: null,
        title: "",
        fit: "contain",
      }));
    case "cell/place": {
      const asset = workspace.assets.find(
        (asset) =>
          asset.id === command.assetId && asset.trashedAt === undefined,
      );
      return asset
        ? updateCell(command.cellId, (cell) => ({
            ...cell,
            assetId: asset.id,
            title: asset.title.slice(0, 120),
            fit: "contain",
          }))
        : workspace;
    }
    case "cell/swap": {
      const source = grid.cells.find(
        (cell) => cell.id === command.sourceCellId,
      );
      const target = grid.cells.find(
        (cell) => cell.id === command.targetCellId,
      );
      if (!source || !target || source === target) return workspace;
      return withGrid({
        ...grid,
        cells: grid.cells.map((cell) =>
          cell.id === source.id
            ? { ...target, id: source.id }
            : cell.id === target.id
              ? { ...source, id: target.id }
              : cell,
        ),
      });
    }
    case "cell/recover": {
      const target = grid.cells.find((cell) => cell.id === command.cellId);
      const archived = grid.overflow.find(
        (entry) => entry.cell.id === command.overflowCellId,
      );
      if (!target || !archived) return workspace;
      return withGrid({
        ...grid,
        cells: grid.cells.map((cell) =>
          cell.id === target.id ? { ...archived.cell, id: target.id } : cell,
        ),
        overflow: grid.overflow.map((entry) =>
          entry.cell.id === archived.cell.id
            ? { ...entry, cell: { ...target, id: archived.cell.id } }
            : entry,
        ),
      });
    }
    case "grid/resize":
      return withGrid(
        resizeBoard(
          grid,
          command.rows,
          command.columns,
          (row, column) => command.newCells[row * command.columns + column],
        ),
      );
    case "grid/reset":
      return resetWorkspace(workspace, command.defaults);
    case "assets/import": {
      const assets = mergeAssets(workspace.assets, command.assets);
      const destination =
        command.gridId === grid.id && command.cellId !== null
          ? grid.cells.findIndex((cell) => cell.id === command.cellId)
          : -1;
      if (destination < 0)
        return assets === workspace.assets
          ? workspace
          : { ...workspace, assets };
      return {
        ...workspace,
        assets,
        grid: {
          ...grid,
          cells: grid.cells.map((cell, index) => {
            const asset = command.assets[index - destination];
            return asset
              ? {
                  ...cell,
                  assetId: asset.id,
                  title: asset.title.slice(0, 120),
                  fit: "contain",
                }
              : cell;
          }),
        },
      };
    }
    case "grid/replace":
      return {
        ...workspace,
        assets: mergeAssets(workspace.assets, command.assets),
        grid: command.grid,
      };
    default: {
      const exhaustive: never = command;
      return exhaustive;
    }
  }
}
