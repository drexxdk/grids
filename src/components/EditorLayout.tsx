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
  children: [ReactNode, ReactNode, ReactNode];
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
        {library}
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
        className="tw:fixed tw:inset-x-0 tw:right-[var(--fixed-scrollbar-inset,0px)]! tw:bottom-0 tw:z-40 tw:max-h-[80dvh] tw:overflow-y-auto tw:overscroll-contain tw:rounded-t-lg tw:border tw:border-solid tw:border-(--line) tw:bg-(--panel) tw:pb-[max(8px,env(safe-area-inset-bottom))] tw:shadow-xl"
      >
        {({ open }) => (
          <>
            <div className="tw:sticky tw:top-0 tw:z-10 tw:flex tw:items-center tw:justify-between tw:gap-2 tw:border-0 tw:border-b tw:border-solid tw:border-(--line) tw:bg-(--panel) tw:p-2">
              <span className="tw:px-2 tw:text-sm tw:font-semibold">
                Images
              </span>
              <DisclosureButton
                as={Button}
                className="tw:min-h-[44px]"
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
              className={`tw:[&_.asset-panel]:border-0! tw:[&_.asset-panel]:p-3! tw:[&_.asset-library]:flex! tw:[&_.asset-library]:overflow-x-auto tw:[&_.asset-library]:pb-2 ${open ? "" : "tw:[&_.section-heading]:hidden!"}`}
            >
              {library}
            </div>
            <DisclosurePanel
              static
              as={MotionDiv}
              inert={!open}
              aria-hidden={!open}
              initial={false}
              animate={{ height: open ? "auto" : 0, opacity: open ? 1 : 0 }}
              motionTransition={{ duration: reduced ? 0 : 0.18 }}
              className="tw:overflow-hidden tw:[&_.settings-panel]:p-3!"
            >
              {settings}
            </DisclosurePanel>
          </>
        )}
      </Disclosure>
    </>
  );
}
