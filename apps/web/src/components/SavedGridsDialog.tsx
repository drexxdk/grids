import { useEffect, useRef, useState, type RefObject } from "react";
import { z } from "zod";
import { toast } from "sonner";
import {
  Check, ChevronDown, FolderOpen, Globe2, LayoutGrid,
  Lock, LogIn, Palette, Save, Trash2, Upload,
} from "lucide-react";
import {
  gridItemSchema,
  itemSummarySchema,
  presetItemSchema,
  presetSummarySchema,
  fromSavedGrid,
  toSavedGrid,
} from "@grids/contracts/cloud";
import { applyEditorSettings, getEditorSettings, imageLicenseSchema, type Workspace } from "../model";
import { presetSettingsForLayout } from "../presets";
import { apiRequest } from "../browser/api";
import type { AccountSession } from "../browser/account";
import { t } from "../i18n";
import { Modal } from "./ui/Modal";
import { Button } from "./ui/controls";
import { AccountConfirmation, AccountFeedback, useAccountActions } from "./AccountUi";

type GridSummary = z.infer<typeof itemSummarySchema>;
type PresetSummary = z.infer<typeof presetSummarySchema>;
const gridListSchema = z.object({ items: z.array(itemSummarySchema), nextPage: z.number().nullable() });
const presetListSchema = z.object({ items: z.array(presetSummarySchema), nextPage: z.number().nullable() });
export function SavedGridsDialog({
  open, onClose, onExited, returnFocus, workspace, onRestore, session, onLogin, loading, error: sessionError, onRefresh,
}: {
  open: boolean;
  onClose: () => void;
  onExited: () => void;
  returnFocus: RefObject<HTMLButtonElement | null>;
  workspace: Workspace;
  onRestore: (workspace: Workspace) => void;
  session: AccountSession | null;
  onLogin: () => void;
  loading: boolean;
  error: string;
  onRefresh: () => Promise<AccountSession>;
}) {
  const [grids, setGrids] = useState<GridSummary[]>([]);
  const [presets, setPresets] = useState<PresetSummary[]>([]);
  const [shared, setShared] = useState<PresetSummary[]>([]);
  const [pages, setPages] = useState<{ grids: number | null; presets: number | null; shared: number | null }>({
    grids: null, presets: null, shared: null,
  });
  const [name, setName] = useState("");
  const [publish, setPublish] = useState(false);
  const actions = useAccountActions();
  const { error, setError, confirmation, setConfirmation, run, confirm } = actions;
  const [fetching, setFetching] = useState(false);
  const busy = actions.busy || fetching;
  const [refresh, setRefresh] = useState(0);
  const latestWorkspace = useRef(workspace);
  latestWorkspace.current = workspace;

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    setFetching(true);
    setError("");
    setConfirmation(null);
    setGrids([]);
    setPresets([]);
    setShared([]);
    void (async () => {
      const [gridPage, presetPage, sharedPage] = await Promise.all([
        session?.user ? apiRequest("/grids", gridListSchema, { signal: controller.signal }) : null,
        session?.user ? apiRequest("/presets", presetListSchema, { signal: controller.signal }) : null,
        apiRequest("/presets?scope=public", presetListSchema, { signal: controller.signal }),
      ]);
      if (controller.signal.aborted) return;
      setGrids(gridPage?.items ?? []);
      setPresets(presetPage?.items ?? []);
      setShared(sharedPage.items);
      setPages({ grids: gridPage?.nextPage ?? null, presets: presetPage?.nextPage ?? null, shared: sharedPage.nextPage });
    })().catch((reason: unknown) => {
      if (!controller.signal.aborted) {
        setError(reason instanceof Error ? reason.message : t("account.offline"));
      }
    }).finally(() => {
      if (!controller.signal.aborted) setFetching(false);
    });
    return () => controller.abort();
  }, [open, refresh, session?.user?.id]);
  async function saveGrid(item?: GridSummary) {
    await apiRequest(`/grids${item ? `/${item.id}` : ""}`, gridItemSchema, {
      method: item ? "PUT" : "POST",
      version: item?.updatedAt,
      body: { name: item?.name ?? name, document: toSavedGrid(latestWorkspace.current) },
    });
    toast.success(t("account.saved"));
    setRefresh((value) => value + 1);
  }
  async function loadGrid(item: GridSummary) {
    const saved = await apiRequest(`/grids/${item.id}`, gridItemSchema);
    const current = latestWorkspace.current;
    const restored = fromSavedGrid(saved.document, current.assets);
    if (saved.document.assets.some((asset) => !imageLicenseSchema.safeParse(asset.provenance.license).success))
      toast.info(t("save.removedAttributed"));
    const restoredIds = new Set(restored.assets.map((asset) => asset.id));
    if (saved.document.localAssetIds.some((id) => !restoredIds.has(id))) {
      toast.warning(t("account.unavailableLocal"));
    }
    onRestore(restored);
    toast.success(t("account.loaded"));
    onClose();
  }
  async function applyPreset(item: PresetSummary) {
    const saved = await apiRequest(`/presets/${item.id}`, presetItemSchema);
    const current = latestWorkspace.current;
    onRestore(applyEditorSettings(current, presetSettingsForLayout(saved.settings, current.grid)));
    toast.success(t("account.applied"));
    onClose();
  }
  async function deleteItem(kind: "grids" | "presets", id: string) {
    await apiRequest(`/${kind}/${id}`, z.undefined(), { method: "DELETE" });
    toast.success(t("account.deleted"));
    setRefresh((value) => value + 1);
  }
  async function togglePublic(item: PresetSummary) {
    const saved = await apiRequest(`/presets/${item.id}`, presetItemSchema);
    await apiRequest(`/presets/${item.id}`, presetItemSchema, {
      method: "PUT", version: item.updatedAt,
      body: { name: saved.name, settings: saved.settings, public: !saved.public },
    });
    toast.success(t("account.visibilityUpdated"));
    setRefresh((value) => value + 1);
  }
  async function loadMore(kind: "grids" | "presets" | "shared") {
    const page = pages[kind];
    if (page === null) return;
    const path = kind === "shared" ? `/presets?scope=public&page=${page}` : `/${kind}?page=${page}`;
    if (kind === "grids") {
      const result = await apiRequest(path, gridListSchema);
      setGrids((items) => [...new Map([...items, ...result.items].map((item) => [item.id, item])).values()]);
      setPages((pages) => ({ ...pages, grids: result.nextPage }));
    } else {
      const result = await apiRequest(path, presetListSchema);
      const update = kind === "shared" ? setShared : setPresets;
      update((items) => [...new Map([...items, ...result.items].map((item) => [item.id, item])).values()]);
      setPages((pages) => ({ ...pages, [kind]: result.nextPage }));
    }
  }
  const presetRows = (items: PresetSummary[]) => items.map((item) => (
    <li key={item.id} className="flex min-w-0 flex-col gap-3 rounded-lg border border-solid border-ui-border bg-ui-background p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <span className="min-w-0 flex-1 wrap-anywhere font-semibold">{item.name}</span>
        <span className="inline-flex items-center gap-1 rounded-full bg-ui-selected px-2 py-1 text-xs text-ui-muted">
          {item.public ? <Globe2 aria-hidden="true" className="size-3" /> : <Lock aria-hidden="true" className="size-3" />}
          {t(item.public ? "account.public" : "account.private")}
        </span>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button disabled={busy} onClick={() => confirm(t("account.confirmApply"), () => applyPreset(item))}>
          <Check aria-hidden="true" />{t("account.apply")}
        </Button>
        {item.owned && <>
          <Button disabled={busy} onClick={() => void run(() => togglePublic(item))}>
            {item.public ? <Lock aria-hidden="true" /> : <Globe2 aria-hidden="true" />}
            {t(item.public ? "account.makePrivate" : "account.makePublic")}
          </Button>
          <Button intent="danger" disabled={busy} onClick={() => confirm(t("account.confirmDelete"), () => deleteItem("presets", item.id), true)}>
            <Trash2 aria-hidden="true" />{t("account.delete")}
          </Button>
        </>}
      </div>
    </li>
  ));
  return (
    <Modal open={open} ready={!loading && !fetching} onClose={() => { if (!actions.busy) onClose(); }} onExited={onExited} title={t("account.libraryTitle")} returnFocus={returnFocus} size="wide">
      <div className="flex min-w-0 flex-col gap-5 [&_button]:min-h-11 [&_button]:text-sm" aria-busy={busy}>
        <AccountFeedback busy={busy || loading} error={error || sessionError} onRetry={() => void run(async () => {
          await onRefresh();
          setRefresh((value) => value + 1);
        })} />
        {confirmation ? <AccountConfirmation actions={actions} /> : <>
          {session?.user ? <>
            <form className="flex min-w-0 flex-col gap-4 rounded-xl border border-solid border-ui-border p-4 sm:p-5" onSubmit={(event) => {
              event.preventDefault();
              void run(() => saveGrid());
            }}>
              <div className="flex items-start gap-3">
                <Save aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-ui-accent" />
                <div>
                  <h3 className="m-0 text-base font-semibold">{t("account.saveTitle")}</h3>
                  <p className="mt-1 mb-0 text-sm leading-relaxed text-ui-muted">{t("account.saveDescription")}</p>
                </div>
              </div>
              <div className="flex flex-col gap-2">
                <label className="text-sm font-semibold" htmlFor="cloud-save-name">{t("account.name")}</label>
                <input
                  id="cloud-save-name"
                  className="min-h-12 placeholder:text-ui-muted"
                  placeholder={t("account.namePlaceholder")}
                  aria-describedby="cloud-save-name-help"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  maxLength={70}
                  required
                  disabled={busy}
                />
                <p id="cloud-save-name-help" className="m-0 text-xs text-ui-muted">{t("account.nameHelp")}</p>
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                <Button intent="primary" type="submit" disabled={busy || !name.trim()}>
                  <Save aria-hidden="true" />{t("account.saveGrid")}
                </Button>
                <Button disabled={busy || !name.trim()} onClick={() => void run(async () => {
                  await apiRequest("/presets", presetItemSchema, {
                    method: "POST",
                    body: { name, public: publish, settings: getEditorSettings(latestWorkspace.current) },
                  });
                  toast.success(t("account.saved"));
                  setRefresh((value) => value + 1);
                })}><Palette aria-hidden="true" />{t("account.savePreset")}</Button>
              </div>
              <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-solid border-ui-border bg-ui-background p-3 text-sm leading-relaxed">
                <input
                  type="checkbox"
                  className="m-0 mt-1 size-4 shrink-0 accent-ui-accent"
                  checked={publish}
                  onChange={(event) => setPublish(event.target.checked)}
                  aria-describedby="cloud-publish-help"
                  disabled={busy}
                />
                <span>{t("account.publish")}</span>
              </label>
              <p id="cloud-publish-help" className="-mt-2 mb-0 text-xs leading-relaxed text-ui-muted">{t("account.publishHelp")}</p>
            </form>
            <div className="grid min-w-0 gap-5 md:grid-cols-2">
            <section className="flex min-w-0 flex-col gap-3" aria-label={t("account.myGrids")}>
              <h3 className="m-0 flex items-center gap-2 text-sm font-semibold">
                <LayoutGrid aria-hidden="true" className="size-4 text-ui-muted" />{t("account.myGrids")}
                <span aria-hidden="true" className="ml-auto rounded-full bg-ui-selected px-2 py-0.5 text-xs text-ui-muted">{grids.length}</span>
              </h3>
              {!grids.length && <p className="m-0 rounded-lg border border-dashed border-ui-border bg-ui-background p-5 text-sm text-ui-muted">{t("account.empty")}</p>}
              <ul className="m-0 flex list-none flex-col gap-3 p-0">{grids.map((item) => (
                <li key={item.id} className="flex min-w-0 flex-col gap-3 rounded-lg border border-solid border-ui-border bg-ui-background p-3">
                  <span className="wrap-anywhere font-semibold">{item.name}</span>
                  <div className="flex flex-wrap gap-2">
                    <Button disabled={busy} onClick={() => confirm(t("account.confirmLoad"), () => loadGrid(item))}>
                      <FolderOpen aria-hidden="true" />{t("account.load")}
                    </Button>
                    <Button disabled={busy} onClick={() => confirm(t("account.confirmReplace"), () => saveGrid(item))}>
                      <Upload aria-hidden="true" />{t("account.replace")}
                    </Button>
                    <Button intent="danger" disabled={busy} onClick={() => confirm(t("account.confirmDelete"), () => deleteItem("grids", item.id), true)}>
                      <Trash2 aria-hidden="true" />{t("account.delete")}
                    </Button>
                  </div>
                </li>
              ))}</ul>
              {pages.grids !== null && <Button disabled={busy} onClick={() => void run(() => loadMore("grids"))}>
                <ChevronDown aria-hidden="true" />{t("account.more")}
              </Button>}
            </section>
            <section className="flex min-w-0 flex-col gap-3" aria-label={t("account.myPresets")}>
              <h3 className="m-0 flex items-center gap-2 text-sm font-semibold">
                <Palette aria-hidden="true" className="size-4 text-ui-muted" />{t("account.myPresets")}
                <span aria-hidden="true" className="ml-auto rounded-full bg-ui-selected px-2 py-0.5 text-xs text-ui-muted">{presets.length}</span>
              </h3>
              {!presets.length && <p className="m-0 rounded-lg border border-dashed border-ui-border bg-ui-background p-5 text-sm text-ui-muted">{t("account.empty")}</p>}
              <ul className="m-0 flex list-none flex-col gap-3 p-0">{presetRows(presets)}</ul>
              {pages.presets !== null && <Button disabled={busy} onClick={() => void run(() => loadMore("presets"))}>
                <ChevronDown aria-hidden="true" />{t("account.more")}
              </Button>}
            </section>
            </div>
          </> : session && <section className="flex flex-col items-start gap-3 rounded-xl border border-solid border-ui-border bg-ui-background p-4">
            <p className="m-0 text-sm text-ui-muted">{t("account.libraryGuest")}</p>
            <Button onClick={onLogin}><LogIn aria-hidden="true" />{t("account.login")}</Button>
          </section>}
          <section className="flex min-w-0 flex-col gap-3" aria-label={t("account.publicPresets")}>
            <h3 className="m-0 flex items-center gap-2 text-sm font-semibold">
              <Globe2 aria-hidden="true" className="size-4 text-ui-muted" />{t("account.publicPresets")}
            </h3>
            {!shared.length && <p className="m-0 rounded-lg border border-dashed border-ui-border bg-ui-background p-5 text-sm text-ui-muted">{t("account.empty")}</p>}
            <ul className="m-0 flex list-none flex-col gap-3 p-0">{presetRows(shared)}</ul>
            {pages.shared !== null && <Button disabled={busy} onClick={() => void run(() => loadMore("shared"))}>
              <ChevronDown aria-hidden="true" />{t("account.more")}
            </Button>}
          </section>
        </>}
      </div>
    </Modal>
  );
}
