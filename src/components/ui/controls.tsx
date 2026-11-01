import {
  DataInteractive,
  Disclosure,
  DisclosureButton,
  DisclosurePanel,
  Listbox,
  ListboxButton,
  ListboxLabel,
  ListboxOption,
  ListboxOptions,
  Menu,
  MenuButton,
  MenuItem,
  MenuItems,
  Switch,
} from "@headlessui/react";
import { cva, type VariantProps } from "class-variance-authority";
import clsx from "clsx";
import { ChevronDown, MoreHorizontal, type LucideIcon } from "lucide-react";
import {
  AnimatePresence,
  m,
  useIsPresent,
  useReducedMotion,
  type HTMLMotionProps,
  type Transition,
} from "motion/react";
import {
  useEffect,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type ReactNode,
  type Ref,
} from "react";

export function MotionDiv({
  motionTransition,
  ...props
}: HTMLMotionProps<"div"> & {
  motionTransition?: Transition;
  ref?: Ref<HTMLDivElement>;
}) {
  return <m.div {...props} transition={motionTransition} />;
}

const buttonStyles = cva(
  "tw:inline-flex tw:items-center tw:justify-center tw:gap-2 tw:rounded-md tw:border tw:border-solid tw:px-3 tw:py-2 tw:font-semibold tw:focus-visible:outline-2 tw:focus-visible:outline-offset-2 tw:focus-visible:outline-[var(--accent)] tw:disabled:cursor-default tw:disabled:opacity-50",
  {
    variants: {
      variant: {
        secondary:
          "tw:border-[var(--line)] tw:bg-transparent tw:text-[var(--text)] tw:enabled:hover:border-[var(--accent)]",
        primary:
          "tw:border-[var(--accent)] tw:bg-[var(--accent)] tw:text-[#19200d] tw:enabled:hover:brightness-110",
        icon: "tw:size-[44px] tw:shrink-0 tw:border-[var(--line)] tw:bg-transparent tw:p-0 tw:enabled:hover:border-[var(--accent)]!",
      },
    },
    defaultVariants: { variant: "secondary" },
  },
);

export function Button({
  variant,
  className,
  ref,
  type = "button",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> &
  VariantProps<typeof buttonStyles> & { ref?: Ref<HTMLButtonElement> }) {
  return (
    <button
      ref={ref}
      type={type}
      className={buttonStyles({ variant, className })}
      {...props}
    />
  );
}

export function ButtonGroup({
  label,
  orientation = "horizontal",
  className,
  children,
}: {
  label: string;
  orientation?: "horizontal" | "vertical";
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      role="group"
      aria-label={label}
      data-button-group={orientation}
      className={clsx(
        "tw:inline-flex tw:gap-0 tw:rounded-[6px] tw:bg-[#111315] tw:[&>button]:relative tw:[&>button]:rounded-none! tw:[&>button]:bg-[#111315]! tw:[&>button[aria-pressed=true]]:bg-(--line)! tw:[&>button[aria-pressed=true]:enabled:hover]:border-(--line)! tw:[&>button[aria-pressed=true]]:cursor-default! tw:[&>button:not([aria-pressed=true]):hover]:z-10 tw:[&>button:focus-visible]:z-20",
        orientation === "vertical"
          ? "tw:flex-col tw:[&>button+button]:mt-[-1px] tw:[&>button:first-child]:rounded-t-[6px]! tw:[&>button:last-child]:rounded-b-[6px]!"
          : "tw:[&>button+button]:ml-[-1px] tw:[&>button:first-child]:rounded-l-[6px]! tw:[&>button:last-child]:rounded-r-[6px]!",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function SelectField({
  id,
  label,
  value,
  options,
  onChange,
  compact = false,
}: {
  id: string;
  label: string;
  value: string;
  options: { value: string; label: string; icon?: LucideIcon }[];
  onChange: (value: string) => void;
  compact?: boolean;
}) {
  const selected = options.find((option) => option.value === value);
  const SelectedIcon = selected?.icon;
  return (
    <Listbox value={value} onChange={onChange}>
      <ListboxLabel className={compact ? "tw:sr-only" : "field-label"}>
        {label}
      </ListboxLabel>
      <ListboxButton
        id={id}
        title={compact ? `${label}: ${selected?.label ?? value}` : undefined}
        className={clsx(
          "tw:flex tw:min-h-[44px] tw:w-full tw:items-center tw:justify-between tw:gap-2 tw:rounded-sm tw:border tw:border-solid tw:border-(--line) tw:bg-(--bg) tw:px-3 tw:py-2 tw:text-left tw:data-hover:border-(--accent)",
          compact && "tw:h-[44px] tw:px-2! tw:py-0!",
        )}
      >
        {SelectedIcon && (
          <SelectedIcon
            aria-hidden="true"
            className="tw:size-[18px] tw:shrink-0"
          />
        )}
        <span
          className={
            compact
              ? "tw:min-w-0 tw:truncate tw:text-[12px] tw:max-[600px]:sr-only"
              : "tw:min-w-0 tw:break-words"
          }
        >
          {selected?.label ?? value}
        </span>
        <ChevronDown aria-hidden="true" className="tw:size-4 tw:shrink-0" />
      </ListboxButton>
      <ListboxOptions
        anchor="bottom"
        modal={false}
        className={clsx(
          "tw:z-70 tw:w-(--button-width) tw:max-w-[calc(100vw-24px)] tw:rounded-sm tw:border tw:border-solid tw:border-(--line) tw:bg-(--panel) tw:p-1 tw:[--anchor-gap:4px] tw:[--anchor-padding:12px]",
          compact && "tw:min-w-[170px]",
        )}
      >
        {options.map((option) => {
          const OptionIcon = option.icon;
          return (
            <ListboxOption
              key={option.value}
              value={option.value}
              data-value={option.value}
              className="tw:flex tw:min-h-[44px] tw:items-center tw:gap-2 tw:cursor-pointer tw:px-3 tw:py-2 tw:text-sm tw:break-words tw:data-focus:bg-(--line) tw:data-selected:text-(--accent)"
            >
              {OptionIcon && (
                <OptionIcon
                  aria-hidden="true"
                  className="tw:size-[18px] tw:shrink-0"
                />
              )}
              {option.label}
            </ListboxOption>
          );
        })}
      </ListboxOptions>
    </Listbox>
  );
}

export function ColorField({
  id,
  label,
  value,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const [draft, setDraft] = useState(value.toUpperCase());
  useEffect(() => setDraft(value.toUpperCase()), [value]);
  const normalize = (text: string) =>
    /^#?[a-f\d]{6}$/i.test(text)
      ? `#${text.replace(/^#/, "").toLowerCase()}`
      : null;
  return (
    <>
      <label className="field-label" htmlFor={`${id}-value`}>
        {label}
      </label>
      <DataInteractive
        as="div"
        className="tw:flex tw:w-full tw:min-w-0 tw:items-center tw:rounded-sm tw:border tw:border-solid tw:border-(--line) tw:bg-(--panel) tw:data-hover:border-(--accent) tw:focus-within:border-(--accent) tw:transition-colors"
      >
        <DataInteractive
          as="input"
          id={id}
          type="color"
          value={value}
          aria-label={`${label} color picker`}
          title={`${label} color picker`}
          className="tw:h-[44px] tw:w-[64px] tw:shrink-0 tw:cursor-pointer tw:border-0 tw:bg-transparent tw:p-1 tw:data-hover:bg-(--line) tw:transition-colors"
          onChange={(event) => onChange(event.target.value)}
        />
        <DataInteractive
          as="input"
          id={`${id}-value`}
          type="text"
          aria-label={`${label} hex value`}
          value={draft}
          spellCheck={false}
          autoComplete="off"
          maxLength={7}
          className="tw:h-[44px]! tw:w-full tw:min-w-0 tw:flex-1 tw:rounded-none! tw:border-0! tw:bg-transparent! tw:px-2 tw:text-(--text) tw:outline-none tw:data-hover:bg-(--line)! tw:transition-colors"
          onChange={(event) => {
            setDraft(event.target.value);
            const color = normalize(event.target.value);
            if (color) onChange(color);
          }}
          onBlur={() => setDraft(value.toUpperCase())}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              setDraft(value.toUpperCase());
              event.currentTarget.blur();
            } else if (event.key === "Enter") {
              event.preventDefault();
              event.currentTarget.blur();
            }
          }}
        />
      </DataInteractive>
    </>
  );
}

export function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
}) {
  const reduced = useReducedMotion();
  return (
    <div className="tw:flex tw:items-center tw:justify-between tw:gap-3 tw:py-3">
      <span className="tw:text-sm tw:font-semibold">{label}</span>
      <Switch
        checked={checked}
        onChange={onChange}
        aria-label={label}
        className={clsx(
          "tw:relative tw:h-[24px] tw:w-[44px] tw:shrink-0 tw:rounded-full tw:border-0 tw:p-0 tw:after:absolute tw:after:-inset-y-[10px] tw:after:inset-x-0 tw:after:content-[''] tw:focus-visible:outline-2 tw:focus-visible:outline-offset-2 tw:focus-visible:outline-[var(--accent)] tw:enabled:hover:brightness-110 tw:enabled:hover:ring-2 tw:enabled:hover:ring-(--accent)/40 tw:transition-[filter,box-shadow] tw:motion-reduce:transition-none",
          checked ? "tw:bg-[var(--accent)]" : "tw:bg-[var(--line)]",
        )}
      >
        <m.span
          aria-hidden="true"
          initial={false}
          animate={{ x: checked ? 20 : 0 }}
          transition={{ duration: reduced ? 0 : 0.16 }}
          className="tw:absolute tw:top-[4px] tw:left-[4px] tw:size-[16px] tw:rounded-full tw:bg-[var(--panel)]"
        />
      </Switch>
    </div>
  );
}

function AccordionPanel({ children }: { children: ReactNode }) {
  const present = useIsPresent();
  const reduced = useReducedMotion();
  return (
    <DisclosurePanel
      static
      as={MotionDiv}
      inert={!present}
      aria-hidden={present ? undefined : true}
      initial={{ height: 0, opacity: 0 }}
      animate={{ height: "auto", opacity: 1 }}
      exit={{ height: 0, opacity: 0 }}
      motionTransition={{ duration: reduced ? 0 : 0.18 }}
      className="tw:overflow-hidden"
    >
      {children}
    </DisclosurePanel>
  );
}

export function Accordion({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  const reduced = useReducedMotion();
  return (
    <Disclosure as="section" defaultOpen className="settings-section">
      {({ open }) => (
        <>
          <DisclosureButton className="tw:flex tw:w-full tw:items-center tw:justify-between tw:gap-2 tw:border-0 tw:bg-transparent tw:p-0 tw:text-left">
            <span className="eyebrow">{title}</span>
            <m.span
              animate={{ rotate: open ? 180 : 0 }}
              transition={{ duration: reduced ? 0 : 0.18 }}
            >
              <ChevronDown aria-hidden="true" />
            </m.span>
          </DisclosureButton>
          <AnimatePresence initial={false}>
            {open && <AccordionPanel key="panel">{children}</AccordionPanel>}
          </AnimatePresence>
        </>
      )}
    </Disclosure>
  );
}

export function TemplateAccordion({
  title,
  selected,
  expanded,
  onToggle,
  children,
}: {
  title: string;
  selected: boolean;
  expanded: boolean;
  onToggle: (expanded: boolean) => void;
  children: ReactNode;
}) {
  const trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const open = trigger.current?.getAttribute("aria-expanded") === "true";
    if (open !== expanded) trigger.current?.click();
  }, [expanded]);
  return (
    <Disclosure
      as="section"
      defaultOpen={expanded}
      className="tw:border-0 tw:border-b tw:border-solid tw:border-(--line)"
    >
      {({ open }) => (
        <>
          <DisclosureButton
            ref={trigger}
            aria-pressed={selected}
            onClick={() => {
              const next =
                trigger.current?.getAttribute("aria-expanded") !== "true";
              if (next !== expanded) onToggle(next);
            }}
            className="tw:flex tw:min-h-[44px] tw:w-full tw:items-center tw:justify-between tw:gap-2 tw:border-0 tw:bg-transparent tw:px-2 tw:py-3 tw:text-left tw:text-sm tw:aria-pressed:text-(--accent) tw:enabled:hover:bg-(--line) tw:transition-colors"
          >
            <span>{title}</span>
            <ChevronDown
              aria-hidden="true"
              className={clsx(
                "tw:size-4 tw:transition-transform",
                open && "tw:rotate-180",
              )}
            />
          </DisclosureButton>
          {open && expanded && (
            <DisclosurePanel className="tw:px-2 tw:pb-4">
              {children}
            </DisclosurePanel>
          )}
        </>
      )}
    </Disclosure>
  );
}

type MenuAction = {
  label: string;
  icon: LucideIcon;
  onSelect: () => void;
  disabled?: boolean;
};

function ActionItems({ actions }: { actions: MenuAction[] }) {
  const present = useIsPresent();
  const reduced = useReducedMotion();
  return (
    <MenuItems
      static
      modal={false}
      anchor="bottom end"
      as={MotionDiv}
      inert={!present}
      aria-hidden={present ? undefined : true}
      initial={{ opacity: 0, y: -4 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -4 }}
      motionTransition={{ duration: reduced ? 0 : 0.14 }}
      className="tw:z-50 tw:w-48 tw:max-w-[calc(100vw-2rem)] tw:rounded-md tw:border tw:border-solid tw:border-[var(--line)] tw:bg-[var(--panel)] tw:p-1 tw:shadow-xl tw:outline-none tw:[--anchor-gap:8px]"
    >
      {actions.map(({ label, icon: Icon, onSelect, disabled }) => (
        <MenuItem key={label} disabled={disabled}>
          <button
            type="button"
            onClick={onSelect}
            className="tw:flex tw:w-full tw:items-center tw:gap-2 tw:rounded tw:border-0 tw:bg-transparent tw:px-3 tw:py-2 tw:text-left tw:data-focus:bg-[var(--line)] tw:data-disabled:opacity-50"
          >
            <Icon aria-hidden="true" />
            {label}
          </button>
        </MenuItem>
      ))}
    </MenuItems>
  );
}

export function ActionMenu({
  actions,
  buttonRef,
}: {
  actions: MenuAction[];
  buttonRef: Ref<HTMLButtonElement>;
}) {
  return (
    <Menu>
      {({ open }) => (
        <>
          <MenuButton
            as={Button}
            variant="icon"
            ref={buttonRef}
            aria-label="Grid actions"
            title="Grid actions"
          >
            <MoreHorizontal aria-hidden="true" />
          </MenuButton>
          <AnimatePresence>
            {open && <ActionItems key="actions" actions={actions} />}
          </AnimatePresence>
        </>
      )}
    </Menu>
  );
}
