import {
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type RefObject,
} from "react";

export function centerTextArea(field: HTMLTextAreaElement) {
  const padding = parseFloat(getComputedStyle(field).paddingBottom) || 0;
  const height = field.style.height;
  field.style.paddingTop = `${padding}px`;
  field.style.height = "0px";
  const content = field.scrollHeight - padding * 2;
  field.style.height = height;
  field.style.paddingTop = `${Math.max(padding, (field.clientHeight - content) / 2)}px`;
}

export function TextScrollbar({
  field,
  active,
  value,
  style,
  kind = "caption",
}: {
  field: RefObject<HTMLTextAreaElement | null>;
  active: boolean;
  value: string;
  style?: CSSProperties;
  kind?: "caption" | "heading";
}) {
  const [scroll, setScroll] = useState({
    top: 0,
    height: 0,
    contentHeight: 0,
  });
  const offset = useRef(0);
  useLayoutEffect(() => {
    const element = field.current;
    if (!element || !active) return;
    const update = () =>
      setScroll({
        top: element.scrollTop,
        height: element.clientHeight,
        contentHeight: element.scrollHeight,
      });
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    element.addEventListener("scroll", update);
    return () => {
      observer.disconnect();
      element.removeEventListener("scroll", update);
    };
  }, [field, active, value]);
  const scrollTo = (pointerY: number, track: HTMLDivElement) => {
    const element = field.current;
    if (!element) return;
    const bounds = track.getBoundingClientRect();
    const thumbHeight = Math.min(
      bounds.height,
      Math.max(16, (bounds.height * element.clientHeight) / element.scrollHeight),
    );
    element.scrollTop =
      Math.max(
        0,
        Math.min(
          1,
          (pointerY - bounds.top - offset.current) /
            Math.max(1, bounds.height - thumbHeight),
        ),
      ) *
      (element.scrollHeight - element.clientHeight);
  };
  if (!active || scroll.contentHeight <= scroll.height) return null;
  return (
    <div
      aria-hidden="true"
      data-caption-scrollbar={kind === "caption" || undefined}
      data-heading-scrollbar={kind === "heading" || undefined}
      className="absolute -right-3 z-50 w-2 touch-none rounded-sm bg-(--line) cursor-default!"
      style={style}
      onMouseDown={(event) => event.preventDefault()}
      onPointerDown={(event) => {
        event.preventDefault();
        const thumb =
          event.currentTarget.firstElementChild!.getBoundingClientRect();
        offset.current =
          event.target === event.currentTarget
            ? thumb.height / 2
            : event.clientY - thumb.top;
        event.currentTarget.setPointerCapture(event.pointerId);
        scrollTo(event.clientY, event.currentTarget);
      }}
      onPointerMove={(event) => {
        if (event.currentTarget.hasPointerCapture(event.pointerId))
          scrollTo(event.clientY, event.currentTarget);
      }}
      onPointerUp={(event) =>
        event.currentTarget.releasePointerCapture(event.pointerId)
      }
    >
      <div
        className="absolute inset-x-0 rounded-sm bg-(--accent)"
        style={{
          height: `min(100%, max(16px, ${(scroll.height / scroll.contentHeight) * 100}%))`,
          top: `calc((100% - min(100%, max(16px, ${(scroll.height / scroll.contentHeight) * 100}%))) * ${scroll.top / (scroll.contentHeight - scroll.height)})`,
        }}
      />
    </div>
  );
}
