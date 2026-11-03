import { useRef, useState } from "react";
import { AlertTriangle, Check, LoaderCircle, RefreshCw, Trash2, X } from "lucide-react";
import { FcGoogle } from "react-icons/fc";
import { FaDiscord, FaFacebook } from "react-icons/fa6";
import type { AuthProvider } from "@grids/contracts/cloud";
import { t } from "../i18n";
import { Button } from "./ui/controls";

export const providerNames = { google: "Google", facebook: "Facebook", discord: "Discord" };
const providerIcons = { google: FcGoogle, facebook: FaFacebook, discord: FaDiscord };
type Confirmation = { message: string; action: () => Promise<void>; destructive: boolean };

export function ProviderMark({ provider }: { provider: AuthProvider }) {
  const Icon = providerIcons[provider];
  return <Icon aria-hidden="true" className={`size-5 shrink-0 ${provider === "facebook" ? "text-[#1877f2]" : provider === "discord" ? "text-[#5865f2]" : ""}`} />;
}

export function useAccountActions() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const inFlight = useRef(false);
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
  return { busy, setBusy, error, setError, confirmation, setConfirmation, run, confirm };
}

export function AccountFeedback({ busy, error, onRetry }: { busy: boolean; error: string; onRetry: () => void }) {
  return <>
    {busy && <p role="status" className="flex items-center gap-2 text-sm text-(--muted)">
      <LoaderCircle aria-hidden="true" className="size-4 motion-safe:animate-spin" />{t("account.loading")}
    </p>}
    {error && <div role="alert" className="flex flex-col items-start gap-3 rounded-lg border border-solid border-red-400/40 bg-red-500/10 p-4">
      <p className="m-0 flex items-start gap-2 wrap-anywhere text-sm text-red-200">
        <AlertTriangle aria-hidden="true" className="size-5 shrink-0" />{error}
      </p>
      <Button disabled={busy} onClick={onRetry}><RefreshCw aria-hidden="true" />{t("account.retry")}</Button>
    </div>}
  </>;
}

export function AccountConfirmation({ actions }: { actions: ReturnType<typeof useAccountActions> }) {
  const confirmation = actions.confirmation;
  if (!confirmation) return null;
  return (
    <div className="flex flex-col items-start gap-4 rounded-xl border border-solid border-(--line) bg-(--bg) p-5" role="group" aria-label={confirmation.message}>
      <span className={`flex size-11 items-center justify-center rounded-full ${confirmation.destructive ? "bg-red-500/10 text-red-300" : "bg-(--selected) text-(--accent)"}`}>
        {confirmation.destructive ? <Trash2 aria-hidden="true" className="size-5" /> : <AlertTriangle aria-hidden="true" className="size-5" />}
      </span>
      <h3 className="m-0 text-base font-semibold">{t(confirmation.destructive ? "account.confirmDeleteTitle" : "account.confirmTitle")}</h3>
      <p className="m-0 text-sm leading-relaxed text-(--muted)">{confirmation.message}</p>
      <div className="flex w-full flex-wrap gap-2">
        <Button variant={confirmation.destructive ? "danger" : "primary"} disabled={actions.busy} onClick={() => {
          actions.setConfirmation(null);
          void actions.run(confirmation.action);
        }}>
          {confirmation.destructive ? <Trash2 aria-hidden="true" /> : <Check aria-hidden="true" />}
          {t("account.continue")}
        </Button>
        <Button autoFocus disabled={actions.busy} onClick={() => actions.setConfirmation(null)}>
          <X aria-hidden="true" />{t("common.actions.cancel")}
        </Button>
      </div>
    </div>
  );
}
