import { useEffect, useRef, useState, type RefObject } from "react";
import { z } from "zod";
import { toast } from "sonner";
import {
  AlertTriangle, Check, ChevronDown, FolderOpen, Globe2, LayoutGrid,
  LoaderCircle, Lock, LogIn, LogOut, Palette, RefreshCw, Save,
  ShieldCheck, Trash2, Upload, X,
} from "lucide-react";
import { FcGoogle } from "react-icons/fc";
import { FaDiscord, FaFacebook } from "react-icons/fa6";
import {
  gridItemSchema,
  itemSummarySchema,
  presetItemSchema,
  presetSummarySchema,
  sessionSchema,
  fromSavedGrid,
  toSavedGrid,
  type AuthProvider,
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
type Confirmation = { message: string; action: () => Promise<void>; destructive: boolean };
const providerNames = { google: "Google", facebook: "Facebook", discord: "Discord" };
const providerIcons = { google: FcGoogle, facebook: FaFacebook, discord: FaDiscord };

function ProviderMark({ provider }: { provider: AuthProvider }) {
  const Icon = providerIcons[provider];
  return <Icon
    aria-hidden="true"
    className={`size-5 shrink-0 ${provider === "facebook" ? "text-[#1877f2]" : provider === "discord" ? "text-[#5865f2]" : ""}`}
  />;
}

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
  function confirm(message: string, action: () => Promise<void>, destructive = false) {
    setConfirmation({ message, action, destructive });
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
    <li key={item.id} className="flex min-w-0 flex-col gap-3 rounded-lg border border-solid border-(--line) bg-(--bg) p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <span className="min-w-0 flex-1 wrap-anywhere font-semibold">{item.name}</span>
        <span className="inline-flex items-center gap-1 rounded-full bg-(--selected) px-2 py-1 text-xs text-(--muted)">
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
          <Button variant="danger" disabled={busy} onClick={() => confirm(t("account.confirmDelete"), () => deleteItem("presets", item.id), true)}>
            <Trash2 aria-hidden="true" />{t("account.delete")}
          </Button>
        </>}
      </div>
    </li>
  ));
  return (
    <Modal open={open} onClose={() => { if (!busy) onClose(); }} title={t("account.title")} returnFocus={returnFocus} size="wide">
      <div className="flex min-w-0 flex-col gap-5 [&_button]:min-h-11 [&_button]:text-sm" aria-busy={busy}>
        {busy && <p role="status" className="flex items-center gap-2 text-sm text-(--muted)">
          <LoaderCircle aria-hidden="true" className="size-4 motion-safe:animate-spin" />{t("account.loading")}
        </p>}
        {error && <div role="alert" className="flex flex-col items-start gap-3 rounded-lg border border-solid border-red-400/40 bg-red-500/10 p-4">
          <p className="m-0 flex items-start gap-2 wrap-anywhere text-sm text-red-200">
            <AlertTriangle aria-hidden="true" className="size-5 shrink-0" />{error}
          </p>
          <Button disabled={busy} onClick={() => setRefresh((value) => value + 1)}>
            <RefreshCw aria-hidden="true" />{t("account.retry")}
          </Button>
        </div>}
        {confirmation ? (
          <div className="flex flex-col items-start gap-4 rounded-xl border border-solid border-(--line) bg-(--bg) p-5" role="group" aria-label={confirmation.message}>
            <span className={`flex size-11 items-center justify-center rounded-full ${confirmation.destructive ? "bg-red-500/10 text-red-300" : "bg-(--selected) text-(--accent)"}`}>
              {confirmation.destructive ? <Trash2 aria-hidden="true" className="size-5" /> : <AlertTriangle aria-hidden="true" className="size-5" />}
            </span>
            <h3 className="m-0 text-base font-semibold">{t(confirmation.destructive ? "account.confirmDeleteTitle" : "account.confirmTitle")}</h3>
            <p className="m-0 text-sm leading-relaxed text-(--muted)">{confirmation.message}</p>
            <div className="flex w-full flex-wrap gap-2">
              <Button variant={confirmation.destructive ? "danger" : "primary"} disabled={busy} onClick={() => {
                const action = confirmation.action;
                setConfirmation(null);
                void run(action);
              }}>
                {confirmation.destructive ? <Trash2 aria-hidden="true" /> : <Check aria-hidden="true" />}
                {t("account.continue")}
              </Button>
              <Button autoFocus disabled={busy} onClick={() => setConfirmation(null)}>
                <X aria-hidden="true" />{t("common.actions.cancel")}
              </Button>
            </div>
          </div>
        ) : session && <>
          {session.user ? <>
            <div className="flex flex-col gap-3 rounded-xl border border-solid border-(--line) bg-(--bg) p-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex min-w-0 flex-1 items-center gap-3">
                <span className="flex size-11 shrink-0 items-center justify-center rounded-xl border border-solid border-(--line) bg-(--panel)">
                  <ProviderMark provider={session.user.provider} />
                </span>
                <div className="min-w-0">
                  <p className="m-0 wrap-anywhere font-semibold">{session.user.name}</p>
                  <p className="m-0 text-sm text-(--muted)">{t("account.connectedWith", { value1: providerNames[session.user.provider] })}</p>
                </div>
              </div>
              <Button className="self-start sm:self-auto" disabled={busy} onClick={() => void run(async () => {
                await apiRequest("/logout", z.undefined(), { method: "POST", body: {} });
                setRefresh((value) => value + 1);
              })}><LogOut aria-hidden="true" />{t("account.signOut")}</Button>
            </div>
            <form className="flex min-w-0 flex-col gap-4 rounded-xl border border-solid border-(--line) p-4 sm:p-5" onSubmit={(event) => {
              event.preventDefault();
              void run(() => saveGrid());
            }}>
              <div className="flex items-start gap-3">
                <Save aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-(--accent)" />
                <div>
                  <h3 className="m-0 text-base font-semibold">{t("account.saveTitle")}</h3>
                  <p className="mt-1 mb-0 text-sm leading-relaxed text-(--muted)">{t("account.saveDescription")}</p>
                </div>
              </div>
              <div className="flex flex-col gap-2">
                <label className="text-sm font-semibold" htmlFor="cloud-save-name">{t("account.name")}</label>
                <input
                  id="cloud-save-name"
                  className="min-h-12 placeholder:text-(--muted)"
                  placeholder={t("account.namePlaceholder")}
                  aria-describedby="cloud-save-name-help"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  maxLength={70}
                  required
                  disabled={busy}
                />
                <p id="cloud-save-name-help" className="m-0 text-xs text-(--muted)">{t("account.nameHelp")}</p>
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                <Button variant="primary" type="submit" disabled={busy || !name.trim()}>
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
              <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-solid border-(--line) bg-(--bg) p-3 text-sm leading-relaxed">
                <input
                  type="checkbox"
                  className="m-0 mt-1 size-4 shrink-0 accent-(--accent)"
                  checked={publish}
                  onChange={(event) => setPublish(event.target.checked)}
                  aria-describedby="cloud-publish-help"
                  disabled={busy}
                />
                <span>{t("account.publish")}</span>
              </label>
              <p id="cloud-publish-help" className="-mt-2 mb-0 text-xs leading-relaxed text-(--muted)">{t("account.publishHelp")}</p>
            </form>
            <div className="grid min-w-0 gap-5 md:grid-cols-2">
            <section className="flex min-w-0 flex-col gap-3" aria-label={t("account.myGrids")}>
              <h3 className="m-0 flex items-center gap-2 text-sm font-semibold">
                <LayoutGrid aria-hidden="true" className="size-4 text-(--muted)" />{t("account.myGrids")}
                <span aria-hidden="true" className="ml-auto rounded-full bg-(--selected) px-2 py-0.5 text-xs text-(--muted)">{grids.length}</span>
              </h3>
              {!grids.length && <p className="m-0 rounded-lg border border-dashed border-(--line) bg-(--bg) p-5 text-sm text-(--muted)">{t("account.empty")}</p>}
              <ul className="m-0 flex list-none flex-col gap-3 p-0">{grids.map((item) => (
                <li key={item.id} className="flex min-w-0 flex-col gap-3 rounded-lg border border-solid border-(--line) bg-(--bg) p-3">
                  <span className="wrap-anywhere font-semibold">{item.name}</span>
                  <div className="flex flex-wrap gap-2">
                    <Button disabled={busy} onClick={() => confirm(t("account.confirmLoad"), () => loadGrid(item))}>
                      <FolderOpen aria-hidden="true" />{t("account.load")}
                    </Button>
                    <Button disabled={busy} onClick={() => confirm(t("account.confirmReplace"), () => saveGrid(item))}>
                      <Upload aria-hidden="true" />{t("account.replace")}
                    </Button>
                    <Button variant="danger" disabled={busy} onClick={() => confirm(t("account.confirmDelete"), () => deleteItem("grids", item.id), true)}>
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
                <Palette aria-hidden="true" className="size-4 text-(--muted)" />{t("account.myPresets")}
                <span aria-hidden="true" className="ml-auto rounded-full bg-(--selected) px-2 py-0.5 text-xs text-(--muted)">{presets.length}</span>
              </h3>
              {!presets.length && <p className="m-0 rounded-lg border border-dashed border-(--line) bg-(--bg) p-5 text-sm text-(--muted)">{t("account.empty")}</p>}
              <ul className="m-0 flex list-none flex-col gap-3 p-0">{presetRows(presets)}</ul>
              {pages.presets !== null && <Button disabled={busy} onClick={() => void run(() => loadMore("presets"))}>
                <ChevronDown aria-hidden="true" />{t("account.more")}
              </Button>}
            </section>
            </div>
          </> : <section className="flex flex-col gap-4 rounded-xl border border-solid border-(--line) bg-(--bg) p-4 sm:p-5">
            <div className="flex items-start gap-3">
              <LogIn aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-(--accent)" />
              <div>
                <h3 className="m-0 text-base font-semibold">{t("account.signInTitle")}</h3>
                <p className="mt-1 mb-0 text-sm leading-relaxed text-(--muted)">{t("account.signInDescription")}</p>
              </div>
            </div>
            <div className="grid gap-2 sm:grid-cols-3">
              {session.providers.map((provider) => (
                <a
                  key={provider}
                  className="inline-flex min-h-12 items-center justify-center gap-2 rounded-lg border border-solid border-(--line) bg-(--panel) px-3 py-3 text-center text-sm font-semibold text-(--text) no-underline transition-colors hover:border-(--accent) focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--accent)"
                  href={`${apiBase}/auth/${provider}/start`}
                >
                  <ProviderMark provider={provider} />
                  {t("account.signIn", { value1: providerNames[provider] })}
                </a>
              ))}
            </div>
            {!session.providers.length && <p className="m-0 text-sm text-(--muted)">{t("account.noProviders")}</p>}
          </section>}
          <section className="flex min-w-0 flex-col gap-3" aria-label={t("account.publicPresets")}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="m-0 flex items-center gap-2 text-sm font-semibold">
                <Globe2 aria-hidden="true" className="size-4 text-(--muted)" />{t("account.publicPresets")}
              </h3>
              <Button disabled={busy} onClick={() => setRefresh((value) => value + 1)}>
                <RefreshCw aria-hidden="true" />{t("account.refresh")}
              </Button>
            </div>
            {!shared.length && <p className="m-0 rounded-lg border border-dashed border-(--line) bg-(--bg) p-5 text-sm text-(--muted)">{t("account.empty")}</p>}
            <ul className="m-0 flex list-none flex-col gap-3 p-0">{presetRows(shared)}</ul>
            {pages.shared !== null && <Button disabled={busy} onClick={() => void run(() => loadMore("shared"))}>
              <ChevronDown aria-hidden="true" />{t("account.more")}
            </Button>}
          </section>
          {session.user && <section className="flex flex-col items-start gap-3 rounded-xl border border-solid border-red-400/25 bg-red-500/5 p-4" aria-label={t("account.deleteTitle")}>
            <div>
              <h3 className="m-0 text-sm font-semibold text-red-300">{t("account.deleteTitle")}</h3>
              <p className="mt-1 mb-0 text-sm leading-relaxed text-(--muted)">{t("account.deleteDescription")}</p>
            </div>
            <Button variant="danger" disabled={busy} onClick={() => confirm(t("account.confirmAccount"), async () => {
              await apiRequest("/account", z.undefined(), { method: "DELETE" });
              setRefresh((value) => value + 1);
            }, true)}><Trash2 aria-hidden="true" />{t("account.deleteAccount")}</Button>
          </section>}
        </>}
        <aside className="flex items-start gap-3 border-0 border-t border-solid border-(--line) pt-4">
          <ShieldCheck aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-(--mint)" />
          <div>
            <p className="m-0 text-xs font-semibold">{t("account.privacyTitle")}</p>
            <p className="mt-1 mb-0 text-xs leading-relaxed text-(--muted)">{t("account.privacy")}</p>
          </div>
        </aside>
      </div>
    </Modal>
  );
}
