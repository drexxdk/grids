import type { RefObject } from "react";
import { AlertTriangle, LoaderCircle, LogIn, LogOut, UserRound } from "lucide-react";
import type { AccountSession } from "../browser/account";
import { t } from "../i18n";
import { ActionMenu, Button } from "./ui/controls";

export function AccountHeader({
  session, loading, error, busy, disabled, buttonRef, onLogin, onAccount, onSignOut,
}: {
  session: AccountSession | null;
  loading: boolean;
  error: string;
  busy: boolean;
  disabled: boolean;
  buttonRef: RefObject<HTMLButtonElement | null>;
  onLogin: () => void;
  onAccount: () => void;
  onSignOut: () => void;
}) {
  if (session?.user && !error) {
    return <ActionMenu buttonRef={buttonRef} label={t("account.menu")} icon={UserRound} disabled={disabled || busy}
      actions={[
        { label: t("account.title"), icon: UserRound, onSelect: onAccount },
        { label: t("account.signOut"), icon: LogOut, onSelect: onSignOut, disabled: busy },
      ]}
    />;
  }
  return (
    <Button ref={buttonRef} variant={error ? "icon" : "secondary"} className="h-11 shrink-0 whitespace-nowrap text-sm max-[20rem]:size-11 max-[20rem]:gap-0 max-[20rem]:p-0"
      aria-haspopup="dialog" aria-label={error ? t("account.unavailable") : loading ? t("account.loading") : t("account.login")}
      title={error || t("account.login")} disabled={disabled || (loading && !session)} onClick={onLogin}
    >
      {error ? <AlertTriangle aria-hidden="true" className="size-5" /> :
        loading ? <LoaderCircle aria-hidden="true" className="size-5 motion-safe:animate-spin" /> :
          <LogIn aria-hidden="true" className="size-5" />}
      {!error && <span className="max-[20rem]:sr-only">{t("account.login")}</span>}
    </Button>
  );
}
