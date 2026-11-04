import type { RefObject } from "react";
import { AlertTriangle, Info, LogIn, LogOut, Menu, UserRound } from "lucide-react";
import type { AccountSession } from "../browser/account";
import { t } from "../i18n";
import { ActionMenu } from "./ui/controls";

export function AccountHeader({
  session, loading, error, busy, disabled, buttonRef, onLogin, onAccount, onInformation, onSignOut,
}: {
  session: AccountSession | null;
  loading: boolean;
  error: string;
  busy: boolean;
  disabled: boolean;
  buttonRef: RefObject<HTMLButtonElement | null>;
  onLogin: () => void;
  onAccount: () => void;
  onInformation: () => void;
  onSignOut: () => void;
}) {
  return <ActionMenu buttonRef={buttonRef} label={t("account.menu")} icon={Menu} disabled={disabled || busy}
    actions={[
      ...(session?.user && !error ? [
        { label: t("account.title"), icon: UserRound, onSelect: onAccount },
      ] : [
        { label: error ? t("account.unavailable") : t("account.login"), icon: error ? AlertTriangle : LogIn, onSelect: onLogin, disabled: loading && !session },
      ]),
      { label: t("legal.title"), icon: Info, onSelect: onInformation },
      ...(session?.user && !error ? [
        { label: t("account.signOut"), icon: LogOut, onSelect: onSignOut, disabled: busy },
      ] : []),
    ]}
  />;
}
