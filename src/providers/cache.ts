import {
  QueryClient,
  QueryObserver,
  type QueryObserverResult,
} from "@tanstack/react-query";

export const providerFreshTime = 60 * 60 * 1000;
export const providerRetentionTime = 2 * providerFreshTime;
export const providerCacheLimit = 500;

export const providerQueryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: providerFreshTime,
      gcTime: providerRetentionTime,
      retry: false,
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
      networkMode: "always",
    },
  },
});

providerQueryClient.getQueryCache().subscribe((event) => {
  if (event.type !== "observerRemoved" && event.type !== "updated") return;
  const cache = providerQueryClient.getQueryCache();
  if (
    event.query.getObserversCount() === 0 &&
    event.query.state.status === "error"
  )
    cache.remove(event.query);
  const excess = cache.getAll().length - providerCacheLimit;
  if (excess <= 0) return;
  const inactive = cache
    .getAll()
    .filter(
      (query) =>
        query.getObserversCount() === 0 && query.state.fetchStatus === "idle",
    )
    .sort(
      (first, second) => first.state.dataUpdatedAt - second.state.dataUpdatedAt,
    );
  for (const query of inactive.slice(0, excess)) cache.remove(query);
});

export function providerQuery<Data>(
  key: readonly unknown[],
  load: (signal: AbortSignal) => Promise<Data>,
  signal: AbortSignal,
  freshness: (data: Data | undefined) => number = () => providerFreshTime,
): Promise<Data> {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const observer = new QueryObserver<Data>(providerQueryClient, {
      queryKey: key,
      queryFn: ({ signal }) => load(signal),
      staleTime: (query) => freshness(query.state.data),
    });
    let unsubscribe = () => {};
    let settled = false;
    const finish = (complete: () => void) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener("abort", abort);
      unsubscribe();
      complete();
    };
    const abort = () => finish(() => reject(signal.reason));
    const receive = (result: QueryObserverResult<Data>) => {
      if (result.isFetching) return;
      if (result.isSuccess) finish(() => resolve(structuredClone(result.data)));
      else if (result.isError) finish(() => reject(result.error));
    };
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) {
      abort();
      return;
    }
    unsubscribe = observer.subscribe(receive);
    if (settled) unsubscribe();
    else receive(observer.getCurrentResult());
  });
}
