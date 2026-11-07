import { useEffect, useState, type RefObject } from "react";
import { z } from "zod";
import { toast } from "sonner";
import { Link2, Trash2, Unlink, UserRound, X } from "lucide-react";
import { authorizationSchema, type AuthProvider } from "@grids/contracts/cloud";
import type { AccountSession } from "../browser/account";
import { apiRequest } from "../browser/api";
import { t } from "../i18n";
import { Modal } from "./ui/Modal";
import { Button } from "./ui/controls";
import {
  AccountConfirmation, AccountConfirmationCard, AccountFeedback, ProviderTile, providerNames, useAccountActions,
} from "./AccountUi";

export function AccountDialog({
  open, onClose, onExited, returnFocus, session, loading, error: sessionError, onRefresh,
}: {
  open: boolean;
  onClose: () => void;
  onExited: () => void;
  returnFocus: RefObject<HTMLButtonElement | null>;
  session: AccountSession | null;
  loading: boolean;
  error: string;
  onRefresh: () => Promise<AccountSession>;
}) {
  const actions = useAccountActions();
  const { error, setError, confirmation, setConfirmation, run, confirm } = actions;
  const [connecting, setConnecting] = useState(false);
  const busy = actions.busy || connecting;
  const pendingMerge = session?.pendingMerge;
  const [disconnecting, setDisconnecting] = useState<AuthProvider | null>(null);
  const providers = session ? [...new Set([...session.providers, ...session.connections.map(({ provider }) => provider)])] : [];
  const canDisconnect = (provider: AuthProvider) => Boolean(session?.connections.some(
    (connection) => connection.provider !== provider && session.providers.includes(connection.provider),
  ));
  useEffect(() => {
    if (open) {
      setError("");
      setConfirmation(null);
      setDisconnecting(null);
      setConnecting(false);
    }
  }, [open]);
  useEffect(() => {
    const restored = (event: PageTransitionEvent) => {
      if (event.persisted) setConnecting(false);
    };
    window.addEventListener("pageshow", restored);
    return () => window.removeEventListener("pageshow", restored);
  }, []);
  useEffect(() => {
    if (disconnecting && (!session?.connections.some(({ provider }) => provider === disconnecting) || !canDisconnect(disconnecting))) {
      setDisconnecting(null);
    }
  }, [session, disconnecting]);
  return (
    <Modal open={open} ready={!loading} onClose={() => { if (!busy) onClose(); }} onExited={onExited} title={t("account.title")} returnFocus={returnFocus}>
      <div className="flex min-w-0 flex-col gap-5 data-connecting:[&_button:disabled]:opacity-100! [&_button]:min-h-11 [&_button]:text-sm" data-connecting={connecting || undefined} aria-busy={busy || loading}>
        <AccountFeedback busy={(busy || loading) && !connecting} error={error || sessionError} onRetry={() => void run(async () => { await onRefresh(); })} />
        {session?.user && <>
          <div role="group" aria-label={t("account.identityTitle")} className="flex min-w-0 items-center gap-3 rounded-xl border border-solid border-ui-border bg-ui-background p-4">
            <span className="flex size-11 shrink-0 items-center justify-center rounded-xl border border-solid border-ui-border bg-ui-panel">
              <UserRound aria-hidden="true" className="size-5" />
            </span>
            <div className="min-w-0">
              <p className="m-0 wrap-anywhere font-semibold">{session.user.name}</p>
              <p className="m-0 text-sm text-ui-muted">{t("account.identityTitle")}</p>
            </div>
          </div>
          {pendingMerge && <section className="flex flex-col items-start gap-3 rounded-xl border border-solid border-ui-accent bg-ui-background p-4" aria-label={t("account.mergeTitle")}>
            <h3 className="m-0 flex items-center gap-2 text-base font-semibold">
              <Link2 aria-hidden="true" className="size-5" />{t("account.mergeTitle")}
            </h3>
            <p className="m-0 wrap-anywhere text-sm leading-relaxed">{t("account.mergeDescription", {
              value1: pendingMerge.name,
              value2: pendingMerge.providers.map((provider) => providerNames[provider]).join(", "),
              value3: pendingMerge.grids,
              value4: pendingMerge.presets,
            })}</p>
            <p className="m-0 text-xs leading-relaxed text-ui-muted">{t("account.mergeHelp")}</p>
            <div className="flex flex-wrap gap-2">
              <Button intent="primary" disabled={busy || loading} onClick={() => void run(async () => {
                await apiRequest("/account/merge", z.undefined(), { method: "POST", body: { id: pendingMerge.id } });
                await onRefresh();
                toast.success(t("account.merged"));
              })}><Link2 aria-hidden="true" />{t("account.mergeConfirm")}</Button>
              <Button disabled={busy || loading} onClick={() => void run(async () => {
                await apiRequest(`/account/merge/${pendingMerge.id}`, z.undefined(), { method: "DELETE" });
                await onRefresh();
              })}><X aria-hidden="true" />{t("common.actions.cancel")}</Button>
            </div>
          </section>}
          <section className="flex min-w-0 flex-col gap-2 border-0" aria-label={t("account.providersTitle")}>
            <h3 className="field-label font-normal">{t("account.providersTitle")}</h3>
            <div className="grid auto-cols-fr grid-flow-col gap-0.5 min-[320px]:gap-2">
              {providers.map((provider) => {
                const connected = session.connections.some((connection) => connection.provider === provider);
                const removable = connected && canDisconnect(provider);
                const label = t(connected ? removable ? "account.disconnect" : "account.connected" : "account.connect", { value1: providerNames[provider] });
                return <ProviderTile key={provider} provider={provider} connected={connected} label={label}
                  disabled={busy || loading || (connected ? !removable : Boolean(pendingMerge))}
                  onClick={() => {
                    setConfirmation(null);
                    if (connected) {
                      setDisconnecting(provider);
                    } else {
                      setConnecting(true);
                      void run(async () => {
                        if (document.querySelector("#save-status")?.getAttribute("data-save-state") !== "saved") {
                          throw new Error(t("account.waitForSave"));
                        }
                        const result = await apiRequest(`/auth/${provider}/link`, authorizationSchema, { method: "POST", body: {} });
                        location.assign(result.url);
                      }).then((succeeded) => {
                        if (!succeeded) setConnecting(false);
                      });
                    }
                  }}
                />;
              })}
            </div>
            {disconnecting && <AccountConfirmationCard
              title={t("account.confirmDisconnectTitle", { value1: providerNames[disconnecting] })}
              message={t("account.confirmDisconnect", { value1: providerNames[disconnecting] })}
              icon={Unlink}
              destructive
            >
                <Button intent="danger" disabled={busy || loading} onClick={() => {
                  const provider = disconnecting;
                  void run(async () => {
                    await apiRequest(`/account/providers/${provider}`, z.undefined(), { method: "DELETE" });
                    setDisconnecting(null);
                    await onRefresh();
                    toast.success(t("account.providerDisconnected"));
                  });
                }}><Unlink aria-hidden="true" />{t("account.continue")}</Button>
                <Button disabled={busy || loading} onClick={() => setDisconnecting(null)}><X aria-hidden="true" />{t("common.actions.cancel")}</Button>
            </AccountConfirmationCard>}
          </section>
          <section className="flex flex-col items-start gap-3" aria-label={t("account.deleteTitle")}>
            <Button intent="danger" disabled={busy || loading} aria-expanded={Boolean(confirmation)} onClick={() => {
              setDisconnecting(null);
              confirm(t("account.confirmAccount"), async () => {
              await apiRequest("/account", z.undefined(), { method: "DELETE" });
              await onRefresh();
              }, true);
            }}><Trash2 aria-hidden="true" />{t("account.deleteAccount")}</Button>
            <AccountConfirmation actions={actions} />
          </section>
        </>}
      </div>
    </Modal>
  );
}
