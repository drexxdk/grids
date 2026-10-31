import {
  Disclosure,
  DisclosureButton,
  DisclosurePanel,
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
import type { ButtonHTMLAttributes, ReactNode, Ref } from "react";

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
  "tw:inline-flex tw:items-center tw:justify-center tw:gap-2 tw:rounded-md tw:border tw:border-solid tw:px-3 tw:py-2 tw:font-semibold tw:focus-visible:outline-2 tw:focus-visible:outline-offset-2 tw:focus-visible:outline-[var(--accent)] tw:disabled:cursor-not-allowed tw:disabled:opacity-50",
  {
    variants: {
      variant: {
        secondary:
          "tw:border-[var(--line)] tw:bg-transparent tw:text-[var(--text)] tw:hover:border-[var(--accent)]",
        primary:
          "tw:border-[var(--accent)] tw:bg-[var(--accent)] tw:text-[#19200d]",
        icon: "tw:size-[44px] tw:shrink-0 tw:border-[var(--line)] tw:bg-transparent tw:p-0 tw:hover:border-[var(--accent)]",
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
          "tw:relative tw:h-[24px] tw:w-[44px] tw:shrink-0 tw:rounded-full tw:border-0 tw:p-0 tw:after:absolute tw:after:-inset-y-[10px] tw:after:inset-x-0 tw:after:content-[''] tw:focus-visible:outline-2 tw:focus-visible:outline-offset-2 tw:focus-visible:outline-[var(--accent)]",
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
