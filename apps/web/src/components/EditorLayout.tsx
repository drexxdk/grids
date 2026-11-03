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
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { Button, MotionDiv } from "./ui/controls";
import { ImageTabs } from "./ui/ImageTabs";
import { useEditorState } from "../browser/navigation";

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
  const [sidebarOpen, setSidebarOpen] = useEditorState("sidebarOpen");
  const [selectedPanel, setSelectedPanel] = useEditorState("selectedPanel");
  const panelsId = useId();
  const settingsButton = useRef<HTMLButtonElement>(null);
  const headerElement = useRef<HTMLElement>(null);
  const [headerHeight, setHeaderHeight] = useState(76);
  const headerActions = useRef<HTMLDivElement>(null);
  const resizeControls = useRef<HTMLDivElement>(null);
  const controlsInHeader = Boolean(canvasControls);
  const headerBrand = useRef<HTMLDivElement>(null);
  const [brandInHeader, setBrandInHeader] = useState(false);
  const expandedExportSpacing = useRef(0);
  const [headerLayout, setHeaderLayout] = useState<
    "full" | "icon" | "shifted" | "wrapped"
  >("full");
  useLayoutEffect(() => {
    const controls = resizeControls.current;
    const actions = headerActions.current;
    const branding = headerBrand.current;
    const wrapper = controls?.parentElement;
    const exportButton = actions?.querySelector<HTMLButtonElement>(
      "#export-grid-header",
    );
    const label = exportButton?.querySelector("span");
    const icon = exportButton?.querySelector("svg");
    if (
      !controls ||
      !actions ||
      !branding ||
      !wrapper ||
      !exportButton ||
      !label ||
      !icon
    )
      return;
    const measure = () => {
      setHeaderHeight(
        headerElement.current?.getBoundingClientRect().height ?? 76,
      );
      const style = getComputedStyle(exportButton);
      if (headerLayout === "full" || headerLayout === "wrapped") {
        expandedExportSpacing.current =
          parseFloat(style.paddingLeft) +
          parseFloat(style.paddingRight) +
          parseFloat(style.borderLeftWidth) +
          parseFloat(style.borderRightWidth) +
          parseFloat(style.columnGap);
      }
      const range = document.createRange();
      range.selectNodeContents(label);
      const fullExportWidth =
        range.getBoundingClientRect().width +
        icon.getBoundingClientRect().width +
        expandedExportSpacing.current;
      const gap = parseFloat(getComputedStyle(controls).columnGap);
      const children = [...controls.children];
      const controlsWidth =
        children.reduce(
          (width, child) => width + child.getBoundingClientRect().width,
          0,
        ) +
        gap * Math.max(0, children.length - 1);
      const controlsRight =
        controls.getBoundingClientRect().left +
        controls.clientWidth / 2 +
        controlsWidth / 2;
      const actionBounds = actions.getBoundingClientRect();
      const otherActionsWidth =
        actionBounds.width - exportButton.getBoundingClientRect().width;
      const fits = (exportWidth: number) =>
        actionBounds.right - otherActionsWidth - exportWidth >=
        controlsRight + gap;
      const leftControlsRight =
        controls.getBoundingClientRect().left +
        parseFloat(getComputedStyle(controls).paddingLeft) +
        controlsWidth;
      const iconWidth = exportButton.getBoundingClientRect().height;
      const nextLayout = fits(fullExportWidth)
        ? "full"
        : fits(iconWidth)
          ? "icon"
          : actionBounds.right - otherActionsWidth - iconWidth >=
              leftControlsRight + gap
            ? "shifted"
            : "wrapped";
      setHeaderLayout(nextLayout);
      const controlsLeft = controlsRight - controlsWidth;
      const brandLimit =
        nextLayout === "wrapped"
          ? actionBounds.right - otherActionsWidth - fullExportWidth
          : controlsLeft;
      setBrandInHeader(
        nextLayout !== "shifted" &&
          branding.getBoundingClientRect().right + gap <= brandLimit,
      );
    };
    measure();
    const observer = new ResizeObserver(measure);
    for (const element of [wrapper, controls, actions, label, branding])
      observer.observe(element);
    document.fonts.addEventListener("loadingdone", measure);
    return () => {
      observer.disconnect();
      document.fonts.removeEventListener("loadingdone", measure);
    };
  }, [compact, sidebarOpen, headerLayout, controlsInHeader]);
  useEffect(() => {
    if (!compact) {
      setSettingsOpen(false);
    }
  }, [compact]);
  useEffect(() => {
    if (!compact || !settingsOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (
        event.key === "Escape" &&
        !event.defaultPrevented &&
        !document.querySelector('[role="dialog"], [role="listbox"]')
      )
        setSettingsOpen(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [compact, settingsOpen]);
  const [library, workspace, settings] = children;
  const brand = (
    <a className="brand shrink-0" href="./">
      <span className="brand-mark">
        <PanelsTopLeft />
      </span>
      Gridz
    </a>
  );
  const canvasActions = (
    <div className="relative flex w-full min-w-0 flex-col gap-2">
      <div
        ref={headerBrand}
        data-header-brand
        aria-hidden={!brandInHeader}
        inert={!brandInHeader}
        className={`absolute top-0 left-3 flex h-11 items-center ${brandInHeader ? "" : "pointer-events-none invisible"}`}
      >
        {brand}
      </div>
      <div
        ref={resizeControls}
        data-canvas-controls
        className={`flex min-h-11 min-w-0 flex-wrap items-center justify-center gap-2 overflow-hidden scrollbar-gutter-stable px-3 ${headerLayout === "shifted" ? "justify-start!" : ""} ${headerLayout === "wrapped" ? "pt-13" : ""} ${!compact && sidebarOpen ? "w-[calc(100%-350px)]" : "w-full"}`}
      >
        {canvasControls}
      </div>
      <div
        ref={headerActions}
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
          aria-controls={panelsId}
          onClick={() => {
            if (compact) {
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
      ref={headerElement}
      data-canvas-header
      data-header-layout={headerLayout}
      data-brand-placement={brandInHeader ? "header" : "aside"}
      data-compact-export={
        headerLayout === "icon" || headerLayout === "shifted" ? true : undefined
      }
      className="group/header col-span-full flex min-h-19 w-[calc(100%+var(--native-scrollbar-width,0px))] shrink-0 items-center border-0 border-b border-solid border-(--line) bg-(--bg) py-3 [&_button:focus-visible]:-outline-offset-3!"
    >
      {canvasActions}
    </header>
  );
  return (
    <>
      {canvasHeader}
      {workspace(null)}
      <AnimatePresence>
        {compact && settingsOpen && (
          <MotionDiv
            key="sidebar-backdrop"
            aria-hidden="true"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            motionTransition={{ duration: reduced ? 0 : 0.18 }}
            onClick={() => setSettingsOpen(false)}
            className="fixed inset-x-0 bottom-0 z-30 bg-black/60"
            style={{ top: headerHeight }}
          />
        )}
      </AnimatePresence>
      <div
        data-sidebar-track
        data-sidebar-open={!compact && sidebarOpen ? "" : undefined}
        className={
          compact
            ? "pointer-events-none fixed right-0 bottom-0 z-40 w-87.5 max-w-full overflow-hidden"
            : "relative h-full min-h-0 min-w-0 w-[calc(100%+var(--native-scrollbar-width,0px))] overflow-hidden"
        }
        style={compact ? { top: headerHeight } : undefined}
      >
        <AnimatePresence
          initial={false}
          onExitComplete={() => {
            if (compact) settingsButton.current?.focus({ preventScroll: true });
          }}
        >
          {(compact ? settingsOpen : sidebarOpen) && (
            <MotionDiv
              key="sidebar"
              initial={{ x: "100%" }}
              animate={{ x: 0 }}
              exit={{ x: "100%" }}
              motionTransition={{
                duration: reduced ? 0 : 0.18,
                ease: "easeInOut",
              }}
              className="pointer-events-auto absolute inset-y-0 right-0 w-full max-w-87.5"
            >
              <aside
                id={panelsId}
                data-editor-sidebar
                data-editor-settings={compact ? true : undefined}
                aria-label={t("editor.tools")}
                className="h-full min-h-0 min-w-0 w-full overflow-x-hidden overflow-y-auto border-0 border-l border-solid border-(--line) bg-(--panel) scrollbar-gutter-stable"
              >
                <div
                  data-sidebar-sticky
                  className="sticky top-0 z-20 bg-(--panel)"
                >
                  {!brandInHeader && (
                    <div
                      data-sidebar-brand
                      className="flex min-h-19 items-center border-0 border-b border-solid border-(--line) px-4 py-3"
                    >
                      {brand}
                    </div>
                  )}
                  {!compact && (
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
                  )}
                </div>
                <div
                  data-sidebar-panels
                  className="relative isolate z-0 min-h-0 **:data-sidebar-header:hidden! [&_.asset-panel]:static! [&_.asset-panel]:block! [&_.asset-panel]:h-auto! [&_.asset-panel]:overflow-visible! [&_.asset-panel]:border-0! [&_.settings-panel]:static! [&_.settings-panel]:block! [&_.settings-panel]:h-auto! [&_.settings-panel]:overflow-visible! [&_.settings-panel]:border-0! **:data-sidebar-content:block! **:data-sidebar-content:overflow-visible! **:data-sidebar-content:scrollbar-gutter-auto!"
                >
                  {!compact && (
                    <div
                      role="tabpanel"
                      id={`${panelsId}-panel-0`}
                      aria-labelledby={`${panelsId}-tab-0`}
                      hidden={selectedPanel !== 0}
                      className="min-h-0"
                    >
                      {library(null, true)}
                    </div>
                  )}
                  <div
                    role={compact ? undefined : "tabpanel"}
                    id={`${panelsId}-panel-1`}
                    aria-labelledby={compact ? undefined : `${panelsId}-tab-1`}
                    hidden={!compact && selectedPanel !== 1}
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
    </>
  );
}
