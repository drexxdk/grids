import { OverlayScrollbars } from "overlayscrollbars";

export function attachOverlayScrollbar(
  target: HTMLElement,
  axis: "x" | "y" | "both" = "both",
) {
  return OverlayScrollbars(
    {
      target,
      elements: { viewport: target },
      scrollbars: { slot: target },
    },
    {
      overflow: {
        x: axis === "y" ? "hidden" : "scroll",
        y: axis === "x" ? "hidden" : "scroll",
      },
      scrollbars: {
        theme: "os-theme-gridz",
        autoHide: "never",
        clickScroll: "instant",
        pointers: ["mouse", "pen"],
      },
    },
  );
}

export function installOverlayScrollbars() {
  const instances = new Map<
    HTMLElement,
    ReturnType<typeof attachOverlayScrollbar>
  >();
  const synchronize = (target: HTMLElement) => {
    const axis = target.dataset.overlayScroll;
    const existing = instances.get(target);
    if (axis !== "x" && axis !== "y" && axis !== "both") {
      existing?.destroy();
      instances.delete(target);
      return;
    }
    if (existing) {
      existing.options({
        overflow: {
          x: axis === "y" ? "hidden" : "scroll",
          y: axis === "x" ? "hidden" : "scroll",
        },
      });
    } else {
      instances.set(target, attachOverlayScrollbar(target, axis));
    }
  };
  const discover = (node: Node) => {
    if (!(node instanceof HTMLElement)) return;
    if (node.hasAttribute("data-overlay-scroll")) synchronize(node);
    node
      .querySelectorAll<HTMLElement>("[data-overlay-scroll]")
      .forEach(synchronize);
  };
  discover(document.body);
  const observer = new MutationObserver((records) => {
    for (const record of records) {
      if (record.type === "attributes" && record.target instanceof HTMLElement)
        synchronize(record.target);
      for (const node of record.addedNodes) discover(node);
    }
    for (const [target, instance] of instances) {
      if (!target.isConnected) {
        instance.destroy();
        instances.delete(target);
      }
    }
  });
  observer.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["data-overlay-scroll"],
  });
  return () => {
    observer.disconnect();
    for (const instance of instances.values()) instance.destroy();
    instances.clear();
  };
}
