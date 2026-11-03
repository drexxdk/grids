import type { RefObject } from "react";
import { LogIn } from "lucide-react";
import { toast } from "sonner";
import type { AccountSession } from "../browser/account";
import { apiBase } from "../browser/api";
import { t } from "../i18n";
import { Modal } from "./ui/Modal";
import { AccountFeedback, ProviderMark, providerNames } from "./AccountUi";
import { LegalLinks } from "./LegalLinks";

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
        {!error && session && !session.user && <div className="flex flex-col gap-3">
          {session.providers.map((provider) => (
            <a key={provider}
              className="inline-flex min-h-12 items-center justify-center gap-3 rounded-lg border border-solid border-(--line) bg-(--bg) px-4 py-3 text-sm font-semibold text-(--text) no-underline hover:border-(--accent) focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--accent)"
              href={`${apiBase}/auth/${provider}/start`}
              onClick={(event) => {
                if (document.querySelector("#save-status")?.getAttribute("data-save-state") !== "saved") {
                  event.preventDefault();
                  toast.error(t("account.waitForSave"));
                }
              }}
            >
              <ProviderMark provider={provider} />{t("account.signIn", { value1: providerNames[provider] })}
            </a>
          ))}
          {!session.providers.length && <p className="m-0 flex items-start gap-2 text-sm text-(--muted)">
            <LogIn aria-hidden="true" className="size-5 shrink-0" />{t("account.noProviders")}
          </p>}
        </div>}
        <LegalLinks />
      </div>
    </Modal>
  );
}
