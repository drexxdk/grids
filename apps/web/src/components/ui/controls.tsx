import { t } from "../../i18n";
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
  Label,
  Menu,
  MenuButton,
  MenuItem,
  MenuItems,
  Radio,
  RadioGroup,
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
  Fragment,
  useEffect,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type ReactNode,
  type Ref,
} from "react";

export function PercentField({
  id,
  label,
  value,
  min = 0,
  max = 100,
  step,
  onChange,
  disabled,
  valueText,
  outputId,
  outputValue,
}: {
  id: string;
  label: string;
  value: number;
  min?: number;
  max?: number;
  step?: number;
  onChange: (value: number) => void;
  disabled?: boolean;
  valueText?: string;
  outputId?: string;
  outputValue?: ReactNode;
}) {
  const percent = Math.max(
    0,
    Math.min(100, ((value - min) / (max - min)) * 100),
  );
  return (
    <div className="flex flex-col gap-2">
      <label className="field-label" htmlFor={id}>
        {label}{" "}
        <output id={outputId}>
          {outputValue ?? `${Number(percent.toFixed(1))}%`}
        </output>
      </label>
      <input
        id={id}
        type="range"
        min="0"
        max="100"
        step={step === undefined ? 1 : (step / (max - min)) * 100}
        value={percent}
        disabled={disabled}
        aria-valuetext={valueText}
        onChange={(event) =>
          onChange(
            Number(
              (min + (Number(event.target.value) / 100) * (max - min)).toFixed(
                6,
              ),
            ),
          )
        }
      />
    </div>
  );
}

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
  "inline-flex items-center justify-center gap-2 rounded-md border border-solid px-3 py-2 text-[11px] font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--accent) disabled:cursor-default disabled:opacity-50",
  {
    variants: {
      variant: {
        secondary: "",
        primary:
          "border-(--accent) bg-(--accent) text-[#19200d] [--control-hover-base:var(--accent)] enabled:hover:control-hover",
        success:
          "border-emerald-400 bg-emerald-600 text-white [--control-hover-base:var(--color-emerald-600)] enabled:hover:control-hover focus-visible:outline-emerald-400",
        danger:
          "border-red-400/40 bg-red-500/10 text-red-300 [--control-hover-base:color-mix(in_srgb,var(--color-red-500)_10%,var(--panel))] enabled:hover:control-hover focus-visible:outline-red-400",
        icon: "size-11 shrink-0 p-0",
      },
    },
    compoundVariants: [
      {
        variant: ["secondary", "icon"],
        className:
          "border-(--line) bg-(--bg) text-(--text) enabled:hover:not-aria-pressed:control-hover!",
      },
    ],
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
        "inline-flex gap-0 rounded-md bg-(--bg) [&>button]:relative [&>button]:rounded-none! [&>button]:bg-(--bg)! [&>button[aria-pressed=true]]:bg-(--selected)! [&>button[aria-pressed=true]:enabled:hover]:border-(--line)! [&>button[aria-pressed=true]]:cursor-default! [&>button:not([aria-pressed=true]):hover]:z-10 [&>button:focus-visible]:z-20",
        orientation === "vertical"
          ? "flex-col [&>button+button]:-mt-px [&>button:first-child]:rounded-t-md! [&>button:last-child]:rounded-b-md!"
          : "[&>button+button]:-ml-px [&>button:first-child]:rounded-l-md! [&>button:last-child]:rounded-r-md!",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function ChoiceButton({
  ref,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { ref?: Ref<HTMLButtonElement> }) {
  const disabled =
    props.disabled ||
    props["aria-disabled"] === true ||
    props["aria-disabled"] === "true";
  return <button {...props} ref={ref} disabled={disabled} />;
}

export function IconRadioField({
  id,
  label,
  value,
  options,
  columns,
  onChange,
  hideLabel = false,
}: {
  id: string;
  label: string;
  value: string;
  options: { value: string; label: string; icon?: LucideIcon }[];
  columns: 2 | 3;
  onChange: (value: string) => void;
  hideLabel?: boolean;
}) {
  return (
    <RadioGroup
      id={id}
      value={value}
      onChange={onChange}
      className="@container/radio flex flex-col gap-2"
    >
      <Label className={hideLabel ? "sr-only" : "field-label"}>{label}</Label>
      <div
        className={clsx(
          "isolate grid gap-0 rounded-md bg-(--bg)",
          columns === 3
            ? "grid-cols-3 @max-[260px]/radio:grid-cols-2"
            : "grid-cols-2",
        )}
      >
        {options.map(
          (
            { value: optionValue, label: optionLabel, icon: Icon },
            optionIndex,
          ) => (
            <Radio
              key={optionValue}
              as={ChoiceButton}
              type="button"
              value={optionValue}
              disabled={optionValue === value}
              data-value={optionValue}
              className={clsx(
                "relative flex min-h-11 min-w-0 items-center justify-center gap-1 rounded-none border border-solid border-(--line) bg-(--bg) px-1 py-2 text-(--muted) [--control-hover-base:var(--bg)] data-hover:z-10 enabled:data-hover:control-hover data-checked:bg-(--selected) data-checked:text-(--accent) data-checked:cursor-default! data-checked:opacity-100! focus-visible:z-20 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-(--accent)",
                optionIndex % columns !== 0 && "-ml-px",
                optionIndex >= columns && "-mt-px",
                optionIndex === 0 && "rounded-tl-md",
                optionIndex === columns - 1 && "rounded-tr-md",
                optionIndex === options.length - columns && "rounded-bl-md",
                optionIndex === options.length - 1 && "rounded-br-md",
                columns === 3 &&
                  optionIndex === 0 &&
                  "@max-[260px]/radio:rounded-bl-none",
                columns === 3 &&
                  optionIndex === 1 &&
                  "@max-[260px]/radio:rounded-tr-md",
                columns === 3 &&
                  optionIndex === 2 &&
                  "@max-[260px]/radio:col-span-2 @max-[260px]/radio:ml-0 @max-[260px]/radio:-mt-px @max-[260px]/radio:rounded-tr-none @max-[260px]/radio:rounded-bl-md",
              )}
            >
              {Icon && <Icon aria-hidden="true" className="size-4! shrink-0" />}
              <span className="min-w-0 text-center text-xs leading-4 wrap-break-word">
                {optionLabel}
              </span>
            </Radio>
          ),
        )}
      </div>
    </RadioGroup>
  );
}

export function SelectField({
  id,
  label,
  value,
  options,
  onChange,
  compact = false,
  largeFontPreview = false,
}: {
  id: string;
  label: string;
  value: string;
  options: {
    value: string;
    label: string;
    icon?: LucideIcon;
    fontFamily?: string;
    fontWeight?: number;
    disabled?: boolean;
    title?: string;
  }[];
  onChange: (value: string) => void;
  compact?: boolean;
  largeFontPreview?: boolean;
}) {
  const selected = options.find((option) => option.value === value);
  const SelectedIcon = selected?.icon;
  return (
    <Listbox
      as={compact ? Fragment : "div"}
      className={compact ? undefined : "flex flex-col gap-2"}
      value={value}
      onChange={onChange}
    >
      <ListboxLabel className={compact ? "sr-only" : "field-label"}>
        {label}
      </ListboxLabel>
      <ListboxButton
        id={id}
        title={
          compact
            ? t("common.fields.value", {
                value1: label,
                value2: selected?.label ?? value,
              })
            : undefined
        }
        className={clsx(
          "flex min-h-11 w-full items-center justify-between gap-2 rounded-sm border border-solid border-(--line) bg-(--bg) px-3 py-2 text-left enabled:data-hover:control-hover focus-visible:-outline-offset-3!",
          largeFontPreview && "py-0!",
          compact && "h-11 px-2! py-0!",
        )}
      >
        {SelectedIcon && (
          <SelectedIcon aria-hidden="true" className="size-4.5 shrink-0" />
        )}
        <span
          style={{
            fontFamily: selected?.fontFamily
              ? `"${selected.fontFamily}"`
              : undefined,
            fontWeight: selected?.fontWeight,
          }}
          className={clsx(
            compact
              ? "min-w-0 truncate text-[12px] max-[600px]:sr-only"
              : "min-w-0 wrap-break-word",
            largeFontPreview && "text-[20px] leading-7",
          )}
        >
          {selected?.label ?? value}
        </span>
        <ChevronDown aria-hidden="true" className="size-4 shrink-0" />
      </ListboxButton>
      <ListboxOptions
        data-overlay-scroll="y"
        anchor="bottom"
        modal={false}
        className={clsx(
          "z-70 w-(--button-width) max-w-[calc(100vw-24px)] rounded-sm border border-solid border-(--line) bg-(--panel) p-1 [--anchor-gap:4px] [--anchor-padding:12px]",
          compact && "min-w-42.5",
        )}
      >
        {options.map((option) => {
          const OptionIcon = option.icon;
          return (
            <ListboxOption
              as={ChoiceButton}
              type="button"
              key={option.value}
              value={option.value}
              disabled={option.disabled || option.value === value}
              title={option.title}
              data-value={option.value}
              style={{
                fontFamily: option.fontFamily
                  ? `"${option.fontFamily}"`
                  : undefined,
                fontWeight: option.fontWeight,
              }}
              className={clsx(
                "flex min-h-11 w-full items-center gap-2 rounded-none border-0 bg-transparent text-left cursor-pointer px-3 py-2 text-sm! wrap-break-word [--control-hover-base:var(--panel)] enabled:hover:control-hover enabled:data-focus:control-hover data-selected:bg-(--selected) data-selected:text-(--accent) data-disabled:cursor-default! data-disabled:opacity-50 data-disabled:data-selected:opacity-100!",
                largeFontPreview && "py-0! text-[20px]! leading-7",
              )}
            >
              {OptionIcon && (
                <OptionIcon aria-hidden="true" className="size-4.5 shrink-0" />
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
    <div className="@container/color flex min-w-0 flex-col gap-2">
      <label className="field-label" htmlFor={`${id}-value`}>
        {label}
      </label>
      <DataInteractive
        as="div"
        className="flex w-full min-w-0 items-center rounded-sm border border-solid border-(--line) bg-(--bg) focus-within:border-(--accent) transition-colors"
      >
        <DataInteractive
          as="input"
          id={id}
          type="color"
          value={value}
          aria-label={t("common.fields.colorPicker", { value1: label })}
          title={t("common.fields.colorPicker", { value1: label })}
          className="h-11 w-11 shrink-0 cursor-pointer border-0 bg-transparent p-1 data-hover:control-hover transition-colors @min-[220px]/color:w-16"
          onChange={(event) => onChange(event.target.value)}
        />
        <DataInteractive
          as="input"
          id={`${id}-value`}
          type="text"
          aria-label={t("common.fields.hexValue", { value1: label })}
          value={draft}
          spellCheck={false}
          autoComplete="off"
          maxLength={7}
          className="h-11! w-full min-w-0 flex-1 rounded-none! border-0! bg-transparent! px-2 text-(--text) outline-none data-hover:control-hover! transition-colors"
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
    </div>
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
    <div className="flex items-center justify-between gap-3">
      <span className="text-sm font-semibold">{label}</span>
      <Switch
        checked={checked}
        onChange={onChange}
        aria-label={label}
        className={clsx(
          "relative h-6 w-11 shrink-0 rounded-full border-0 p-0 after:absolute after:-inset-y-2.5 after:inset-x-0 after:content-[''] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--accent) transition-colors motion-reduce:transition-none",
          checked
            ? "bg-(--accent) [--control-hover-base:var(--accent)] enabled:hover:control-hover enabled:data-hover:control-hover"
            : "bg-(--selected) [--control-hover-base:var(--selected)] [--control-hover-tint:var(--text)] enabled:hover:control-hover enabled:data-hover:control-hover",
        )}
      >
        <m.span
          aria-hidden="true"
          initial={false}
          animate={{ x: checked ? 20 : 0 }}
          transition={{ duration: reduced ? 0 : 0.16 }}
          className="absolute top-1 left-1 size-4 rounded-full bg-(--panel)"
        />
      </Switch>
    </div>
  );
}

export function AccordionPanel({
  children,
  onReveal,
}: {
  children: ReactNode;
  onReveal?: (panel: HTMLDivElement) => void;
}) {
  const present = useIsPresent();
  const reduced = useReducedMotion();
  const panel = useRef<HTMLDivElement>(null);
  const reveal = () => {
    if (present && panel.current) onReveal?.(panel.current);
  };
  return (
    <DisclosurePanel
      static
      as={MotionDiv}
      ref={panel}
      inert={!present}
      aria-hidden={present ? undefined : true}
      initial={{ height: 0, opacity: 0 }}
      animate={{ height: "auto", opacity: 1 }}
      exit={{ height: 0, opacity: 0 }}
      motionTransition={{ duration: reduced ? 0 : 0.18 }}
      onUpdate={onReveal ? reveal : undefined}
      onAnimationComplete={onReveal ? reveal : undefined}
      className="overflow-hidden"
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
          <DisclosureButton className="flex w-full items-center justify-between gap-2 border-0 bg-transparent p-0 text-left [--control-hover-base:var(--panel)] data-hover:control-hover">
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
      className="border-0 border-b border-solid border-(--line)"
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
            className="flex min-h-11 w-full items-center justify-between gap-2 border-0 bg-transparent px-2 py-3 text-left text-sm aria-pressed:text-(--accent) [--control-hover-base:var(--panel)] enabled:hover:control-hover transition-colors"
          >
            <span>{title}</span>
            <ChevronDown
              aria-hidden="true"
              className={clsx(
                "size-4 transition-transform",
                open && "rotate-180",
              )}
            />
          </DisclosureButton>
          {open && expanded && (
            <DisclosurePanel className="px-2 pb-4">{children}</DisclosurePanel>
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
  const itemClass =
    "flex min-h-11 w-full items-center gap-2 rounded border-0 bg-transparent px-3 py-2 text-left text-[11px] no-underline [--control-hover-base:var(--panel)] not-data-disabled:hover:control-hover data-focus:control-hover data-disabled:opacity-50";
  return (
    <MenuItems
      data-overlay-scroll="y"
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
      className="z-50 w-48 max-w-[calc(100vw-2rem)] rounded-md border border-solid border-(--line) bg-(--panel) p-1 shadow-xl outline-none [--anchor-gap:8px]"
    >
      {actions.map(({ label, icon: Icon, onSelect, disabled }) => (
        <MenuItem key={label} disabled={disabled}>
          <button type="button" onClick={onSelect} className={itemClass}>
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
  label = t("editor.actions"),
  icon: Icon = MoreHorizontal,
  disabled = false,
}: {
  actions: MenuAction[];
  buttonRef: Ref<HTMLButtonElement>;
  label?: string;
  icon?: LucideIcon;
  disabled?: boolean;
}) {
  return (
    <Menu>
      {({ open }) => (
        <>
          <MenuButton
            as={Button}
            variant="icon"
            ref={buttonRef}
            aria-label={label}
            title={label}
            disabled={disabled}
          >
            <Icon aria-hidden="true" />
          </MenuButton>
          <AnimatePresence>
            {open && <ActionItems key="actions" actions={actions} />}
          </AnimatePresence>
        </>
      )}
    </Menu>
  );
}
