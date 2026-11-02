import { useSyncExternalStore, type SetStateAction } from "react";
import { z } from "zod";
import { imageProviders, type ImageProvider } from "../providers";

const sourceSchema = z
  .string()
  .refine(
    (value) =>
      value === "imported" ||
      imageProviders.some((provider) => provider.id === value),
  );
const offsetSchema = z.number().int().min(0).max(10000000);
const browsingSchema = z.object({
  query: z.string().max(160),
  selectedTopic: z.string().max(40).nullable(),
  request: z
    .object({
      query: z.string().max(160),
      offset: offsetSchema,
      topic: z.string().max(40).nullable().optional(),
    })
    .nullable(),
  history: z.array(offsetSchema).max(100),
});
const stateSchema = z.object({
  selectedPanel: z.number().int().min(0).max(1).default(0),
  sidebarOpen: z.boolean().default(true),
  librarySource: sourceSchema.default("imported"),
  pickerSource: sourceSchema.default("imported"),
  browsing: z.record(z.string().max(60), browsingSchema).default({}),
});
export type BrowsingState = z.infer<typeof browsingSchema>;
type EditorState = z.infer<typeof stateSchema>;
type HistoryMode = "push" | "replace" | "silent";
const storageKey = "grids-ui-v1";
const parameters = ["panel", "source", "q", "topic", "offset"];
const historySchema = z.object({
  gridsNavigation: z.object({ source: sourceSchema, browsing: browsingSchema }),
});

export function defaultBrowsing(provider: ImageProvider): BrowsingState {
  const topic = provider.browse[0];
  return {
    query: "",
    selectedTopic: topic?.id ?? null,
    request: { query: "", offset: 0, topic: topic?.id ?? null },
    history: [],
  };
}

export function parseEditorState(value: unknown): EditorState {
  const result = stateSchema.safeParse(value);
  const parsed = result.success ? result.data : stateSchema.parse({});
  return {
    ...parsed,
    browsing: Object.fromEntries(
      imageProviders.flatMap((provider) =>
        ["library", "picker"].map((scope) => {
          const key = `${scope}:${provider.id}`;
          return [key, parsed.browsing[key] ?? defaultBrowsing(provider)];
        }),
      ),
    ),
  };
}

export function readNavigation(
  state: EditorState,
  url: URL,
  initial = false,
  entry?: unknown,
): EditorState {
  if (initial && !parameters.some((key) => url.searchParams.has(key)))
    return state;
  const panel = url.searchParams.get("panel");
  const parsedSource = sourceSchema.safeParse(
    url.searchParams.get("source") ?? "imported",
  );
  const source = parsedSource.success ? parsedSource.data : "imported";
  const next = {
    ...state,
    selectedPanel: panel === "settings" ? (1 as const) : (0 as const),
    librarySource: source,
  };
  const provider = imageProviders.find((item) => item.id === source);
  if (!provider) return next;
  const fallback = defaultBrowsing(provider);
  const topic = provider.browse.find(
    (item) => item.id === url.searchParams.get("topic"),
  );
  const text = url.searchParams.get("q")?.trim().slice(0, 160);
  const offsetText = url.searchParams.get("offset") ?? "0";
  const parsedOffset = /^\d+$/.test(offsetText)
    ? offsetSchema.safeParse(Number(offsetText))
    : null;
  const offset = parsedOffset?.success ? parsedOffset.data : 0;
  const selectedTopic =
    topic?.id ??
    (text || url.searchParams.get("topic") === "all"
      ? null
      : fallback.selectedTopic);
  const request = { query: text ?? "", offset, topic: selectedTopic };
  const saved = state.browsing[`library:${source}`];
  const parsedEntry = historySchema.safeParse(entry);
  const visited =
    parsedEntry.success && parsedEntry.data.gridsNavigation.source === source
      ? parsedEntry.data.gridsNavigation.browsing
      : null;
  const history =
    visited?.request?.query === request?.query &&
    visited?.request?.topic === request.topic &&
    visited?.request?.offset === offset
      ? visited.history
      : saved?.request?.query === request?.query &&
          saved?.request?.topic === request.topic &&
          saved.request?.offset === offset
        ? saved.history
        : offset
          ? [0]
          : [];
  return {
    ...next,
    browsing: {
      ...state.browsing,
      [`library:${source}`]: {
        query: text ?? "",
        selectedTopic,
        request,
        history,
      },
    },
  };
}

export function navigationUrl(state: EditorState, current: URL): URL {
  const url = new URL(current);
  for (const key of parameters) url.searchParams.delete(key);
  url.searchParams.set(
    "panel",
    state.selectedPanel === 1 ? "settings" : "images",
  );
  url.searchParams.set("source", state.librarySource);
  const provider = imageProviders.find(
    (item) => item.id === state.librarySource,
  );
  if (provider) {
    const browse =
      state.browsing[`library:${provider.id}`] ?? defaultBrowsing(provider);
    const topic = provider.browse.find(
      (item) => item.id === browse.request?.topic,
    );
    if (topic) url.searchParams.set("topic", topic.id);
    else url.searchParams.set("topic", "all");
    if (browse.request?.query) url.searchParams.set("q", browse.request.query);
    if (browse.request?.offset)
      url.searchParams.set("offset", String(browse.request.offset));
  }
  return url;
}

let state: EditorState | undefined;
const listeners = new Set<() => void>();
let listening = false;
function snapshot(): EditorState {
  if (!state) {
    let saved: unknown;
    try {
      saved = JSON.parse(localStorage.getItem(storageKey) ?? "{}");
    } catch {}
    state = readNavigation(
      parseEditorState(saved),
      new URL(window.location.href),
      true,
    );
  }
  return state;
}
function persist() {
  try {
    localStorage.setItem(storageKey, JSON.stringify(snapshot()));
  } catch {}
}
function update(next: EditorState, mode: HistoryMode) {
  state = next;
  persist();
  if (mode !== "silent") {
    const url = navigationUrl(next, new URL(window.location.href));
    const entry = {
      gridsNavigation: {
        source: next.librarySource,
        browsing: next.browsing[`library:${next.librarySource}`],
      },
    };
    window.history[
      mode === "push" && url.href !== window.location.href
        ? "pushState"
        : "replaceState"
    ](entry, "", url);
  }
  for (const listener of listeners) listener();
}
function subscribe(listener: () => void) {
  listeners.add(listener);
  if (!listening) {
    listening = true;
    window.addEventListener("popstate", (event) =>
      update(
        readNavigation(
          snapshot(),
          new URL(window.location.href),
          false,
          event.state,
        ),
        "silent",
      ),
    );
    update(snapshot(), "replace");
  }
  return () => {
    listeners.delete(listener);
  };
}

export function useEditorState<Key extends keyof Omit<EditorState, "browsing">>(
  key: Key,
) {
  const current = useSyncExternalStore(subscribe, snapshot);
  const set = (value: SetStateAction<EditorState[Key]>) => {
    const previous = snapshot();
    const next = typeof value === "function" ? value(previous[key]) : value;
    update(
      { ...previous, [key]: next },
      key === "pickerSource" || key === "sidebarOpen" ? "silent" : "push",
    );
  };
  return [current[key], set] as const;
}

export function useBrowsingState(provider: ImageProvider, picker: boolean) {
  const current = useSyncExternalStore(subscribe, snapshot);
  const key = `${picker ? "picker" : "library"}:${provider.id}`;
  const browse = current.browsing[key] ?? defaultBrowsing(provider);
  const set = (
    value: SetStateAction<BrowsingState>,
    mode: HistoryMode = "push",
  ) => {
    const previous = snapshot();
    const before = previous.browsing[key] ?? defaultBrowsing(provider);
    const next = typeof value === "function" ? value(before) : value;
    update(
      {
        ...previous,
        browsing: {
          ...previous.browsing,
          [key]: { ...next, history: next.history.slice(-100) },
        },
      },
      picker ? "silent" : mode,
    );
  };
  return [browse, set] as const;
}
