import {
  Disclosure,
  DisclosureButton,
  DisclosurePanel,
} from "@headlessui/react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { useReducedMotion } from "motion/react";
import { useSyncExternalStore, type ReactNode } from "react";
import { Button, MotionDiv } from "./ui/controls";

const compactQuery = "(max-width: 900px)";
function subscribeToViewport(onChange: () => void) {
  const media = window.matchMedia(compactQuery);
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
}

export function EditorLayout({
  children,
}: {
  children: [
    (toggle: ReactNode, expanded: boolean) => ReactNode,
    ReactNode,
    ReactNode,
  ];
}) {
  const compact = useSyncExternalStore(
    subscribeToViewport,
    () => window.matchMedia(compactQuery).matches,
    () => false,
  );
  const reduced = useReducedMotion();
  const [library, workspace, settings] = children;
  if (!compact)
    return (
      <>
        {library(null, true)}
        {workspace}
        {settings}
      </>
    );
  return (
    <>
      {workspace}
      <Disclosure
        data-editor-drawer
        as={MotionDiv}
        initial={{ y: reduced ? 0 : 160 }}
        animate={{ y: 0 }}
        motionTransition={{ duration: reduced ? 0 : 0.18 }}
        className="tw:fixed tw:inset-x-0 tw:right-[var(--fixed-scrollbar-inset,0px)]! tw:bottom-0 tw:z-40 tw:max-h-[80dvh] tw:overflow-x-hidden tw:overflow-y-auto tw:overscroll-contain tw:rounded-t-lg tw:border tw:border-b-0 tw:border-solid tw:border-(--line) tw:bg-(--panel) tw:shadow-xl"
      >
        {({ open }) => (
          <>
            <div
              className={`tw:[&_.asset-panel]:border-0! tw:[&_.asset-panel]:p-[8px]! tw:[&_.asset-library]:flex! tw:[&_.asset-library]:overflow-x-auto tw:[&_.asset-library]:overflow-y-hidden tw:[&_.asset-library]:py-[4px]! ${open ? "" : "tw:[&_.asset-panel]:pb-0! tw:[&_.asset-library]:mx-[-8px]! tw:[&_.asset-library]:px-[8px]! tw:[&_.asset-library]:pb-[max(4px,env(safe-area-inset-bottom))]! tw:[&_.section-heading]:hidden! tw:[&_.asset-name]:hidden! tw:[&_.asset-category]:hidden! tw:[&_[data-upload-label]]:hidden! tw:[&_[data-library-image]]:w-[64px]! tw:[&_[data-upload-tile]]:w-[64px]! tw:[&_[data-upload-tile]]:h-[64px]! tw:[&_[data-upload-tile]]:min-h-0!"}`}
            >
              {library(
                <DisclosureButton
                  as={Button}
                  className="tw:min-h-[44px] tw:shrink-0 tw:rounded-[4px]! tw:focus-visible:-outline-offset-2"
                  aria-label={open ? "Collapse tools" : "Expand tools"}
                >
                  {open ? (
                    <ChevronDown aria-hidden="true" />
                  ) : (
                    <ChevronUp aria-hidden="true" />
                  )}
                  {open ? "Collapse tools" : "Expand tools"}
                </DisclosureButton>,
                open,
              )}
            </div>
            <DisclosurePanel
              static
              as={MotionDiv}
              inert={!open}
              aria-hidden={!open}
              initial={false}
              animate={{ height: open ? "auto" : 0, opacity: open ? 1 : 0 }}
              motionTransition={{ duration: reduced ? 0 : 0.18 }}
              className={`tw:overflow-hidden tw:[&_.settings-panel]:p-3! ${open ? "tw:pb-[env(safe-area-inset-bottom)]" : ""}`}
            >
              {settings}
            </DisclosurePanel>
          </>
        )}
      </Disclosure>
    </>
  );
}
