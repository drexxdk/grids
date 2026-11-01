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
      className="flex w-fit overflow-hidden rounded-sm border border-solid border-(--line) max-[600px]:[&>button]:px-2! max-[600px]:[&>button]:text-[11px]"
    >
      {tabs.map((tab, index) => (
        <Tab
          key={tab.label}
          disabled={tab.disabled}
          title={tab.title}
          className={`min-h-11 border-0 bg-transparent px-3 text-(--muted) data-selected:bg-(--line) data-selected:text-(--accent) focus-visible:outline-2 focus-visible:outline-(--accent) focus-visible:-outline-offset-2! disabled:cursor-default disabled:opacity-50 ${index < tabs.length - 1 ? "border-r border-solid border-(--line)" : ""}`}
        >
          {tab.label}
        </Tab>
      ))}
    </TabList>
  );
}
