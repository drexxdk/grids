import { useEffect, useRef, useState, type RefObject } from "react";
import { z } from "zod";
import { toast } from "sonner";
import {
  gridItemSchema,
  itemSummarySchema,
  presetItemSchema,
  presetSummarySchema,
  sessionSchema,
  fromSavedGrid,
  toSavedGrid,
} from "@grids/contracts/cloud";
import { applyEditorSettings, getEditorSettings, type Workspace } from "../model";
import { apiBase, apiRequest } from "../browser/api";
import { t } from "../i18n";
import { Modal } from "./ui/Modal";
import { Button } from "./ui/controls";

type GridSummary = z.infer<typeof itemSummarySchema>;
type PresetSummary = z.infer<typeof presetSummarySchema>;
const gridListSchema = z.object({ items: z.array(itemSummarySchema), nextPage: z.number().nullable() });
const presetListSchema = z.object({ items: z.array(presetSummarySchema), nextPage: z.number().nullable() });
type Confirmation = { message: string; action: () => Promise<void> };
const providerNames = { google: "Google", facebook: "Facebook", discord: "Discord" };

export function AccountDialog({
  open, onClose, returnFocus, workspace, onRestore,
}: {
  open: boolean;
  onClose: () => void;
  returnFocus: RefObject<HTMLButtonElement | null>;
  workspace: Workspace;
  onRestore: (workspace: Workspace) => void;
}) {
  const [session, setSession] = useState<z.infer<typeof sessionSchema> | null>(null);
  const [grids, setGrids] = useState<GridSummary[]>([]);
  const [presets, setPresets] = useState<PresetSummary[]>([]);
  const [shared, setShared] = useState<PresetSummary[]>([]);
  const [pages, setPages] = useState<{ grids: number | null; presets: number | null; shared: number | null }>({
    grids: null, presets: null, shared: null,
  });
  const [name, setName] = useState("");
  const [publish, setPublish] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const [refresh, setRefresh] = useState(0);
  const inFlight = useRef(false);
  const latestWorkspace = useRef(workspace);
  latestWorkspace.current = workspace;

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    setBusy(true);
    setError("");
    setConfirmation(null);
    setSession(null);
    setGrids([]);
    setPresets([]);
    setShared([]);
    void (async () => {
      const state = await apiRequest("/session", sessionSchema, { signal: controller.signal });
      const [gridPage, presetPage, sharedPage] = await Promise.all([
        state.user ? apiRequest("/grids", gridListSchema, { signal: controller.signal }) : null,
        state.user ? apiRequest("/presets", presetListSchema, { signal: controller.signal }) : null,
        apiRequest("/presets?scope=public", presetListSchema, { signal: controller.signal }),
      ]);
      if (controller.signal.aborted) return;
      setSession(state);
      setGrids(gridPage?.items ?? []);
      setPresets(presetPage?.items ?? []);
      setShared(sharedPage.items);
      setPages({ grids: gridPage?.nextPage ?? null, presets: presetPage?.nextPage ?? null, shared: sharedPage.nextPage });
    })().catch((reason: unknown) => {
      if (!controller.signal.aborted) {
        setError(reason instanceof Error ? reason.message : t("account.offline"));
      }
    }).finally(() => {
      if (!controller.signal.aborted) setBusy(false);
    });
    return () => controller.abort();
  }, [open, refresh]);

  async function run(action: () => Promise<void>) {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t("account.offline"));
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }
  function confirm(message: string, action: () => Promise<void>) {
    setConfirmation({ message, action });
  }
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
    onRestore(applyEditorSettings(latestWorkspace.current, saved.settings));
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
    <li key={item.id} className="flex flex-col gap-2 rounded-lg border border-solid border-(--line) p-3">
      <span className="wrap-anywhere font-semibold">{item.name}</span>
      <span className="text-sm text-(--muted)">{t(item.public ? "account.public" : "account.private")}</span>
      <div className="flex flex-wrap gap-2">
        <Button disabled={busy} onClick={() => confirm(t("account.confirmApply"), () => applyPreset(item))}>{t("account.apply")}</Button>
        {item.owned && <>
          <Button disabled={busy} onClick={() => void run(() => togglePublic(item))}>{t(item.public ? "account.makePrivate" : "account.makePublic")}</Button>
          <Button disabled={busy} onClick={() => confirm(t("account.confirmDelete"), () => deleteItem("presets", item.id))}>{t("account.delete")}</Button>
        </>}
      </div>
    </li>
  ));
  return (
    <Modal open={open} onClose={() => { if (!busy) onClose(); }} title={t("account.title")} returnFocus={returnFocus} size="wide">
      <div className="flex flex-col gap-5" aria-busy={busy}>
        <p className="m-0 text-sm text-(--muted)">{t("account.privacy")}</p>
        {busy && <p role="status">{t("account.loading")}</p>}
        {error && <div role="alert" className="flex flex-col gap-2">
          <p className="m-0">{error}</p>
          <Button disabled={busy} onClick={() => setRefresh((value) => value + 1)}>{t("account.retry")}</Button>
        </div>}
        {confirmation ? (
          <div className="flex flex-col gap-3" role="group" aria-label={confirmation.message}>
            <p>{confirmation.message}</p>
            <div className="flex flex-wrap gap-2">
              <Button disabled={busy} onClick={() => {
                const action = confirmation.action;
                setConfirmation(null);
                void run(action);
              }}>{t("account.continue")}</Button>
              <Button disabled={busy} onClick={() => setConfirmation(null)}>{t("common.actions.cancel")}</Button>
            </div>
          </div>
        ) : session && <>
          {session.user ? <>
            <p className="m-0">{t("account.signedIn", { value1: session.user.name, value2: providerNames[session.user.provider] })}</p>
            <div className="flex flex-wrap gap-2">
              <Button disabled={busy} onClick={() => void run(async () => {
                await apiRequest("/logout", z.undefined(), { method: "POST", body: {} });
                setRefresh((value) => value + 1);
              })}>{t("account.signOut")}</Button>
              <Button disabled={busy} onClick={() => confirm(t("account.confirmAccount"), async () => {
                await apiRequest("/account", z.undefined(), { method: "DELETE" });
                setRefresh((value) => value + 1);
              })}>{t("account.deleteAccount")}</Button>
            </div>
            <form className="flex flex-col gap-3" onSubmit={(event) => {
              event.preventDefault();
              void run(() => saveGrid());
            }}>
              <label className="flex flex-col gap-2" htmlFor="cloud-save-name">
                {t("account.name")}
                <input id="cloud-save-name" value={name} onChange={(event) => setName(event.target.value)} maxLength={70} required disabled={busy} />
              </label>
              <label className="flex items-start gap-2">
                <input type="checkbox" checked={publish} onChange={(event) => setPublish(event.target.checked)} disabled={busy} />
                {t("account.publish")}
              </label>
              <div className="flex flex-wrap gap-2">
                <Button type="submit" disabled={busy || !name.trim()}>{t("account.saveGrid")}</Button>
                <Button disabled={busy || !name.trim()} onClick={() => void run(async () => {
                  await apiRequest("/presets", presetItemSchema, {
                    method: "POST",
                    body: { name, public: publish, settings: getEditorSettings(latestWorkspace.current) },
                  });
                  toast.success(t("account.saved"));
                  setRefresh((value) => value + 1);
                })}>{t("account.savePreset")}</Button>
              </div>
            </form>
            <section aria-label={t("account.myGrids")}>
              <h3>{t("account.myGrids")}</h3>
              {!grids.length && <p>{t("account.empty")}</p>}
              <ul className="m-0 flex list-none flex-col gap-3 p-0">{grids.map((item) => (
                <li key={item.id} className="flex flex-col gap-2 rounded-lg border border-solid border-(--line) p-3">
                  <span className="wrap-anywhere font-semibold">{item.name}</span>
                  <div className="flex flex-wrap gap-2">
                    <Button disabled={busy} onClick={() => confirm(t("account.confirmLoad"), () => loadGrid(item))}>{t("account.load")}</Button>
                    <Button disabled={busy} onClick={() => confirm(t("account.confirmReplace"), () => saveGrid(item))}>{t("account.replace")}</Button>
                    <Button disabled={busy} onClick={() => confirm(t("account.confirmDelete"), () => deleteItem("grids", item.id))}>{t("account.delete")}</Button>
                  </div>
                </li>
              ))}</ul>
              {pages.grids !== null && <Button disabled={busy} onClick={() => void run(() => loadMore("grids"))}>{t("account.more")}</Button>}
            </section>
            <section aria-label={t("account.myPresets")}>
              <h3>{t("account.myPresets")}</h3>
              {!presets.length && <p>{t("account.empty")}</p>}
              <ul className="m-0 flex list-none flex-col gap-3 p-0">{presetRows(presets)}</ul>
              {pages.presets !== null && <Button disabled={busy} onClick={() => void run(() => loadMore("presets"))}>{t("account.more")}</Button>}
            </section>
          </> : <div className="flex flex-wrap gap-2">
            {session.providers.map((provider) => (
              <a key={provider} className="button secondary" href={`${apiBase}/auth/${provider}/start`}>
                {t("account.signIn", { value1: providerNames[provider] })}
              </a>
            ))}
            {!session.providers.length && <p>{t("account.noProviders")}</p>}
          </div>}
          <section aria-label={t("account.publicPresets")}>
            <h3>{t("account.publicPresets")}</h3>
            {!shared.length && <p>{t("account.empty")}</p>}
            <ul className="m-0 flex list-none flex-col gap-3 p-0">{presetRows(shared)}</ul>
            {pages.shared !== null && <Button disabled={busy} onClick={() => void run(() => loadMore("shared"))}>{t("account.more")}</Button>}
          </section>
          <Button disabled={busy} onClick={() => setRefresh((value) => value + 1)}>{t("account.refresh")}</Button>
        </>}
      </div>
    </Modal>
  );
}
