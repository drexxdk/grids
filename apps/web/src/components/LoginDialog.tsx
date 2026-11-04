import type { RefObject } from "react";
import { LogIn } from "lucide-react";
import { toast } from "sonner";
import type { AccountSession } from "../browser/account";
import { apiBase } from "../browser/api";
import { t } from "../i18n";
import { Modal } from "./ui/Modal";
import { AccountFeedback, ProviderTile, providerNames } from "./AccountUi";

export function LoginDialog({
  open, onClose, onExited, returnFocus, session, loading, error, onRetry,
}: {
  open: boolean;
  onClose: () => void;
  onExited: () => void;
  returnFocus: RefObject<HTMLButtonElement | null>;
  session: AccountSession | null;
  loading: boolean;
  error: string;
  onRetry: () => void;
}) {
  return (
    <Modal open={open} ready={!loading} onClose={onClose} onExited={onExited} title={t("account.login")} returnFocus={returnFocus}>
      <div className="flex min-w-0 flex-col gap-5">
        <p className="m-0 text-sm leading-relaxed text-(--muted)">{t("account.loginDescription")}</p>
        <AccountFeedback busy={loading} error={error} onRetry={onRetry} />
        {!error && session && !session.user && <div className="grid auto-cols-fr grid-flow-col gap-0.5 min-[320px]:gap-2">
          {session.providers.map((provider) => (
            <ProviderTile key={provider}
              provider={provider}
              label={t("account.signIn", { value1: providerNames[provider] })}
              href={`${apiBase}/auth/${provider}/start`}
              onClick={(event) => {
                if (document.querySelector("#save-status")?.getAttribute("data-save-state") !== "saved") {
                  event.preventDefault();
                  toast.error(t("account.waitForSave"));
                }
              }}
            />
          ))}
          {!session.providers.length && <p className="m-0 flex items-start gap-2 text-sm text-(--muted)">
            <LogIn aria-hidden="true" className="size-5 shrink-0" />{t("account.noProviders")}
          </p>}
        </div>}
      </div>
    </Modal>
  );
}
