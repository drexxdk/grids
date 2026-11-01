import {
  Disclosure,
  DisclosureButton,
  DisclosurePanel,
} from "@headlessui/react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { useReducedMotion } from "motion/react";
import { useTranslation } from "react-i18next";
import {
  useLayoutEffect,
  useRef,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { Button, MotionDiv } from "./ui/controls";

const compactQuery = "(max-width: 900px)";
function subscribeToViewport(onChange: () => void) {
  const media = window.matchMedia(compactQuery);
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
}

export function EditorLayout({
  children,
  actions,
}: {
  actions: ReactNode;
  children: [
    (toggle: ReactNode, expanded: boolean) => ReactNode,
    (actions: ReactNode) => ReactNode,
    (actions: ReactNode) => ReactNode,
  ];
}) {
  const { t } = useTranslation();
  const compact = useSyncExternalStore(
    subscribeToViewport,
    () => window.matchMedia(compactQuery).matches,
    () => false,
  );
  const reduced = useReducedMotion();
  const drawerRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const drawer = drawerRef.current;
    const libraryFrame = drawer?.firstElementChild;
    if (!compact || !drawer || !libraryFrame) return;
    const root = document.documentElement;
    const previous = root.style.getPropertyValue("--editor-drawer-height");
    const update = () => {
      if (drawer.hasAttribute("data-open")) return;
      const style = getComputedStyle(drawer);
      const height =
        libraryFrame.getBoundingClientRect().height +
        parseFloat(style.borderTopWidth) +
        parseFloat(style.borderBottomWidth);
      root.style.setProperty("--editor-drawer-height", `${height}px`);
    };
    update();
    const resize = new ResizeObserver(update);
    resize.observe(libraryFrame);
    const disclosure = new MutationObserver(update);
    disclosure.observe(drawer, {
      attributes: true,
      attributeFilter: ["data-open"],
    });
    return () => {
      resize.disconnect();
      disclosure.disconnect();
      if (previous) root.style.setProperty("--editor-drawer-height", previous);
      else root.style.removeProperty("--editor-drawer-height");
    };
  }, [compact]);
  const [library, workspace, settings] = children;
  if (!compact)
    return (
      <>
        {library(null, true)}
        {workspace(null)}
        {settings(actions)}
      </>
    );
  return (
    <>
      {workspace(actions)}
      <Disclosure
        ref={drawerRef}
        data-editor-drawer
        as={MotionDiv}
        initial={{ y: reduced ? 0 : 160 }}
        animate={{ y: 0 }}
        motionTransition={{ duration: reduced ? 0 : 0.18 }}
        className="pointer-events-none fixed left-0 bottom-0 z-40 w-(--viewport-width,100vw) border-0 bg-transparent"
      >
        {({ open }) => (
          <>
            <div className="relative z-10 flex justify-center">
              <DisclosureButton
                as={Button}
                className="pointer-events-auto min-h-11 w-40 shrink-0 translate-y-px rounded-t-md! rounded-b-none! border-b-0! bg-(--panel)! enabled:hover:border-(--line)! enabled:hover:text-(--accent) focus-visible:-outline-offset-2"
                aria-label={t("editor.tools")}
              >
                {open ? (
                  <ChevronDown aria-hidden="true" />
                ) : (
                  <ChevronUp aria-hidden="true" />
                )}
                {t("editor.tools")}
              </DisclosureButton>
            </div>
            <div
              data-shelf-body
              className="pointer-events-auto border border-b-0 border-solid border-(--line) bg-(--panel)"
            >
              <DisclosurePanel
                static
                as={MotionDiv}
                inert={!open}
                aria-hidden={!open}
                initial={false}
                animate={{ height: open ? "auto" : 0, opacity: open ? 1 : 0 }}
                motionTransition={{ duration: reduced ? 0 : 0.18 }}
                className="max-h-[calc(80dvh-44px)] overflow-x-hidden overflow-y-auto overscroll-contain scrollbar-gutter-stable [&_.settings-panel]:p-3!"
              >
                <div className="pb-[env(safe-area-inset-bottom)]">
                  {settings(null)}
                </div>
              </DisclosurePanel>
            </div>
          </>
        )}
      </Disclosure>
    </>
  );
}
