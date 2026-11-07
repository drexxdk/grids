import { OverlayScrollbars } from "overlayscrollbars";

export function attachOverlayScrollbar(
  target: HTMLElement,
  axis: "x" | "y" | "both" = "both",
) {
  const slot = document.createElement("div");
  slot.dataset.overlayScrollFrame = "";
  slot.style.pointerEvents = "none";
  target.after(slot);
  const position = () => {
    const bounds = target.getBoundingClientRect();
    const style = getComputedStyle(target);
    slot.style.display = target.getClientRects().length ? "" : "none";
    slot.style.position = style.position === "fixed" ? "fixed" : "absolute";
    slot.style.zIndex = style.zIndex;
    const parent = slot.offsetParent;
    let left = bounds.left + target.clientLeft;
    let top = bounds.top + target.clientTop;
    if (parent instanceof HTMLElement) {
      const parentBounds = parent.getBoundingClientRect();
      left += parent.scrollLeft - parentBounds.left - parent.clientLeft;
      top += parent.scrollTop - parentBounds.top - parent.clientTop;
    } else if (slot.style.position !== "fixed") {
      left += window.scrollX;
      top += window.scrollY;
    }
    Object.assign(slot.style, {
      left: `${left}px`,
      top: `${top}px`,
      width: `${target.clientWidth}px`,
      height: `${target.clientHeight}px`,
    });
  };
  position();
  const resizeObserver = new ResizeObserver(position);
  resizeObserver.observe(target);
  const positionObserver = new MutationObserver(position);
  positionObserver.observe(target, {
    attributes: true,
    attributeFilter: ["style"],
  });
  window.addEventListener("resize", position);
  return OverlayScrollbars(
    {
      target,
      elements: { viewport: target },
      scrollbars: { slot },
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
    {
      initialized: position,
      destroyed: () => {
        resizeObserver.disconnect();
        positionObserver.disconnect();
        window.removeEventListener("resize", position);
        slot.remove();
      },
    },
  );
}

export function installOverlayScrollbars() {
  const preventScrollbarDismissal = (event: Event) => {
    if (
      event.target instanceof Element &&
      event.target.closest("[data-overlay-scroll-frame]")
    )
      event.preventDefault();
  };
  const dismissalEvents = ["pointerup", "touchend", "click"];
  for (const type of dismissalEvents)
    window.addEventListener(type, preventScrollbarDismissal, true);
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
    for (const type of dismissalEvents)
      window.removeEventListener(type, preventScrollbarDismissal, true);
    observer.disconnect();
    for (const instance of instances.values()) instance.destroy();
    instances.clear();
  };
}
