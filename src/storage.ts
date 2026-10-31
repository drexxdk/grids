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
export const workspaceChannelName = "grids-workspace-v1";
export class LocalWorkspaceConflictError extends Error {
  constructor() {
    super(
      "Another tab changed the saved grid. Reload the saved grid before saving again.",
    );
    this.name = "LocalWorkspaceConflictError";
  }
}
const changeNotificationSchema = z.strictObject({
  id: z.literal("guest"),
  revision: z.uuid(),
});
export interface BrowserStorageStatus {
  usage: number | null;
  quota: number | null;
  persisted: boolean | null;
  canRequestPersistence: boolean;
}
export async function getBrowserStorageStatus(): Promise<BrowserStorageStatus> {
  const storage = navigator.storage;
  const [estimate, persisted] = await Promise.allSettled([
    Promise.resolve().then(() => storage?.estimate?.()),
    Promise.resolve().then(() => storage?.persisted?.()),
  ]);
  const capacity = estimate.status === "fulfilled" ? estimate.value : undefined;
  const validBytes = (value: number | undefined) =>
    typeof value === "number" && Number.isFinite(value) && value >= 0
      ? value
      : null;
  return {
    usage: validBytes(capacity?.usage),
    quota: validBytes(capacity?.quota),
    persisted:
      persisted.status === "fulfilled" && typeof persisted.value === "boolean"
        ? persisted.value
        : null,
    canRequestPersistence: typeof storage?.persist === "function",
  };
}
export async function requestPersistentStorage(): Promise<boolean | null> {
  try {
    const result = await navigator.storage?.persist?.();
    return typeof result === "boolean" ? result : null;
  } catch {
    return null;
  }
}
const localDocumentSchema = z.strictObject({
  id: z.literal("guest"),
  version: z.literal(1),
  revision: z.uuid(),
  grid: workspaceSchema.shape.grid,
  exportSettings: workspaceSchema.shape.exportSettings,
  themeSettings: workspaceSchema.shape.themeSettings,
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
  private readonly pendingDeletions = new Set<string>();
  private queue: Promise<void> = Promise.resolve();
  private disposed = false;
  private revision: string | null = null;
  private loaded = false;
  private savedSnapshot = false;
  private conflicted = false;
  private channel: BroadcastChannel | null = null;

  constructor(private readonly onConflict?: () => void) {
    this.db.version(1).stores({ documents: "id", images: "id" });
    this.documents = this.db.table("documents");
    this.images = this.db.table("images");
    try {
      this.channel = new BroadcastChannel(workspaceChannelName);
      this.channel.onmessage = (event: MessageEvent<unknown>) => {
        if (!changeNotificationSchema.safeParse(event.data).success) return;
        void this.checkForChanges().catch(() => undefined);
      };
    } catch {
      this.channel = null;
    }
  }

  private reportConflict() {
    if (this.conflicted || this.disposed) return;
    this.conflicted = true;
    this.onConflict?.();
  }

  checkForChanges(): Promise<boolean> {
    const task = this.queue
      .catch(() => undefined)
      .then(async () => {
        if (this.disposed || !this.loaded) return false;
        const stored = await this.documents.get("guest");
        if (this.disposed) return false;
        const changed = (stored?.revision ?? null) !== this.revision;
        if (changed) this.reportConflict();
        return changed;
      });
    this.queue = task.then(
      () => undefined,
      () => undefined,
    );
    return task;
  }

  private assertActive() {
    if (this.disposed) throw new Error("Local storage has been closed.");
  }

  get hasSavedSnapshot() {
    return this.savedSnapshot;
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
    const { stored, parsed, images } = await this.db.transaction(
      "r",
      this.documents,
      this.images,
      async () => {
        const stored = await this.documents.get("guest");
        const parsed = localDocumentSchema.safeParse(stored);
        const images = parsed.success
          ? await this.images.bulkGet(
              parsed.data.assets.map((asset) => asset.id),
            )
          : [];
        return { stored, parsed, images };
      },
    );
    this.assertActive();
    this.revision = stored?.revision ?? null;
    this.loaded = true;
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
    if (!parsed.success) return makeWorkspace();
    const document = parsed.data;
    const placeholder: Workspace = {
      version: 1,
      grid: document.grid,
      ...(document.themeSettings
        ? { themeSettings: document.themeSettings }
        : {}),
      exportSettings: document.exportSettings,
      assets: document.assets.map((asset) => ({ ...asset, src: "pending" })),
    };
    if (!workspaceSchema.safeParse(placeholder).success) return makeWorkspace();
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
    const workspace = workspaceSchema.parse({ ...placeholder, assets });
    this.savedSnapshot = true;
    return workspace;
  }

  save(workspace: Workspace): Promise<void> {
    const task = this.queue
      .catch(() => undefined)
      .then(() => this.persist(workspace));
    this.queue = task;
    return task;
  }

  scheduleImageDeletion(assetIds: string[]) {
    this.assertActive();
    assetIds.forEach((id) => this.pendingDeletions.add(id));
  }

  async usage(): Promise<{ count: number; bytes: number }> {
    this.assertActive();
    await this.queue.catch(() => undefined);
    const images = await this.images.toArray();
    this.assertActive();
    return {
      count: images.length,
      bytes: images.reduce(
        (total, image) =>
          total + (image.blob instanceof Blob ? image.blob.size : 0),
        0,
      ),
    };
  }

  private async persist(workspace: Workspace): Promise<void> {
    this.assertActive();
    workspaceSchema.parse(workspace);
    if (this.conflicted) throw new LocalWorkspaceConflictError();
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
      ...(workspace.themeSettings
        ? { themeSettings: workspace.themeSettings }
        : {}),
      revision: crypto.randomUUID(),
      grid: workspace.grid,
      exportSettings: workspace.exportSettings,
      assets: workspace.assets.map(
        ({ id, category, title, source, trashedAt, libraryHidden }) => ({
          id,
          category,
          title,
          ...(source ? { source } : {}),
          ...(trashedAt !== undefined ? { trashedAt } : {}),
          ...(libraryHidden ? { libraryHidden } : {}),
        }),
      ),
    });
    const settings = JSON.stringify(getEditorSettings(workspace));
    const retained = new Set(workspace.assets.map((asset) => asset.id));
    const deletions = [...this.pendingDeletions].filter(
      (id) => !retained.has(id),
    );
    this.assertActive();
    try {
      await this.db.transaction("rw", this.documents, this.images, async () => {
        const stored = await this.documents.get("guest");
        if ((stored?.revision ?? null) !== this.revision) {
          throw new LocalWorkspaceConflictError();
        }
        if (records.length) await this.images.bulkPut(records);
        if (deletions.length) await this.images.bulkDelete(deletions);
        await this.documents.put(document);
        localStorage.setItem(settingsKey, settings);
      });
    } catch (error) {
      if (error instanceof LocalWorkspaceConflictError) this.reportConflict();
      throw error;
    }
    this.revision = document.revision;
    this.loaded = true;
    this.savedSnapshot = true;
    records.forEach((record) => this.persistedImages.add(record.id));
    deletions.forEach((id) => {
      this.pendingDeletions.delete(id);
      this.persistedImages.delete(id);
      this.releaseAsset(id);
    });
    try {
      this.channel?.postMessage({ id: "guest", revision: document.revision });
    } catch {}
  }

  dispose() {
    this.disposed = true;
    this.channel?.close();
    for (const id of this.media.keys()) this.releaseAsset(id);
    this.db.close();
  }
}
