import {
  Dialog,
  DialogBackdrop,
  DialogPanel,
  DialogTitle,
} from "@headlessui/react";
import { X } from "lucide-react";
import { AnimatePresence, useReducedMotion } from "motion/react";
import { useEffect, useRef, type ReactNode, type RefObject } from "react";
import { Button, MotionDiv } from "./controls";

function InitialTouchFocus({
  target,
  enabled,
}: {
  target: RefObject<HTMLButtonElement | null>;
  enabled: boolean;
}) {
  useEffect(() => {
    if (!enabled) return;
    const frame = requestAnimationFrame(() =>
      target.current?.focus({ preventScroll: true }),
    );
    return () => cancelAnimationFrame(frame);
  }, [target, enabled]);
  return null;
}

export function Modal({
  open,
  onClose,
  title,
  initialFocus,
  returnFocus,
  children,
  fullscreen = false,
  size = "compact",
  onExited,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  initialFocus?: RefObject<HTMLElement | null>;
  returnFocus: RefObject<HTMLButtonElement | null>;
  children: ReactNode;
  fullscreen?: boolean;
  size?: "compact" | "wide";
  onExited?: () => void;
}) {
  const closeButton = useRef<HTMLButtonElement>(null);
  const reduced = useReducedMotion();
  const touch =
    typeof window !== "undefined" &&
    (window.matchMedia("(any-pointer: coarse)").matches ||
      navigator.maxTouchPoints > 0);

  return (
    <AnimatePresence
      onExitComplete={() => {
        returnFocus.current?.focus({ preventScroll: true });
        onExited?.();
      }}
    >
      {open && (
        <Dialog
          key="dialog"
          static
          open
          onClose={onClose}
          initialFocus={touch ? closeButton : (initialFocus ?? closeButton)}
          as={MotionDiv}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          motionTransition={{ duration: reduced ? 0 : 0.18 }}
          className="tw:fixed tw:inset-0 tw:z-60"
        >
          <DialogBackdrop className="tw:fixed tw:inset-0 tw:bg-black/60" />
          <div
            data-modal-scroll
            className={`tw:fixed tw:inset-0 tw:overflow-y-auto tw:overscroll-contain ${fullscreen ? "" : "tw:p-4"}`}
          >
            <div className="tw:flex tw:min-h-full tw:items-center tw:justify-center">
              <DialogPanel
                className={
                  fullscreen
                    ? "tw:flex tw:h-dvh tw:w-full tw:flex-col tw:bg-(--panel)"
                    : `tw:w-full ${size === "wide" ? "tw:max-w-[800px]" : "tw:max-w-md"} tw:rounded-lg tw:border tw:border-solid tw:border-[var(--line)] tw:bg-[var(--panel)] tw:p-5 tw:shadow-xl`
                }
              >
                <InitialTouchFocus target={closeButton} enabled={touch} />
                <div
                  className={`tw:flex tw:shrink-0 tw:items-center tw:justify-between tw:gap-3 ${fullscreen ? "tw:p-3 tw:pt-[max(12px,env(safe-area-inset-top))]" : "tw:mb-4"}`}
                >
                  <DialogTitle className="tw:text-lg tw:font-semibold">
                    {title}
                  </DialogTitle>
                  <Button
                    ref={closeButton}
                    variant="icon"
                    onClick={onClose}
                    aria-label="Close dialog"
                    title="Close dialog"
                  >
                    <X aria-hidden="true" />
                  </Button>
                </div>
                {children}
              </DialogPanel>
            </div>
          </div>
        </Dialog>
      )}
    </AnimatePresence>
  );
}
