import { useCallback, useEffect, useRef, useState } from "react";
import { sessionSchema } from "@grids/contracts/cloud";
import { z } from "zod";
import { apiRequest } from "./api";
import { t } from "../i18n";

export type AccountSession = z.infer<typeof sessionSchema>;

export function useAccountSession() {
  const [session, setSession] = useState<AccountSession | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const version = useRef(0);
  const refresh = useCallback(async (signal?: AbortSignal) => {
    const requestVersion = ++version.current;
    setLoading(true);
    setError("");
    try {
      const next = await apiRequest("/session", sessionSchema, { signal });
      if (requestVersion === version.current && !signal?.aborted) setSession(next);
      return next;
    } catch (reason) {
      if (requestVersion === version.current && !signal?.aborted) {
        setSession(null);
        setError(reason instanceof Error ? reason.message : t("account.offline"));
      }
      throw reason;
    } finally {
      if (requestVersion === version.current && !signal?.aborted) setLoading(false);
    }
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    const update = () => {
      if (document.visibilityState === "visible") void refresh(controller.signal).catch(() => undefined);
    };
    void refresh(controller.signal).catch(() => undefined);
    window.addEventListener("focus", update);
    document.addEventListener("visibilitychange", update);
    return () => {
      controller.abort();
      version.current++;
      window.removeEventListener("focus", update);
      document.removeEventListener("visibilitychange", update);
    };
  }, [refresh]);
  function signedOut() {
    version.current++;
    setSession((current) => current ? { ...current, user: null, connections: [], pendingMerge: null } : null);
    setLoading(false);
    setError("");
  }
  async function signOut() {
    await apiRequest("/logout", z.undefined(), { method: "POST", body: {} });
    signedOut();
  }
  return { session, loading, error, refresh, signOut };
}
