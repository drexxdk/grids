export function publishScrollbarWidth() {
  const root = document.documentElement;
  const previous = root.style.getPropertyValue("--scrollbar-width");
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

  const publish = (name: string, value: string) => {
    if (root.style.getPropertyValue(name) !== value)
      root.style.setProperty(name, value);
  };
  const update = () => {
    const viewportWidth = window.innerWidth;
    const nativeWidth = Math.max(
      0,
      scrollProbe.offsetWidth - scrollProbe.clientWidth,
    );
    const modalScroll = document.querySelector<HTMLElement>(
      "#headlessui-portal-root [data-modal-scroll]",
    );
    const modalInset = modalScroll
      ? Math.max(0, modalScroll.offsetWidth - modalScroll.clientWidth)
      : 0;
    const modalOpen = document.querySelector(
      '#headlessui-portal-root [role="dialog"][aria-modal="true"]',
    );
    const scrollbarWidth = modalOpen
      ? null
      : Math.max(
          0,
          viewportWidth -
            probe.offsetWidth +
            parseFloat(getComputedStyle(root).paddingRight),
        );
    publish("--native-scrollbar-width", `${nativeWidth}px`);
    publish("--fixed-scrollbar-inset", `${modalInset}px`);
    if (scrollbarWidth !== null)
      publish("--scrollbar-width", `${scrollbarWidth}px`);
  };

  update();
  window.addEventListener("resize", update);
  const observer = new MutationObserver((records) => {
    if (
      records.some(
        ({ target }) =>
          target === document.body ||
          (target instanceof Element &&
            target.closest("#headlessui-portal-root")),
      )
    )
      update();
  });
  observer.observe(document.body, { childList: true, subtree: true });

  return () => {
    observer.disconnect();
    window.removeEventListener("resize", update);
    probe.remove();
    scrollProbe.remove();
    if (previous) root.style.setProperty("--scrollbar-width", previous);
    else root.style.removeProperty("--scrollbar-width");
    if (previousNativeWidth)
      root.style.setProperty("--native-scrollbar-width", previousNativeWidth);
    else root.style.removeProperty("--native-scrollbar-width");
  };
}
