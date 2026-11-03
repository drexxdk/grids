import { z } from "zod";
import {
  editorSettingsSchema,
  provenanceSchema,
  workspaceSchema,
  type Cell,
  type Workspace,
} from "./model.js";

export const authProviderSchema = z.enum(["google", "facebook", "discord"]);
export type AuthProvider = z.infer<typeof authProviderSchema>;
export const userSchema = z.strictObject({
  id: z.uuid(),
  name: z.string().min(1).max(100),
  provider: authProviderSchema,
});
export const connectionSchema = z.strictObject({
  provider: authProviderSchema,
  name: z.string().min(1).max(100),
});
export const pendingMergeSchema = z.strictObject({
  id: z.uuid(),
  provider: authProviderSchema,
  name: z.string().min(1).max(100),
  providers: z.array(authProviderSchema),
  grids: z.number().int().nonnegative(),
  presets: z.number().int().nonnegative(),
});
export const sessionSchema = z.strictObject({
  user: userSchema.nullable(),
  providers: z.array(authProviderSchema),
  connections: z.array(connectionSchema),
  pendingMerge: pendingMergeSchema.nullable(),
});
export const authorizationSchema = z.strictObject({ url: z.url({ protocol: /^https$/ }) });

const referenceAssetSchema = z.strictObject({
  id: z.uuid(),
  title: z.string().max(1000),
  category: z.string().max(100),
  provenance: provenanceSchema,
  libraryHidden: z.boolean().optional(),
});

export const savedGridSchema = z.strictObject({
  version: z.literal(1),
  grid: workspaceSchema.shape.grid,
  exportSettings: workspaceSchema.shape.exportSettings,
  assets: z.array(referenceAssetSchema).max(500),
  localAssetIds: z.array(z.uuid()).max(500),
}).superRefine((document, context) => {
  const parsed = workspaceSchema.safeParse({
    version: document.version,
    grid: document.grid,
    exportSettings: document.exportSettings,
    assets: [
      ...document.assets.map((asset) => ({ ...asset, src: asset.provenance.originalUrl })),
      ...document.localAssetIds.map((id) => ({ id, title: "", category: "Imported", src: "local" })),
    ],
  });
  if (!parsed.success) {
    context.addIssue({ code: "custom", message: "Invalid grid or image references." });
  }
});
export type SavedGrid = z.infer<typeof savedGridSchema>;
export const itemNameSchema = z.string().trim().min(1).max(70);
export const gridWriteSchema = z.strictObject({
  name: itemNameSchema,
  document: savedGridSchema,
});
export const presetWriteSchema = z.strictObject({
  name: itemNameSchema,
  public: z.boolean(),
  settings: editorSettingsSchema,
});
export const itemSummarySchema = z.strictObject({
  id: z.uuid(),
  name: itemNameSchema,
  updatedAt: z.iso.datetime(),
});
export const gridItemSchema = itemSummarySchema.extend({
  document: savedGridSchema,
});
export const presetSummarySchema = itemSummarySchema.extend({
  public: z.boolean(),
  owned: z.boolean(),
});
export const presetItemSchema = presetSummarySchema.extend({
  settings: editorSettingsSchema,
});

export function toSavedGrid(workspace: Workspace): SavedGrid {
  const assets = workspace.assets
    .filter((asset) => asset.provenance && asset.trashedAt === undefined)
    .map((asset) => ({
      id: asset.id,
      title: asset.title.slice(0, 1000),
      category: asset.category.slice(0, 100),
      provenance: provenanceSchema.parse(asset.provenance),
      ...(asset.libraryHidden ? { libraryHidden: true } : {}),
    }));
  const localAssetIds = workspace.assets
    .filter((asset) => !asset.provenance && asset.trashedAt === undefined)
    .map((asset) => asset.id);
  const ids = new Set([...assets.map((asset) => asset.id), ...localAssetIds]);
  const cleanCell = (cell: Cell): Cell =>
    cell.assetId && !ids.has(cell.assetId)
      ? { ...cell, assetId: null, crop: undefined }
      : cell;
  return savedGridSchema.parse({
    version: 1,
    assets,
    localAssetIds,
    grid: {
      ...workspace.grid,
      cells: workspace.grid.cells.map(cleanCell),
      overflow: workspace.grid.overflow.map((entry) => ({
        ...entry,
        cell: cleanCell(entry.cell),
      })),
    },
    exportSettings: workspace.exportSettings,
  });
}

export function fromSavedGrid(input: unknown, localAssets: Workspace["assets"] = []): Workspace {
  const saved = savedGridSchema.parse(input);
  const cloudIds = new Set(saved.assets.map((asset) => asset.id));
  const local = localAssets.filter((asset) =>
    !asset.provenance && !cloudIds.has(asset.id) && asset.trashedAt === undefined);
  const availableIds = new Set([...cloudIds, ...local.map((asset) => asset.id)]);
  const restoreCell = (cell: Cell): Cell =>
    cell.assetId && !availableIds.has(cell.assetId)
      ? { ...cell, assetId: null, crop: undefined }
      : cell;
  return workspaceSchema.parse({
    version: saved.version,
    grid: {
      ...saved.grid,
      cells: saved.grid.cells.map(restoreCell),
      overflow: saved.grid.overflow.map((entry) => ({ ...entry, cell: restoreCell(entry.cell) })),
    },
    exportSettings: saved.exportSettings,
    assets: [
      ...saved.assets.map((asset) => ({
        ...asset,
        src: asset.provenance.originalUrl,
      })),
      ...local,
    ],
  });
}
