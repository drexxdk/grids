import { FileText, LifeBuoy, ShieldCheck } from "lucide-react";
import { t } from "../i18n";

export function LegalLinks() {
  const links = [
    { page: "terms", label: t("legal.terms"), Icon: FileText },
    { page: "privacy", label: t("legal.privacy"), Icon: ShieldCheck },
    { page: "support", label: t("legal.support"), Icon: LifeBuoy },
  ];
  return (
    <nav aria-label={t("legal.navigation")} className="flex flex-wrap gap-x-4 gap-y-1">
      {links.map(({ page, label, Icon }) => (
        <a
          key={page}
          href={`./${page}.html`}
          target="_blank"
          rel="noopener"
          className="inline-flex min-h-11 items-center gap-1.5 text-xs text-(--muted) underline-offset-4 hover:text-(--accent) focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--accent)"
        >
          <Icon aria-hidden="true" className="size-3.5" />
          {label}
          <span className="sr-only">{t("legal.newTab")}</span>
        </a>
      ))}
    </nav>
  );
}
