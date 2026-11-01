import {
  Images,
  PanelRightOpen,
  PanelsTopLeft,
  Settings2,
  X,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { AnimatePresence, useReducedMotion } from "motion/react";
import {
  useEffect,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { Button, MotionDiv } from "./ui/controls";
import { Modal } from "./ui/Modal";
import { ImageTabs } from "./ui/ImageTabs";

const compactQuery = "(max-width: 900px)";
function subscribeToViewport(onChange: () => void) {
  const media = window.matchMedia(compactQuery);
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
}

export function EditorLayout({
  children,
  actions,
  status,
}: {
  actions: ReactNode;
  status?: ReactNode;
  children: [
    (toggle: ReactNode, expanded: boolean) => ReactNode,
    (actions: ReactNode) => ReactNode,
    (actions: ReactNode) => ReactNode,
  ];
}) {
  const { t } = useTranslation();
  const reduced = useReducedMotion();
  const compact = useSyncExternalStore(
    subscribeToViewport,
    () => window.matchMedia(compactQuery).matches,
    () => false,
  );
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsPresent, setSettingsPresent] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [selectedPanel, setSelectedPanel] = useState(0);
  const panelsId = useId();
  const settingsButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!compact) {
      setSettingsOpen(false);
      setSettingsPresent(false);
    }
  }, [compact]);
  const [library, workspace, settings] = children;
  const canvasActions = (
    <div className="flex w-full min-w-0 flex-col gap-2">
      <div className="flex w-full items-center justify-between gap-2">
        <a
          className="brand shrink-0 max-[400px]:gap-2! max-[400px]:text-2xl!"
          href="./"
        >
          <span className="brand-mark max-[400px]:size-8!">
            <PanelsTopLeft />
          </span>
          Grids
        </a>
        <div
          role="group"
          aria-label={t("editor.panels")}
          className="flex shrink-0 items-center gap-2"
        >
          {actions}
          <Button
            ref={settingsButton}
            variant="icon"
            title={t(
              (compact ? settingsOpen : sidebarOpen)
                ? "editor.closeSidebar"
                : "editor.showSidebar",
            )}
            aria-label={t(
              (compact ? settingsOpen : sidebarOpen)
                ? "editor.closeSidebar"
                : "editor.showSidebar",
            )}
            aria-expanded={compact ? settingsOpen : sidebarOpen}
            aria-haspopup={compact ? "dialog" : undefined}
            aria-controls={compact ? undefined : panelsId}
            onClick={() => {
              if (compact) {
                setSettingsPresent(true);
                setSettingsOpen(!settingsOpen);
              } else setSidebarOpen(!sidebarOpen);
            }}
          >
            {(compact ? settingsOpen : sidebarOpen) ? (
              <X aria-hidden="true" className="size-5!" />
            ) : (
              <PanelRightOpen aria-hidden="true" className="size-5!" />
            )}
          </Button>
        </div>
      </div>
      {status}
    </div>
  );
  const canvasHeader = (
    <header
      data-canvas-header
      className="col-span-full flex min-h-19 w-[calc(100%+var(--native-scrollbar-width,0px))] shrink-0 items-center border-0 border-b border-solid border-(--line) bg-(--bg) px-3 py-3 pr-[calc(12px+var(--native-scrollbar-width,0px))]"
    >
      {compact && settingsPresent ? (
        <div className="h-11 w-full" aria-hidden="true" />
      ) : (
        canvasActions
      )}
    </header>
  );
  return (
    <>
      {canvasHeader}
      {workspace(null)}
      {!compact && (
        <div
          data-sidebar-track
          data-sidebar-open={sidebarOpen ? "" : undefined}
          className="relative h-full min-h-0 min-w-0 w-[calc(100%+var(--native-scrollbar-width,0px))] overflow-hidden"
        >
          <AnimatePresence initial={false}>
            {sidebarOpen && (
              <MotionDiv
                key="desktop-sidebar"
                initial={{ x: "100%" }}
                animate={{ x: 0 }}
                exit={{ x: "100%" }}
                motionTransition={{
                  duration: reduced ? 0 : 0.18,
                  ease: "easeInOut",
                }}
                className="absolute inset-y-0 right-0 w-87.5"
              >
                <aside
                  id={panelsId}
                  data-editor-sidebar
                  aria-label={t("editor.tools")}
                  className="h-full min-h-0 min-w-0 w-full overflow-x-hidden overflow-y-auto border-0 border-l border-solid border-(--line) bg-(--panel) scrollbar-gutter-stable"
                >
                  <div
                    data-sidebar-sticky
                    className="sticky top-0 z-20 bg-(--panel)"
                  >
                    <div
                      data-panel-controls
                      className="flex shrink-0 flex-col gap-2 p-4"
                    >
                      <ImageTabs
                        id={panelsId}
                        label={t("editor.panels")}
                        selectedIndex={selectedPanel}
                        onChange={setSelectedPanel}
                        tabs={[
                          { label: t("editor.images"), icon: Images },
                          { label: t("editor.settings"), icon: Settings2 },
                        ]}
                      />
                    </div>
                  </div>
                  <div
                    data-sidebar-panels
                    className="relative isolate z-0 min-h-0 **:data-sidebar-header:hidden! [&_.asset-panel]:static! [&_.asset-panel]:block! [&_.asset-panel]:h-auto! [&_.asset-panel]:overflow-visible! [&_.asset-panel]:border-0! [&_.settings-panel]:static! [&_.settings-panel]:block! [&_.settings-panel]:h-auto! [&_.settings-panel]:overflow-visible! [&_.settings-panel]:border-0! **:data-sidebar-content:block! **:data-sidebar-content:overflow-visible! **:data-sidebar-content:scrollbar-gutter-auto!"
                  >
                    <div
                      role="tabpanel"
                      id={`${panelsId}-panel-0`}
                      aria-labelledby={`${panelsId}-tab-0`}
                      hidden={selectedPanel !== 0}
                      className="min-h-0"
                    >
                      {library(null, true)}
                    </div>
                    <div
                      role="tabpanel"
                      id={`${panelsId}-panel-1`}
                      aria-labelledby={`${panelsId}-tab-1`}
                      hidden={selectedPanel !== 1}
                      className="min-h-0"
                    >
                      {settings(null)}
                    </div>
                  </div>
                </aside>
              </MotionDiv>
            )}
          </AnimatePresence>
        </div>
      )}
      {compact && (
        <Modal
          open={settingsOpen}
          onClose={() => setSettingsOpen(false)}
          title={t("editor.settings")}
          returnFocus={settingsButton}
          sidePanel
          toolbar={canvasActions}
          onExited={() => setSettingsPresent(false)}
        >
          <div
            data-editor-settings
            className="[&_.settings-panel]:block! [&_.settings-panel]:border-0! [&_.settings-panel]:p-0!"
          >
            {settings(null)}
          </div>
        </Modal>
      )}
    </>
  );
}
