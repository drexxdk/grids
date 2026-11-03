import { t } from "../../i18n";
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
        requestAnimationFrame(() =>
          returnFocus.current?.focus({ preventScroll: true }),
        );
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
          className="fixed inset-0 z-60"
        >
          <DialogBackdrop
            as={MotionDiv}
            initial={false}
            motionTransition={{ duration: reduced ? 0 : 0.18 }}
            className="fixed inset-0 bg-black/60"
          />
          <div
            data-modal-scroll
            className={`fixed inset-0 overflow-y-auto overscroll-contain scrollbar-gutter-stable ${fullscreen ? "" : "p-4"}`}
          >
            <div className="flex min-h-full items-center justify-center">
              <DialogPanel
                data-modal-panel
                as={MotionDiv}
                className={
                  fullscreen
                    ? "flex h-dvh w-full flex-col bg-(--panel)"
                    : `w-full ${size === "wide" ? "max-w-200" : "max-w-md"} rounded-lg border border-solid border-(--line) bg-(--panel) p-5 shadow-xl`
                }
              >
                <InitialTouchFocus target={closeButton} enabled={touch} />
                <div
                  className={`flex shrink-0 items-center justify-between gap-3 ${fullscreen ? "p-3 pt-[max(12px,env(safe-area-inset-top))]" : "mb-4"}`}
                >
                  <DialogTitle className="text-lg font-semibold">
                    {title}
                  </DialogTitle>
                  <Button
                    ref={closeButton}
                    variant="icon"
                    onClick={onClose}
                    aria-label={t("common.actions.closeDialog")}
                    title={t("common.actions.closeDialog")}
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
