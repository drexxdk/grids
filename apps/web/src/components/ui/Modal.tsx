import { t } from "../../i18n";
import {
  Dialog,
  DialogBackdrop,
  DialogPanel,
  DialogTitle,
} from "@headlessui/react";
import { LoaderCircle, X } from "lucide-react";
import { AnimatePresence, useReducedMotion } from "motion/react";
import { useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { Button, MotionDiv } from "./controls";

function InitialDialogFocus({
  target,
  enabled,
}: {
  target: RefObject<HTMLElement | null>;
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
  ready,
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
  ready?: boolean;
}) {
  const closeButton = useRef<HTMLButtonElement>(null);
  const pendingCloseButton = useRef<HTMLButtonElement>(null);
  const [prepared, setPrepared] = useState(false);
  const contentReady = ready === undefined || prepared;
  useEffect(() => {
    if (!open) {
      setPrepared(false);
      return;
    }
    if (ready !== true || prepared) return;
    let frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(() => setPrepared(true));
    });
    return () => cancelAnimationFrame(frame);
  }, [open, ready, prepared]);
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
          initialFocus={contentReady ? (touch ? closeButton : (initialFocus ?? closeButton)) : pendingCloseButton}
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
              {contentReady ? <DialogPanel
                key="content"
                data-modal-panel
                as={MotionDiv}
                initial={ready === undefined || reduced ? false : { opacity: 0 }}
                animate={{ opacity: 1 }}
                motionTransition={{ duration: reduced ? 0 : 0.18 }}
                className={
                  fullscreen
                    ? "flex h-dvh w-full flex-col bg-(--panel)"
                    : `w-full ${size === "wide" ? "max-w-200" : "max-w-md"} rounded-lg border border-solid border-(--line) bg-(--panel) p-5 shadow-xl`
                }
              >
                <InitialDialogFocus target={touch ? closeButton : (initialFocus ?? closeButton)} enabled={touch || ready !== undefined} />
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
              </DialogPanel> : <DialogPanel key="loading" className="flex items-center gap-3">
                <DialogTitle className="sr-only">{title}</DialogTitle>
                <span role="status" className="flex items-center gap-2 text-sm text-(--text)">
                  <LoaderCircle aria-hidden="true" className="size-5 motion-safe:animate-spin" />
                  {t("common.actions.loading")}
                </span>
                <Button ref={pendingCloseButton} variant="icon" onClick={onClose}
                  aria-label={t("common.actions.closeDialog")} title={t("common.actions.closeDialog")}>
                  <X aria-hidden="true" />
                </Button>
              </DialogPanel>}
            </div>
          </div>
        </Dialog>
      )}
    </AnimatePresence>
  );
}
