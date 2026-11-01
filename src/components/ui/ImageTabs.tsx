import { Tab, TabList } from "@headlessui/react";

export function ImageTabs({
  label,
  tabs,
}: {
  label: string;
  tabs: { label: string; disabled?: boolean; title?: string }[];
}) {
  return (
    <TabList
      aria-label={label}
      className="tw:flex tw:w-fit tw:overflow-hidden tw:rounded-[4px] tw:border tw:border-solid tw:border-(--line) tw:max-[600px]:[&>button]:px-2! tw:max-[600px]:[&>button]:text-[11px]"
    >
      {tabs.map((tab, index) => (
        <Tab
          key={tab.label}
          disabled={tab.disabled}
          title={tab.title}
          className={`tw:min-h-[44px] tw:border-0 tw:bg-transparent tw:px-3 tw:text-(--muted) tw:data-selected:bg-(--line) tw:data-selected:text-(--accent) tw:focus-visible:outline-2 tw:focus-visible:outline-(--accent) tw:focus-visible:-outline-offset-2! tw:disabled:cursor-default tw:disabled:opacity-50 ${index < tabs.length - 1 ? "tw:border-r tw:border-solid tw:border-(--line)" : ""}`}
        >
          {tab.label}
        </Tab>
      ))}
    </TabList>
  );
}
