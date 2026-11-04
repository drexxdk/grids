import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { LayoutGrid, LoaderCircle, RefreshCw } from "lucide-react";
import { z } from "zod";
import { presetItemSchema, presetSummarySchema } from "@grids/contracts/cloud";
import type { AccountSession } from "../browser/account";
import { apiRequest } from "../browser/api";
import { type EditorSettings } from "../model";
import { presetSettingsForLayout, starterPresets, type PresetChoice } from "../presets";
import { t } from "../i18n";
import { Button } from "./ui/controls";

const listSchema = z.object({ items: z.array(presetSummarySchema), nextPage: z.number().nullable() });
type Summary = z.infer<typeof presetSummarySchema>;
type Collection = { items: Summary[]; nextPage: number | null };

export function PresetsPanel({ session, previewId, currentSettings, appliedPreset, disabled, onPreview }: {
  session: AccountSession | null;
  previewId?: string;
  currentSettings: EditorSettings;
  appliedPreset: Pick<PresetChoice, "id" | "settings" | "updatedAt"> | null;
  disabled: boolean;
  onPreview: (choice: PresetChoice) => void;
}) {
  const [collections, setCollections] = useState<{ own: Collection; shared: Collection }>({
    own: { items: [], nextPage: null }, shared: { items: [], nextPage: null },
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const [pending, setPending] = useState<string | null>(null);
  const detailRequest = useRef<AbortController | null>(null);
  const pageRequest = useRef<AbortController | null>(null);
  const details = useRef(new Map<string, EditorSettings>());
  const actions = useRef({ onPreview, disabled });
  useLayoutEffect(() => {
    actions.current = { onPreview, disabled };
  }, [onPreview, disabled]);
  useEffect(() => {
    const cancel = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      detailRequest.current?.abort();
      setPending(null);
    };
    window.addEventListener("keydown", cancel);
    return () => window.removeEventListener("keydown", cancel);
  }, []);
  const userId = session?.user?.id;
  useEffect(() => {
    const controller = new AbortController();
    pageRequest.current?.abort();
    detailRequest.current?.abort();
    details.current.clear();
    setPending(null);
    setError("");
    setLoading(true);
    setCollections({ own: { items: [], nextPage: null }, shared: { items: [], nextPage: null } });
    void Promise.allSettled([
      userId ? apiRequest("/presets", listSchema, { signal: controller.signal }) : Promise.resolve({ items: [], nextPage: null }),
      apiRequest("/presets?scope=public", listSchema, { signal: controller.signal }),
    ]).then(([own, shared]) => {
      if (controller.signal.aborted) return;
      setCollections({
        own: own.status === "fulfilled" ? own.value : { items: [], nextPage: null },
        shared: shared.status === "fulfilled" ? shared.value : { items: [], nextPage: null },
      });
      const failures = [own, shared].flatMap((result) => result.status === "rejected"
        ? [result.reason instanceof Error ? result.reason.message : t("account.offline")] : []);
      setError(failures.join(" "));
    }).finally(() => {
      if (!controller.signal.aborted) setLoading(false);
    });
    return () => {
      controller.abort();
      detailRequest.current?.abort();
      pageRequest.current?.abort();
    };
  }, [userId, revision]);

  async function more(kind: "own" | "shared") {
    const page = collections[kind].nextPage;
    if (page === null) return;
    pageRequest.current?.abort();
    const controller = new AbortController();
    pageRequest.current = controller;
    setLoading(true);
    setError("");
    try {
      const result = await apiRequest(`/presets?${kind === "shared" ? "scope=public&" : ""}page=${page}`, listSchema, { signal: controller.signal });
      if (!controller.signal.aborted) setCollections((previous) => ({
        ...previous, [kind]: {
          items: [...new Map([...previous[kind].items, ...result.items].map((item) => [item.id, item])).values()],
          nextPage: result.nextPage,
        },
      }));
    } catch (reason) {
      if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : t("account.offline"));
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }

  async function choose(choice: PresetChoice | Summary) {
    detailRequest.current?.abort();
    const controller = new AbortController();
    detailRequest.current = controller;
    setPending(choice.id);
    setError("");
    try {
      let resolved: PresetChoice;
      if ("settings" in choice) resolved = choice;
      else {
        const key = `${choice.id}:${choice.updatedAt}`;
        let settings = details.current.get(key);
        if (!settings) {
          settings = (await apiRequest(`/presets/${choice.id}`, presetItemSchema, { signal: controller.signal })).settings;
          details.current.set(key, settings);
        }
        resolved = { id: choice.id, name: choice.name, settings, updatedAt: choice.updatedAt };
      }
      if (controller.signal.aborted || actions.current.disabled) return;
      actions.current.onPreview(resolved);
    } catch (reason) {
      if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : t("account.offline"));
    } finally {
      if (!controller.signal.aborted) {
        setPending(null);
      }
    }
  }
  const currentSignature = JSON.stringify(currentSettings);
  const rows = (items: (PresetChoice | Summary)[]) => <ul className="m-0 grid list-none grid-cols-3 gap-2 p-0">
    {items.map((choice) => {
      const settings = "settings" in choice ? choice.settings : details.current.get(`${choice.id}:${choice.updatedAt}`) ??
        (appliedPreset?.id === choice.id && appliedPreset.updatedAt === choice.updatedAt ? appliedPreset.settings : undefined);
      const applied = settings !== undefined && JSON.stringify(presetSettingsForLayout(settings, currentSettings.layout)) === currentSignature;
      const metadata = applied ? t("presets.applied") : "settings" in choice ? null : t(choice.public ? "account.public" : "account.private");
      return <li key={choice.id} className="min-w-0">
      <button
        type="button" disabled={disabled}
        aria-label={t("presets.previewNamed", { name: choice.name })}
        title={applied ? t("presets.appliedNamed", { name: choice.name }) : choice.name}
        aria-pressed={previewId === choice.id}
        data-applied={applied ? "" : undefined}
        className="flex h-full min-h-34 w-full flex-col items-center justify-center gap-2 rounded-lg border border-solid border-(--line) bg-(--bg) p-2 text-center text-(--text) data-applied:border-(--accent) data-applied:bg-(--selected) enabled:hover:border-(--accent) focus-visible:outline-2 focus-visible:outline-(--accent) disabled:opacity-50"
        onClick={() => void choose(choice)}
      >
        <span className="flex size-10 shrink-0 items-center justify-center rounded-md border border-solid border-(--line)"
          style={"settings" in choice ? { background: choice.settings.style.background, color: choice.settings.style.headingTextColor ?? "#d8f36a" } : undefined}>
          {pending === choice.id ? <LoaderCircle aria-hidden="true" className="size-5 motion-safe:animate-spin" /> :
            <LayoutGrid aria-hidden="true" className="size-5" />}
        </span>
        <span className="min-w-0 w-full">
          <span className="flex min-h-8 items-center justify-center wrap-anywhere text-xs leading-4 font-semibold">{choice.name}</span>
          {metadata && <span className={`mt-1 block text-xs ${applied ? "text-(--accent)" : "text-(--muted)"}`}>
            {metadata}
          </span>}
        </span>
      </button>
    </li>;
    })}
  </ul>;
  return <section aria-label={t("presets.title")} className="flex min-w-0 flex-col gap-5 px-4 pb-6">
    <p className="m-0 text-xs leading-relaxed text-(--muted)">{t("presets.help")}</p>
    {error && <div role="alert" className="flex flex-col items-start gap-2 text-sm text-red-200">
      <span>{error}</span>
      <Button onClick={() => setRevision((value) => value + 1)}><RefreshCw aria-hidden="true" />{t("account.retry")}</Button>
    </div>}
    <section aria-label={t("presets.starters")} className="flex min-w-0 flex-col gap-2">
      <h3 className="field-label font-normal">{t("presets.starters")}</h3>
      {rows(starterPresets.map((preset) => ({ ...preset, name: t(`presets.names.${preset.nameKey}`) })))}
    </section>
    {(["own", "shared"] as const).map((kind) => (kind === "shared" || userId) && <section key={kind}
      aria-label={t(kind === "own" ? "account.myPresets" : "account.publicPresets")} className="flex min-w-0 flex-col gap-2">
      <h3 className="field-label font-normal">{t(kind === "own" ? "account.myPresets" : "account.publicPresets")}</h3>
      {rows(collections[kind].items)}
      {!loading && !collections[kind].items.length && <p className="m-0 text-xs text-(--muted)">{t("account.empty")}</p>}
      {collections[kind].nextPage !== null && <Button disabled={loading} onClick={() => void more(kind)}>{t("account.more")}</Button>}
    </section>)}
    {loading && <p role="status" className="m-0 text-sm text-(--muted)">{t("account.loading")}</p>}
  </section>;
}
