import {
  Images,
  LayoutGrid,
  PanelRightClose,
  PanelRightOpen,
  PanelsTopLeft,
  Settings2,
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

const compactQuery = "(width < 901px)";
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
  previewId,
  previewing = false,
  previewBar,
}: {
  actions: ReactNode;
  canvasControls: ReactNode;
  status?: ReactNode;
  previewId?: string;
  previewing?: boolean;
  previewBar?: ReactNode;
  children: [
    (toggle: ReactNode, expanded: boolean) => ReactNode,
    (actions: ReactNode) => ReactNode,
    (actions: ReactNode) => ReactNode,
    () => ReactNode,
  ];
}) {
  const { t } = useTranslation();
  const reduced = useReducedMotion();
  const compact = useSyncExternalStore(
    subscribeToViewport,
    () => window.matchMedia(compactQuery).matches,
    () => false,
  );
  const [sidebarOpen, setSidebarOpen] = useEditorState("sidebarOpen");
  const [selectedPanel, setSelectedPanel] = useEditorState("selectedPanel");
  const panelOrder = [2, 0, 1];
  const panelsId = useId();
  const panelScroll = useRef(
    new Map<number, Map<HTMLElement, [number, number]>>(),
  );
  const presetsVisited = useRef(false);
  if (selectedPanel === 2) presetsVisited.current = true;
  const rememberPanelScroll = () => {
    const aside = document.getElementById(panelsId);
    const panel = document.getElementById(`${panelsId}-panel-${selectedPanel}`);
    if (!aside || !panel) return;
    const positions = new Map<HTMLElement, [number, number]>();
    const scrollers = [
      aside,
      aside.querySelector<HTMLElement>("[data-sidebar-panels]"),
      ...panel.querySelectorAll<HTMLElement>("*"),
    ];
    for (const element of scrollers)
      if (element && (element.scrollTop > 0 || element.scrollLeft > 0))
        positions.set(element, [element.scrollTop, element.scrollLeft]);
    panelScroll.current.set(selectedPanel, positions);
  };
  useLayoutEffect(() => {
    const aside = document.getElementById(panelsId);
    if (!aside) return;
    aside.scrollTop = 0;
    const panels = aside.querySelector<HTMLElement>("[data-sidebar-panels]");
    if (panels) panels.scrollTop = 0;
    for (const [element, [top, left]] of panelScroll.current.get(
      selectedPanel,
    ) ?? []) {
      element.scrollTop = top;
      element.scrollLeft = left;
    }
  }, [panelsId, selectedPanel]);
  const headerElement = useRef<HTMLElement>(null);
  const [headerHeight, setHeaderHeight] = useState(76);
  const headerActions = useRef<HTMLDivElement>(null);
  const resizeControls = useRef<HTMLDivElement>(null);
  const controlsInHeader = Boolean(canvasControls);
  const headerBrand = useRef<HTMLDivElement>(null);
  const [brandInHeader, setBrandInHeader] = useState(false);
  const expandedExportSpacing = useRef(0);
  const [compactExport, setCompactExport] = useState(false);
  const [headerLayout, setHeaderLayout] = useState<
    "full" | "icon" | "shifted" | "scroll"
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
      if (!compactExport) {
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
      // Width-based so the result does not depend on the current layout mode.
      const inset =
        parseFloat(
          getComputedStyle(actions).getPropertyValue("--fixed-scrollbar-inset"),
        ) || 0;
      // Scroll layout already shrinks the header by the inset.
      const headerWidth =
        (headerElement.current?.clientWidth ?? 0) +
        (headerLayout === "scroll" ? inset : 0);
      const gutter = compact
        ? 0
        : parseFloat(
            getComputedStyle(controls).getPropertyValue(
              "--native-scrollbar-width",
            ),
          ) || 0;
      const zoneWidth =
        headerWidth - (!compact && sidebarOpen ? 350 : 0) - gutter;
      const controlsRight = zoneWidth / 2 + controlsWidth / 2;
      const actionsRight = headerWidth - 12 - inset;
      const otherActionsWidth =
        actions.getBoundingClientRect().width -
        exportButton.getBoundingClientRect().width;
      const fits = (exportWidth: number) =>
        actionsRight - otherActionsWidth - exportWidth >= controlsRight + gap;
      const leftControlsRight =
        parseFloat(getComputedStyle(controls).paddingLeft) + controlsWidth;
      const iconWidth = exportButton.getBoundingClientRect().height;
      const nextLayout = fits(fullExportWidth)
        ? "full"
        : fits(iconWidth)
          ? "icon"
          : actionsRight - otherActionsWidth - iconWidth >=
              leftControlsRight + gap
            ? "shifted"
            : "scroll";
      setHeaderLayout(nextLayout);
      setCompactExport(nextLayout !== "full");
      const brandLimit = controlsRight - controlsWidth;
      setBrandInHeader(
        nextLayout !== "shifted" &&
          nextLayout !== "scroll" &&
          12 + branding.getBoundingClientRect().width + gap <= brandLimit,
      );
    };
    measure();
    const observer = new ResizeObserver(measure);
    for (const element of [
      headerElement.current,
      wrapper,
      controls,
      actions,
      label,
      branding,
    ])
      if (element) observer.observe(element);
    document.fonts.addEventListener("loadingdone", measure);
    return () => {
      observer.disconnect();
      document.fonts.removeEventListener("loadingdone", measure);
    };
  }, [compact, sidebarOpen, headerLayout, compactExport, controlsInHeader]);
  const [library, workspace, settings, presets] = children;
  const brand = (
    <a className="brand shrink-0" href="./">
      <span className="brand-mark">
        <PanelsTopLeft />
      </span>
      Gridz
    </a>
  );
  const canvasActions = (
    <div
      inert={previewing}
      className={`relative flex gap-2 ${headerLayout === "scroll" ? "w-full min-w-0 shrink-0 flex-row items-center pr-3" : "w-full min-w-0 flex-col"}`}
    >
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
        inert={previewing}
        data-canvas-controls
        className={`flex min-h-11 min-w-0 items-center gap-2 pl-3 ${headerLayout === "scroll" ? "min-w-0 flex-1 flex-nowrap justify-start self-stretch overflow-x-auto overflow-y-hidden bg-(--panel) py-3 pr-3" : `overflow-hidden pr-3 ${compact ? "" : "scrollbar-gutter-stable"} flex-wrap justify-center ${headerLayout === "shifted" ? "justify-start!" : ""} ${!compact && sidebarOpen ? "w-[calc(100%-350px)]" : "w-full"}`}`}
      >
        {canvasControls}
      </div>
      <div
        ref={headerActions}
        role="group"
        aria-label={t("editor.panels")}
        className={`flex items-center gap-2 ${headerLayout === "scroll" ? "relative mt-3 mb-[calc(12px+var(--native-scrollbar-width,0px))] shrink-0" : "absolute top-0 right-[calc(12px+var(--fixed-scrollbar-inset,0px))]"}`}
      >
        {actions}
        {!compact && (
          <Button
            variant="icon"
            title={t(
              sidebarOpen ? "editor.closeSidebar" : "editor.showSidebar",
            )}
            aria-label={t(
              sidebarOpen ? "editor.closeSidebar" : "editor.showSidebar",
            )}
            aria-expanded={sidebarOpen}
            aria-controls={panelsId}
            onClick={() => setSidebarOpen(!sidebarOpen)}
          >
            {sidebarOpen ? (
              <PanelRightClose aria-hidden="true" className="size-5!" />
            ) : (
              <PanelRightOpen aria-hidden="true" className="size-5!" />
            )}
          </Button>
        )}
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
      data-compact-export={compactExport ? true : undefined}
      className={`group/header relative col-span-full flex min-h-19 shrink-0 overflow-y-hidden ${headerLayout === "scroll" ? "items-stretch overflow-x-hidden" : "items-center overflow-x-auto py-3"} border-0 border-b border-solid border-(--line) bg-(--bg) [&_button:focus-visible]:-outline-offset-3! ${headerLayout === "scroll" ? "w-[calc(100%+var(--native-scrollbar-width,0px)-var(--fixed-scrollbar-inset,0px))]" : "w-[calc(100%+var(--native-scrollbar-width,0px))]"}`}
    >
      {canvasActions}
      {previewBar && (
        <div className="@container absolute inset-0 z-40 flex items-center bg-(--bg) pr-[calc(12px+var(--fixed-scrollbar-inset,0px))] pl-3">
          {previewBar}
        </div>
      )}
    </header>
  );
  return (
    <>
      {canvasHeader}
      {workspace(null)}
      <div
        data-sidebar-track
        data-sidebar-open={!compact && sidebarOpen ? "" : undefined}
        className={
          compact
            ? "relative shrink-0 w-[calc(100%+var(--native-scrollbar-width,0px))] overflow-hidden"
            : "relative h-full min-h-0 min-w-0 w-[calc(100%+var(--native-scrollbar-width,0px))] overflow-hidden"
        }
      >
        <AnimatePresence initial={false}>
          {(compact || sidebarOpen) && (
            <MotionDiv
              key={compact ? "sidebar-compact" : "sidebar"}
              initial={compact ? { height: 0 } : { x: "100%" }}
              animate={compact ? { height: "auto" } : { x: 0 }}
              exit={compact ? { height: 0 } : { x: "100%" }}
              motionTransition={{
                duration: reduced ? 0 : 0.18,
                ease: "easeInOut",
              }}
              className={
                compact
                  ? "overflow-hidden"
                  : "pointer-events-auto absolute inset-y-0 right-0 w-87.5"
              }
            >
              <aside
                id={panelsId}
                data-editor-sidebar
                aria-label={t("editor.tools")}
                className={`min-h-0 min-w-0 w-full overflow-x-hidden border-0 border-solid border-(--line) bg-(--panel) ${compact ? "flex h-39.25 max-h-[45dvh] flex-col overflow-y-hidden border-t" : "scrollbar-gutter-stable flex h-full flex-col overflow-y-auto border-l"}`}
              >
                <div
                  data-sidebar-sticky
                  className="sticky top-0 z-20 shrink-0 bg-(--panel) max-[901px]:pr-(--fixed-scrollbar-inset,0px)"
                >
                  {!brandInHeader && !compact && (
                    <div
                      data-sidebar-brand
                      className="flex min-h-19 items-center border-0 border-b border-solid border-(--line) px-4 py-3"
                    >
                      {brand}
                    </div>
                  )}
                  {
                    <div
                      data-panel-controls
                      className={`flex shrink-0 flex-col gap-2 ${compact ? "" : "p-4"}`}
                    >
                      <ImageTabs
                        id={panelsId}
                        square={compact}
                        label={t("editor.panels")}
                        selectedIndex={panelOrder.indexOf(selectedPanel)}
                        onChange={(index) => {
                          rememberPanelScroll();
                          setSelectedPanel(panelOrder[index]!);
                        }}
                        tabs={[
                          { label: t("presets.title"), icon: LayoutGrid },
                          { label: t("editor.images"), icon: Images },
                          { label: t("editor.settings"), icon: Settings2 },
                        ]}
                      />
                    </div>
                  }
                </div>
                <div
                  data-sidebar-panels
                  className={`relative isolate z-0 min-h-0 flex-1 max-[901px]:overflow-x-hidden max-[901px]:overflow-y-auto max-[901px]:overscroll-contain ${selectedPanel === 1 ? "max-[901px]:scrollbar-gutter-stable" : ""} **:data-sidebar-header:hidden! [&_.asset-panel]:static! [&_.asset-panel]:block! [&_.asset-panel]:h-auto! [&_.asset-panel]:overflow-visible! [&_.asset-panel]:border-0! [&_.settings-panel]:static! [&_.settings-panel]:block! [&_.settings-panel]:h-auto! [&_.settings-panel]:overflow-visible! [&_.settings-panel]:border-0! **:data-sidebar-content:overflow-visible! **:data-sidebar-content:scrollbar-gutter-auto!`}
                >
                  <div
                    role="tabpanel"
                    id={`${panelsId}-panel-1`}
                    aria-labelledby={`${panelsId}-tab-1`}
                    hidden={selectedPanel !== 0}
                    className="min-h-0 max-[901px]:pr-(--fixed-scrollbar-inset,0px)"
                  >
                    {library(null, true)}
                  </div>
                  <div
                    role="tabpanel"
                    id={`${panelsId}-panel-2`}
                    aria-labelledby={`${panelsId}-tab-2`}
                    hidden={selectedPanel !== 1}
                    className="min-h-0 max-[901px]:pr-(--fixed-scrollbar-inset,0px)"
                  >
                    {settings(null)}
                  </div>
                  {presetsVisited.current && (
                    <div
                      role="tabpanel"
                      id={`${panelsId}-panel-0`}
                      aria-labelledby={`${panelsId}-tab-0`}
                      hidden={selectedPanel !== 2}
                      className="min-h-0 max-[901px]:pr-(--fixed-scrollbar-inset,0px)"
                    >
                      {presets()}
                    </div>
                  )}
                </div>
              </aside>
            </MotionDiv>
          )}
        </AnimatePresence>
      </div>
    </>
  );
}
