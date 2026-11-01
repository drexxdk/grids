import {
  Disclosure,
  DisclosureButton,
  DisclosurePanel,
} from "@headlessui/react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { useReducedMotion } from "motion/react";
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
        className="tw:pointer-events-none tw:fixed tw:left-0 tw:bottom-0 tw:z-40 tw:w-[var(--viewport-width,100vw)] tw:border-0 tw:bg-transparent"
      >
        {({ open }) => (
          <>
            <div className="tw:relative tw:z-10 tw:flex tw:justify-center">
              <DisclosureButton
                as={Button}
                className="tw:pointer-events-auto tw:min-h-[44px] tw:w-[160px] tw:shrink-0 tw:translate-y-px tw:rounded-t-[6px]! tw:rounded-b-none! tw:border-b-0! tw:bg-(--panel)! tw:enabled:hover:border-(--line)! tw:enabled:hover:text-(--accent) tw:focus-visible:-outline-offset-2"
                aria-label={open ? "Collapse tools" : "Expand tools"}
              >
                {open ? (
                  <ChevronDown aria-hidden="true" />
                ) : (
                  <ChevronUp aria-hidden="true" />
                )}
                {open ? "Collapse tools" : "Expand tools"}
              </DisclosureButton>
            </div>
            <div
              data-shelf-body
              className="tw:pointer-events-auto tw:border tw:border-b-0 tw:border-solid tw:border-(--line) tw:bg-(--panel)"
            >
              <DisclosurePanel
                static
                as={MotionDiv}
                inert={!open}
                aria-hidden={!open}
                initial={false}
                animate={{ height: open ? "auto" : 0, opacity: open ? 1 : 0 }}
                motionTransition={{ duration: reduced ? 0 : 0.18 }}
                className="tw:max-h-[calc(80dvh-44px)] tw:overflow-x-hidden tw:overflow-y-auto tw:overscroll-contain tw:[scrollbar-gutter:stable] tw:[&_.settings-panel]:p-3!"
              >
                <div className="tw:pb-[env(safe-area-inset-bottom)]">
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
