export function publishScrollbarWidth() {
  const root = document.documentElement;
  const previous = root.style.getPropertyValue("--scrollbar-width");
  const probe = document.createElement("div");
  probe.setAttribute("aria-hidden", "true");
  probe.style.cssText =
    "position:fixed;top:0;left:0;width:100%;height:0;visibility:hidden;pointer-events:none";
  document.body.append(probe);

  const update = () => {
    if (
      document.querySelector(
        '#headlessui-portal-root [role="dialog"][aria-modal="true"]',
      )
    )
      return;
    root.style.setProperty(
      "--scrollbar-width",
      `${Math.max(0, window.innerWidth - probe.offsetWidth)}px`,
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
    if (previous) root.style.setProperty("--scrollbar-width", previous);
    else root.style.removeProperty("--scrollbar-width");
  };
}
