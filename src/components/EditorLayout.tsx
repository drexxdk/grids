import { Images, PanelsTopLeft, Settings2, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  useEffect,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { Button, ButtonGroup } from "./ui/controls";
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
  const compact = useSyncExternalStore(
    subscribeToViewport,
    () => window.matchMedia(compactQuery).matches,
    () => false,
  );
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [selectedPanel, setSelectedPanel] = useState(0);
  const panelsId = useId();
  const settingsButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!compact) setSettingsOpen(false);
  }, [compact]);
  useEffect(() => {
    if (!compact && !sidebarOpen)
      settingsButton.current?.focus({ preventScroll: true });
  }, [compact, sidebarOpen]);
  const [library, workspace, settings] = children;
  const canvasActions = (
    <div className="flex min-w-0 flex-col items-end gap-2">
      <ButtonGroup label={t("editor.panels")}>
        <Button
          ref={settingsButton}
          variant="icon"
          title={t("editor.settings")}
          aria-label={t("editor.settings")}
          aria-expanded={compact ? settingsOpen : sidebarOpen}
          aria-haspopup={compact ? "dialog" : undefined}
          aria-controls={compact ? undefined : panelsId}
          onClick={() => {
            if (compact) setSettingsOpen(true);
            else {
              setSelectedPanel(1);
              setSidebarOpen(true);
            }
          }}
        >
          <Settings2 aria-hidden="true" className="size-5!" />
        </Button>
        {actions}
      </ButtonGroup>
      {status}
    </div>
  );
  if (!compact && sidebarOpen)
    return (
      <>
        {workspace(null)}
        <aside
          id={panelsId}
          data-editor-sidebar
          aria-label={t("editor.tools")}
          className="sticky top-0 h-dvh min-h-0 min-w-0 self-start overflow-x-hidden overflow-y-auto border-0 border-l border-solid border-(--line) bg-(--panel) scrollbar-gutter-stable"
        >
          <div data-sidebar-sticky className="sticky top-0 z-20 bg-(--panel)">
            <div
              data-sidebar-header
              className="flex min-h-19 items-center justify-between gap-3 border-0 border-b border-solid border-(--line) px-4 py-3"
            >
              <a className="brand" href="./">
                <span className="brand-mark">
                  <PanelsTopLeft />
                </span>
                Grids
              </a>
              <Button
                variant="icon"
                title={t("editor.closeSidebar")}
                aria-label={t("editor.closeSidebar")}
                onClick={() => setSidebarOpen(false)}
              >
                <X aria-hidden="true" />
              </Button>
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
                actions={actions}
                tabs={[
                  { label: t("editor.images"), icon: Images },
                  { label: t("editor.settings"), icon: Settings2 },
                ]}
              />
              {status}
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
      </>
    );
  return (
    <>
      {workspace(canvasActions)}
      {compact && (
        <Modal
          open={settingsOpen}
          onClose={() => setSettingsOpen(false)}
          title={t("editor.settings")}
          returnFocus={settingsButton}
          sidePanel
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
