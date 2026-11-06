import type { LucideIcon } from "lucide-react";
import { useLayoutEffect, useRef, useState } from "react";

export function ImageTabs({
  id,
  label,
  tabs,
  selectedIndex,
  onChange,
  square = false,
  vertical = false,
}: {
  id: string;
  label: string;
  square?: boolean;
  vertical?: boolean;
  selectedIndex: number;
  onChange: (index: number) => void;
  tabs: {
    label: string;
    disabled?: boolean;
    title?: string;
    icon?: LucideIcon;
  }[];
}) {
  const listRef = useRef<HTMLDivElement>(null);
  const [iconsOnly, setIconsOnly] = useState(false);
  const canCollapse = !vertical && tabs.every((tab) => tab.icon);
  useLayoutEffect(() => {
    const list = listRef.current;
    if (!list || !canCollapse) return;
    // Per-tab chrome beyond the label: padding 16 + border 2 + icon 20 + gap 8.
    const update = () => {
      const spans = list.querySelectorAll<HTMLElement>("[role=tab] > span");
      const widest = Math.max(...[...spans].map((span) => span.scrollWidth));
      setIconsOnly(widest + 46 > list.clientWidth / tabs.length);
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(list);
    return () => observer.disconnect();
  }, [canCollapse, tabs]);
  return (
    <div
      ref={listRef}
      role="tablist"
      aria-orientation={vertical ? "vertical" : "horizontal"}
      aria-label={label}
      className={`isolate grid ${vertical ? `h-full w-11 grid-cols-1 ${tabs.length === 3 ? "grid-rows-3" : "grid-rows-2"} [&>button]:h-auto! [&>button+button]:-mt-px` : `w-full ${tabs.length === 3 ? "grid-cols-3" : "grid-cols-2"} [&>button]:h-11! [&>button+button]:-ml-px`} gap-0 ${square ? "rounded-none" : "rounded-md"} bg-(--bg) [&>button]:relative [&>button]:min-w-0 [&>button]:w-auto! [&>button]:flex-row! [&>button]:gap-2! [&>button]:rounded-none! [&>button]:border [&>button]:border-solid [&>button]:border-(--line) [&>button]:bg-(--bg)! [&>button]:px-2! [&>button]:py-2! ${square ? "[&>button:first-child]:rounded-l-none! [&>button:last-child]:rounded-r-none!" : "[&>button:first-child]:rounded-l-md! [&>button:last-child]:rounded-r-md!"} [&>button[data-selected]]:bg-(--selected)! [&>button:enabled:hover]:z-10 [&>button:enabled:hover]:border-(--accent)! [&>button:focus-visible]:z-20 [&_svg]:size-5! [&_svg]:shrink-0 ${vertical || iconsOnly ? "[&>button>span]:sr-only" : "[&>button>span]:not-sr-only"} [&>button>span]:min-w-0 [&>button>span]:text-center [&>button>span]:text-xs [&>button>span]:leading-4 [&>button>span]:font-normal [&>button>span]:whitespace-nowrap`}
    >
      {tabs.map((tab, index) => (
        <button
          key={tab.label}
          type="button"
          role="tab"
          id={`${id}-tab-${index}`}
          aria-controls={`${id}-panel-${index}`}
          aria-selected={index === selectedIndex}
          data-selected={index === selectedIndex ? "" : undefined}
          disabled={tab.disabled || index === selectedIndex}
          tabIndex={tab.disabled || index === selectedIndex ? -1 : 0}
          onClick={() => onChange(index)}
          onKeyDown={(event) => {
            const previousKey = vertical ? "ArrowUp" : "ArrowLeft";
            const nextKey = vertical ? "ArrowDown" : "ArrowRight";
            if (![previousKey, nextKey, "Home", "End"].includes(event.key))
              return;
            event.preventDefault();
            const available = [
              ...event.currentTarget.parentElement!.querySelectorAll<HTMLButtonElement>(
                '[role="tab"]:not(:disabled)',
              ),
            ];
            const current = available.indexOf(event.currentTarget);
            const next =
              event.key === "Home"
                ? 0
                : event.key === "End"
                  ? available.length - 1
                  : (current +
                      (event.key === nextKey ? 1 : -1) +
                      available.length) %
                    available.length;
            available[next]?.focus();
          }}
          title={tab.title ?? tab.label}
          aria-label={tab.label}
          className="flex min-h-11 items-center justify-center border-0 bg-transparent text-(--muted) data-selected:bg-(--selected) data-selected:text-(--accent) focus-visible:outline-2 focus-visible:outline-(--accent) focus-visible:-outline-offset-2! disabled:cursor-default! disabled:opacity-50 data-selected:disabled:opacity-100!"
        >
          {tab.icon && <tab.icon aria-hidden="true" />}
          <span>{tab.label}</span>
        </button>
      ))}
    </div>
  );
}
