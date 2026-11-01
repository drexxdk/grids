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
  sidePanel = false,
  toolbar,
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
  sidePanel?: boolean;
  toolbar?: ReactNode;
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
          initialFocus={
            toolbar
              ? returnFocus
              : touch
                ? closeButton
                : (initialFocus ?? closeButton)
          }
          as={MotionDiv}
          initial={toolbar ? false : { opacity: 0 }}
          animate={toolbar ? undefined : { opacity: 1 }}
          exit={toolbar ? undefined : { opacity: 0 }}
          motionTransition={{ duration: reduced ? 0 : 0.18 }}
          className={`fixed inset-0 z-60 ${toolbar ? "flex flex-col" : ""}`}
        >
          <DialogBackdrop
            as={MotionDiv}
            initial={toolbar ? { opacity: 0 } : false}
            animate={toolbar ? { opacity: 1 } : undefined}
            exit={toolbar ? { opacity: 0 } : undefined}
            motionTransition={{ duration: reduced ? 0 : 0.18 }}
            className="fixed inset-0 bg-black/60"
          />
          {toolbar && (
            <div
              data-modal-toolbar
              className="relative z-10 flex min-h-19 shrink-0 items-center border-0 border-b border-solid border-(--line) bg-(--bg) px-3 py-3 pr-[calc(12px+var(--native-scrollbar-width,0px))]"
            >
              {toolbar}
            </div>
          )}
          <div
            data-modal-scroll
            className={`${toolbar ? "relative min-h-0 flex-1" : "fixed inset-0"} overflow-y-auto overscroll-contain scrollbar-gutter-stable ${sidePanel ? "overflow-x-hidden" : ""} ${fullscreen || sidePanel ? "" : "p-4"}`}
          >
            <div
              className={
                sidePanel
                  ? "flex min-h-full items-stretch justify-end"
                  : "flex min-h-full items-center justify-center"
              }
            >
              <DialogPanel
                data-modal-panel
                as={MotionDiv}
                initial={sidePanel ? { x: "100%" } : false}
                animate={sidePanel ? { x: 0 } : undefined}
                exit={sidePanel ? { x: "100%" } : undefined}
                motionTransition={{ duration: reduced ? 0 : 0.18 }}
                className={
                  sidePanel
                    ? `${toolbar ? "min-h-full" : "min-h-dvh"} w-full max-w-87.5 bg-(--panel) p-4 pb-[max(16px,env(safe-area-inset-bottom))]`
                    : fullscreen
                      ? "flex h-dvh w-full flex-col bg-(--panel)"
                      : `w-full ${size === "wide" ? "max-w-200" : "max-w-md"} rounded-lg border border-solid border-(--line) bg-(--panel) p-5 shadow-xl`
                }
              >
                <InitialTouchFocus
                  target={toolbar ? returnFocus : closeButton}
                  enabled={touch}
                />
                <div
                  className={`flex shrink-0 items-center justify-between gap-3 ${fullscreen ? "p-3 pt-[max(12px,env(safe-area-inset-top))]" : sidePanel ? "mb-4 pt-[env(safe-area-inset-top)]" : "mb-4"}`}
                >
                  <DialogTitle className="text-lg font-semibold">
                    {title}
                  </DialogTitle>
                  {!toolbar && (
                    <Button
                      ref={closeButton}
                      variant="icon"
                      onClick={onClose}
                      aria-label={t("common.actions.closeDialog")}
                      title={t("common.actions.closeDialog")}
                    >
                      <X aria-hidden="true" />
                    </Button>
                  )}
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
