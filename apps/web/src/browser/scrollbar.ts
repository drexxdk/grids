export function publishScrollbarWidth() {
  const root = document.documentElement;
  const previous = root.style.getPropertyValue("--scrollbar-width");
  const previousViewportWidth = root.style.getPropertyValue("--viewport-width");
  const previousNativeWidth = root.style.getPropertyValue(
    "--native-scrollbar-width",
  );
  const probe = document.createElement("div");
  probe.setAttribute("aria-hidden", "true");
  probe.style.cssText =
    "position:fixed;top:0;left:0;width:100%;height:0;visibility:hidden;pointer-events:none";
  document.body.append(probe);
  const scrollProbe = document.createElement("div");
  scrollProbe.setAttribute("aria-hidden", "true");
  scrollProbe.style.cssText =
    "position:fixed;left:-10000px;top:0;width:100px;height:100px;overflow:scroll;visibility:hidden;pointer-events:none";
  document.body.append(scrollProbe);

  const update = () => {
    root.style.setProperty("--viewport-width", `${window.innerWidth}px`);
    root.style.setProperty(
      "--native-scrollbar-width",
      `${Math.max(0, scrollProbe.offsetWidth - scrollProbe.clientWidth)}px`,
    );
    const modalScroll = document.querySelector<HTMLElement>(
      "#headlessui-portal-root [data-modal-scroll]",
    );
    const modalScrolls =
      !!modalScroll && modalScroll.offsetWidth > modalScroll.clientWidth;
    root.style.setProperty(
      "--fixed-scrollbar-inset",
      modalScrolls
        ? `${modalScroll.offsetWidth - modalScroll.clientWidth}px`
        : "0px",
    );
    if (
      document.querySelector(
        '#headlessui-portal-root [role="dialog"][aria-modal="true"]',
      )
    )
      return;
    root.style.setProperty(
      "--scrollbar-width",
      `${Math.max(0, window.innerWidth - probe.offsetWidth + parseFloat(getComputedStyle(root).paddingRight))}px`,
    );
  };

  update();
  window.addEventListener("resize", update);
  const observer = new MutationObserver(update);
  observer.observe(document.body, { childList: true, subtree: true });

  return () => {
    observer.disconnect();
    window.removeEventListener("resize", update);
    probe.remove();
    scrollProbe.remove();
    if (previous) root.style.setProperty("--scrollbar-width", previous);
    else root.style.removeProperty("--scrollbar-width");
    if (previousViewportWidth)
      root.style.setProperty("--viewport-width", previousViewportWidth);
    else root.style.removeProperty("--viewport-width");
    if (previousNativeWidth)
      root.style.setProperty("--native-scrollbar-width", previousNativeWidth);
    else root.style.removeProperty("--native-scrollbar-width");
  };
}
