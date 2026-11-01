import type { LucideIcon } from "lucide-react";
import { t } from "../../i18n";
import { SelectField } from "./controls";

export function ImageSourceSelect({ id }: { id: string }) {
  return (
    <SelectField
      id={id}
      label={t("library.source.label")}
      value="imported"
      onChange={() => {}}
      options={[
        { value: "imported", label: t("library.source.imported") },
        {
          value: "online",
          label: t("library.source.online"),
          disabled: true,
          title: t("library.source.unavailable"),
        },
      ]}
    />
  );
}

export function ImageTabs({
  id,
  label,
  tabs,
  selectedIndex,
  onChange,
}: {
  id: string;
  label: string;
  selectedIndex: number;
  onChange: (index: number) => void;
  tabs: {
    label: string;
    disabled?: boolean;
    title?: string;
    icon?: LucideIcon;
  }[];
}) {
  return (
    <div
      role="tablist"
      aria-orientation="horizontal"
      aria-label={label}
      className="isolate grid w-full grid-cols-2 gap-0 rounded-md bg-(--bg) [&>button]:relative [&>button]:min-w-0 [&>button]:h-20! [&>button]:w-auto! [&>button]:flex-col! [&>button]:gap-2! [&>button]:rounded-none! [&>button]:border [&>button]:border-solid [&>button]:border-(--line) [&>button]:bg-(--bg)! [&>button]:px-1! [&>button]:py-2! [&>button+button]:-ml-px [&>button:first-child]:rounded-l-md! [&>button:last-child]:rounded-r-md! [&>button[data-selected]]:bg-(--selected)! [&>button:enabled:hover]:z-10 [&>button:enabled:hover]:border-(--accent)! [&>button:focus-visible]:z-20 [&_svg]:size-6! [&>button>span]:not-sr-only [&>button>span]:w-full [&>button>span]:text-center [&>button>span]:text-xs [&>button>span]:leading-4 [&>button>span]:font-normal [&>button>span]:wrap-break-word"
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
            if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key))
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
                      (event.key === "ArrowRight" ? 1 : -1) +
                      available.length) %
                    available.length;
            available[next]?.focus();
          }}
          title={tab.title ?? tab.label}
          aria-label={tab.label}
          className="flex min-h-20 items-center justify-center border-0 bg-transparent text-(--muted) data-selected:bg-(--selected) data-selected:text-(--accent) focus-visible:outline-2 focus-visible:outline-(--accent) focus-visible:-outline-offset-2! disabled:cursor-default! disabled:opacity-50 data-selected:disabled:opacity-100!"
        >
          {tab.icon && <tab.icon aria-hidden="true" />}
          <span>{tab.label}</span>
        </button>
      ))}
    </div>
  );
}
