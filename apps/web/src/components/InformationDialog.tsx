import { useEffect, useId, useMemo, useRef, useState, type RefObject } from "react";
import { FileText, LifeBuoy, ShieldCheck } from "lucide-react";
import terms from "../../public/terms.html?raw";
import privacy from "../../public/privacy.html?raw";
import support from "../../public/support.html?raw";
import { t } from "../i18n";
import { Modal } from "./ui/Modal";
import { ImageTabs } from "./ui/ImageTabs";

const pages = [
  { path: "terms", label: "legal.terms", icon: FileText, html: terms },
  { path: "privacy", label: "legal.privacy", icon: ShieldCheck, html: privacy },
  { path: "support", label: "legal.support", icon: LifeBuoy, html: support },
] as const;

export function InformationDialog({
  open, onClose, onExited, returnFocus,
}: {
  open: boolean;
  onClose: () => void;
  onExited: () => void;
  returnFocus: RefObject<HTMLButtonElement | null>;
}) {
  const [selected, setSelected] = useState(0);
  const [anchor, setAnchor] = useState("");
  const id = useId();
  const article = useRef<HTMLDivElement>(null);
  const content = useMemo(() => {
    const main = new DOMParser().parseFromString(pages[selected].html, "text/html").querySelector("main");
    if (!main) throw new Error(`Missing information content: ${pages[selected].path}`);
    for (const link of main.querySelectorAll("a[href]")) {
      const url = new URL(link.getAttribute("href")!, location.href);
      if (url.protocol === "https:" && url.origin !== location.origin) {
        link.setAttribute("target", "_blank");
        link.setAttribute("rel", "noopener noreferrer");
      }
    }
    return main.innerHTML;
  }, [selected]);
  useEffect(() => {
    if (!open || !article.current) return;
    article.current.scrollTop = 0;
    if (anchor) article.current.querySelector(`#${CSS.escape(anchor)}`)?.scrollIntoView({ block: "start" });
  }, [open, selected, anchor]);
  return (
    <Modal open={open} onClose={onClose} onExited={() => { setSelected(0); setAnchor(""); onExited(); }} returnFocus={returnFocus} title={t("legal.navigation")} size="wide">
      <div className="flex h-[min(42rem,calc(100dvh-10rem))] min-h-0 flex-col gap-4 max-[400px]:[&_[role=tab]_svg]:hidden">
        <ImageTabs id={id} label={t("legal.navigation")} selectedIndex={selected}
          tabs={pages.map(({ label, icon }) => ({ label: t(label), icon }))}
          onChange={(index) => { setSelected(index); setAnchor(""); }}
        />
        <div ref={article} role="tabpanel" id={`${id}-panel-${selected}`} aria-labelledby={`${id}-tab-${selected}`} tabIndex={0}
          className="min-h-0 overflow-y-auto overscroll-contain pr-2 text-sm leading-relaxed focus-visible:outline-2 focus-visible:outline-(--accent) [&_a]:text-(--accent) [&_a]:underline [&_h1]:mt-0 [&_h1]:text-xl [&_h2]:mt-6 [&_h2]:text-base [&_li]:mb-2 [&_p]:my-3"
          onClick={(event) => {
            const link = event.target instanceof Element ? event.target.closest("a[href]") : null;
            if (!link || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
            const url = new URL(link.getAttribute("href")!, location.href);
            const index = pages.findIndex(({ path }) => url.href.split("#")[0] === new URL(`./${path}.html`, location.href).href);
            if (index >= 0) {
              event.preventDefault();
              setSelected(index);
              setAnchor(url.hash.slice(1));
            } else if (url.href === new URL("./", location.href).href) {
              event.preventDefault();
              onClose();
            }
          }}
          dangerouslySetInnerHTML={{ __html: content }}
        />
      </div>
    </Modal>
  );
}
