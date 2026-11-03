import { useEffect, type RefObject } from "react";
import { z } from "zod";
import { toast } from "sonner";
import { Link2, Trash2, Unlink, UserRound, X } from "lucide-react";
import { authorizationSchema, type AuthProvider } from "@grids/contracts/cloud";
import type { AccountSession } from "../browser/account";
import { apiRequest } from "../browser/api";
import { t } from "../i18n";
import { Modal } from "./ui/Modal";
import { Button } from "./ui/controls";
import { LegalLinks } from "./LegalLinks";
import {
  AccountConfirmation, AccountFeedback, ProviderMark, providerNames, useAccountActions,
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
  const { busy, error, setError, confirmation, setConfirmation, run, confirm } = actions;
  const pendingMerge = session?.pendingMerge;
  const canDisconnect = (provider: AuthProvider) => Boolean(session?.connections.some(
    (connection) => connection.provider !== provider && session.providers.includes(connection.provider),
  ));
  useEffect(() => {
    if (open) {
      setError("");
      setConfirmation(null);
    }
  }, [open]);
  return (
    <Modal open={open} ready={!loading} onClose={() => { if (!busy) onClose(); }} onExited={onExited} title={t("account.title")} returnFocus={returnFocus} size="wide">
      <div className="flex min-w-0 flex-col gap-5 [&_button]:min-h-11 [&_button]:text-sm" aria-busy={busy || loading}>
        <AccountFeedback busy={busy || loading} error={error || sessionError} onRetry={() => void run(async () => { await onRefresh(); })} />
        {confirmation ? <AccountConfirmation actions={actions} /> : session?.user && <>
          <div role="group" aria-label={t("account.identityTitle")} className="flex min-w-0 items-center gap-3 rounded-xl border border-solid border-(--line) bg-(--bg) p-4">
            <span className="flex size-11 shrink-0 items-center justify-center rounded-xl border border-solid border-(--line) bg-(--panel)">
              <UserRound aria-hidden="true" className="size-5" />
            </span>
            <div className="min-w-0">
              <p className="m-0 wrap-anywhere font-semibold">{session.user.name}</p>
              <p className="m-0 text-sm text-(--muted)">{t("account.identityTitle")}</p>
            </div>
          </div>
          {pendingMerge && <section className="flex flex-col items-start gap-3 rounded-xl border border-solid border-(--accent) bg-(--bg) p-4" aria-label={t("account.mergeTitle")}>
            <h3 className="m-0 flex items-center gap-2 text-base font-semibold">
              <Link2 aria-hidden="true" className="size-5" />{t("account.mergeTitle")}
            </h3>
            <p className="m-0 wrap-anywhere text-sm leading-relaxed">{t("account.mergeDescription", {
              value1: pendingMerge.name,
              value2: pendingMerge.providers.map((provider) => providerNames[provider]).join(", "),
              value3: pendingMerge.grids,
              value4: pendingMerge.presets,
            })}</p>
            <p className="m-0 text-xs leading-relaxed text-(--muted)">{t("account.mergeHelp")}</p>
            <div className="flex flex-wrap gap-2">
              <Button variant="primary" disabled={busy || loading} onClick={() => void run(async () => {
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
          <section className="flex min-w-0 flex-col gap-3 rounded-xl border border-solid border-(--line) p-4" aria-label={t("account.providersTitle")}>
            <h3 className="m-0 text-base font-semibold">{t("account.providersTitle")}</h3>
            <ul className="m-0 flex list-none flex-col gap-3 p-0">
              {session.connections.map((connection) => (
                <li key={connection.provider} className="flex min-w-0 flex-wrap items-center gap-3 rounded-lg bg-(--bg) p-3">
                  <ProviderMark provider={connection.provider} />
                  <div className="min-w-0 flex-1">
                    <p className="m-0 text-sm font-semibold">{providerNames[connection.provider]}</p>
                    <p className="m-0 wrap-anywhere text-xs text-(--muted)">{connection.name}</p>
                  </div>
                  {session.connections.length > 1 && <Button
                    variant="danger"
                    disabled={busy || loading || !canDisconnect(connection.provider)}
                    title={!canDisconnect(connection.provider) ? t("account.keepProvider") : undefined}
                    aria-label={t("account.disconnect", { value1: providerNames[connection.provider] })}
                    onClick={() => confirm(t("account.confirmDisconnect", { value1: providerNames[connection.provider] }), async () => {
                      await apiRequest(`/account/providers/${connection.provider}`, z.undefined(), { method: "DELETE" });
                      await onRefresh();
                      toast.success(t("account.providerDisconnected"));
                    }, true)}
                  ><Unlink aria-hidden="true" />{t("account.disconnectShort")}</Button>}
                </li>
              ))}
            </ul>
            <div className="flex flex-wrap gap-2">
              {session.providers.filter((provider) => !session.connections.some((connection) => connection.provider === provider)).map((provider) => (
                <Button key={provider} disabled={busy || loading || Boolean(pendingMerge)} onClick={() => confirm(
                  t("account.confirmConnect", { value1: providerNames[provider] }),
                  async () => {
                    if (document.querySelector("#save-status")?.getAttribute("data-save-state") !== "saved") {
                      throw new Error(t("account.waitForSave"));
                    }
                    const result = await apiRequest(`/auth/${provider}/link`, authorizationSchema, { method: "POST", body: {} });
                    location.assign(result.url);
                  },
                )}><ProviderMark provider={provider} />{t("account.connect", { value1: providerNames[provider] })}</Button>
              ))}
            </div>
          </section>
          <section className="flex flex-col items-start gap-3 rounded-xl border border-solid border-red-400/25 bg-red-500/5 p-4" aria-label={t("account.deleteTitle")}>
            <div>
              <h3 className="m-0 text-sm font-semibold text-red-300">{t("account.deleteTitle")}</h3>
              <p className="mt-1 mb-0 text-sm leading-relaxed text-(--muted)">{t("account.deleteDescription")}</p>
            </div>
            <Button variant="danger" disabled={busy || loading} onClick={() => confirm(t("account.confirmAccount"), async () => {
              await apiRequest("/account", z.undefined(), { method: "DELETE" });
              await onRefresh();
            }, true)}><Trash2 aria-hidden="true" />{t("account.deleteAccount")}</Button>
          </section>
        </>}
        <LegalLinks />
      </div>
    </Modal>
  );
}
