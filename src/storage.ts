import Dexie, { type Table } from "dexie";
import { z } from "zod";
import {
  applyEditorSettings,
  editorSettingsSchema,
  getEditorSettings,
  makeWorkspace,
  workspaceSchema,
  type Asset,
  type Workspace,
} from "./model";

export const databaseName = "grids-client-v1";
export const settingsKey = "grids-settings-v1";
const localDocumentSchema = z.strictObject({
  id: z.literal("guest"),
  version: z.literal(1),
  grid: workspaceSchema.shape.grid,
  exportSettings: workspaceSchema.shape.exportSettings,
  assets: z.array(workspaceSchema.shape.assets.element.omit({ src: true })),
});
type LocalDocument = z.infer<typeof localDocumentSchema>;
interface ImageRecord {
  id: string;
  blob: Blob;
}

export class LocalWorkspaceStore {
  private readonly db = new Dexie(databaseName);
  private readonly documents: Table<LocalDocument, string>;
  private readonly images: Table<ImageRecord, string>;
  private readonly media = new Map<
    string,
    { blob: Blob; url: string | null }
  >();
  private readonly persistedImages = new Set<string>();
  private queue: Promise<void> = Promise.resolve();
  private disposed = false;

  constructor() {
    this.db.version(1).stores({ documents: "id", images: "id" });
    this.documents = this.db.table("documents");
    this.images = this.db.table("images");
  }

  private assertActive() {
    if (this.disposed) throw new Error("Local storage has been closed.");
  }

  createAsset(blob: Blob, title: string, category = "Imported"): Asset {
    this.assertActive();
    const id = crypto.randomUUID();
    const src = URL.createObjectURL(blob);
    this.media.set(id, { blob, url: src });
    return { id, category, title, src };
  }

  releaseAsset(id: string) {
    const entry = this.media.get(id);
    if (entry?.url) URL.revokeObjectURL(entry.url);
    this.media.delete(id);
  }

  async load(): Promise<Workspace> {
    this.assertActive();
    const stored = await this.documents.get("guest");
    this.assertActive();
    if (!stored) {
      const defaults = makeWorkspace();
      try {
        const settings = editorSettingsSchema.parse(
          JSON.parse(localStorage.getItem(settingsKey) ?? "null"),
        );
        return applyEditorSettings(defaults, settings);
      } catch {
        return defaults;
      }
    }
    const parsed = localDocumentSchema.safeParse(stored);
    if (!parsed.success) return makeWorkspace();
    const document = parsed.data;
    const placeholder: Workspace = {
      version: 1,
      grid: document.grid,
      exportSettings: document.exportSettings,
      assets: document.assets.map((asset) => ({ ...asset, src: "pending" })),
    };
    if (!workspaceSchema.safeParse(placeholder).success) return makeWorkspace();
    const images = await this.images.bulkGet(
      document.assets.map((asset) => asset.id),
    );
    this.assertActive();
    if (images.some((image) => !(image?.blob instanceof Blob))) {
      throw new Error(
        "A saved image is missing. The stored grid has not been replaced.",
      );
    }
    const assets = document.assets.map((asset, index) => {
      const blob = images[index]!.blob;
      const existing = this.media.get(asset.id);
      const src = existing?.url ?? URL.createObjectURL(blob);
      this.media.set(asset.id, { blob, url: src });
      this.persistedImages.add(asset.id);
      return { ...asset, src };
    });
    return workspaceSchema.parse({ ...placeholder, assets });
  }

  save(workspace: Workspace): Promise<void> {
    const task = this.queue
      .catch(() => undefined)
      .then(() => this.persist(workspace));
    this.queue = task;
    return task;
  }

  private async persist(workspace: Workspace): Promise<void> {
    this.assertActive();
    workspaceSchema.parse(workspace);
    const records: ImageRecord[] = [];
    for (const asset of workspace.assets) {
      if (this.persistedImages.has(asset.id)) continue;
      let entry = this.media.get(asset.id);
      if (!entry) {
        const response = await fetch(asset.src);
        if (!response.ok) throw new Error(`Could not store ${asset.title}.`);
        const blob = await response.blob();
        this.assertActive();
        entry = { blob, url: null };
        this.media.set(asset.id, entry);
      }
      records.push({ id: asset.id, blob: entry.blob });
    }
    const document = localDocumentSchema.parse({
      id: "guest",
      version: workspace.version,
      grid: workspace.grid,
      exportSettings: workspace.exportSettings,
      assets: workspace.assets.map(({ id, category, title, source }) => ({
        id,
        category,
        title,
        ...(source ? { source } : {}),
      })),
    });
    const settings = JSON.stringify(getEditorSettings(workspace));
    this.assertActive();
    await this.db.transaction("rw", this.documents, this.images, async () => {
      if (records.length) await this.images.bulkPut(records);
      await this.documents.put(document);
      localStorage.setItem(settingsKey, settings);
    });
    records.forEach((record) => this.persistedImages.add(record.id));
  }

  dispose() {
    this.disposed = true;
    for (const id of this.media.keys()) this.releaseAsset(id);
    this.db.close();
  }
}
