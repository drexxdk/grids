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
  canvasControls,
  status,
}: {
  actions: ReactNode;
  canvasControls: ReactNode;
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
  const brand = (
    <a className="brand shrink-0" href="./">
      <span className="brand-mark">
        <PanelsTopLeft />
      </span>
      Grids
    </a>
  );
  const canvasActions = (
    <div className="relative flex w-full min-w-0 flex-col gap-2">
      <div
        data-canvas-controls
        className={`flex min-w-0 flex-wrap items-center justify-center gap-2 overflow-hidden scrollbar-gutter-stable px-3 max-[700px]:pt-13 ${!compact && sidebarOpen ? "w-[calc(100%-350px)]" : "w-full"}`}
      >
        {canvasControls}
      </div>
      <div
        role="group"
        aria-label={t("editor.panels")}
        className="absolute top-0 right-[calc(12px+var(--native-scrollbar-width,0px))] flex items-center gap-2"
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
      {status}
    </div>
  );
  const canvasHeader = (
    <header
      data-canvas-header
      aria-hidden={compact && settingsPresent ? true : undefined}
      inert={compact && settingsPresent ? true : undefined}
      className="col-span-full flex min-h-19 w-[calc(100%+var(--native-scrollbar-width,0px))] shrink-0 items-center border-0 border-b border-solid border-(--line) bg-(--bg) py-3 [&_button:focus-visible]:-outline-offset-3!"
    >
      {canvasActions}
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
                    <div className="flex min-h-19 items-center border-0 border-b border-solid border-(--line) px-4 py-3">
                      {brand}
                    </div>
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
          onExited={() => setSettingsPresent(false)}
          toolbar={
            <div className="flex w-full items-center justify-between gap-2">
              {brand}
              <div role="group" aria-label={t("editor.panels")}>
                <Button
                  variant="icon"
                  aria-label={t("editor.closeSidebar")}
                  title={t("editor.closeSidebar")}
                  aria-expanded={true}
                  onClick={() => setSettingsOpen(false)}
                >
                  <X aria-hidden="true" className="size-5!" />
                </Button>
              </div>
            </div>
          }
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
