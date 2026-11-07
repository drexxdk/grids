import {
  ChevronDown,
  SlidersHorizontal,
  RectangleVertical,
  RectangleHorizontal,
  Square,
  PanelTop,
  PanelBottom,
  PanelTopDashed,
  PanelBottomDashed,
} from "lucide-react";
import { useRef, type ReactNode } from "react";
import {
  Disclosure,
  DisclosureButton,
  Radio,
  RadioGroup,
} from "@headlessui/react";
import { AnimatePresence } from "motion/react";
import { fontOptions, resolveFontWeight, type Board } from "../model";
import { t } from "../i18n";
import {
  AccordionPanel,
  ChoiceButton,
  ColorField,
  IconRadioField,
  PercentField,
  SelectField,
  Toggle,
} from "./ui/controls";

const palettes = [
  {
    name: "Snow",
    background: "#ffffff",
    surface: "#f1f3f2",
    text: "#202325",
    overlay: "#ffffff",
  },
  {
    name: "Ink",
    background: "#17191b",
    surface: "#23272b",
    text: "#eef1f3",
    overlay: "#111315",
  },
  {
    name: "Forest",
    background: "#18382b",
    surface: "#244b3a",
    text: "#f0f3df",
    overlay: "#18382b",
  },
  {
    name: "Ocean",
    background: "#123d51",
    surface: "#1c5167",
    text: "#def5f4",
    overlay: "#123d51",
  },
  {
    name: "Rose",
    background: "#613745",
    surface: "#754957",
    text: "#ffe6e9",
    overlay: "#613745",
  },
  {
    name: "Sun",
    background: "#f4ca36",
    surface: "#fff0a3",
    text: "#222222",
    overlay: "#fff0a3",
  },
] as const;

function revealAccordion(accordion: HTMLElement) {
  let scroller = accordion.parentElement;
  while (
    scroller &&
    !/^(auto|scroll)$/.test(getComputedStyle(scroller).overflowY)
  ) {
    scroller = scroller.parentElement;
  }
  if (!scroller) return;
  const bounds = scroller.getBoundingClientRect();
  const sticky = scroller.querySelector<HTMLElement>(
    ":scope > [data-sidebar-sticky]",
  );
  const padding = getComputedStyle(
    accordion.closest<HTMLElement>("[data-sidebar-panels]") ?? scroller,
  );
  const top =
    Math.max(
      bounds.top + scroller.clientTop,
      sticky?.getBoundingClientRect().bottom ?? bounds.top,
    ) + parseFloat(padding.paddingTop);
  const bottom =
    bounds.top +
    scroller.clientTop +
    scroller.clientHeight -
    parseFloat(padding.paddingBottom);
  const content = accordion.getBoundingClientRect();
  const available = bottom - top;
  const delta =
    content.height > available || content.top < top
      ? content.top - top
      : content.bottom > bottom
        ? content.bottom - bottom
        : 0;
  if (delta !== 0) scroller.scrollTop += delta;
}

function revealDesignPanel(panel: HTMLDivElement) {
  const accordion = panel.closest<HTMLElement>("[data-design-accordion]");
  if (accordion) revealAccordion(accordion);
}

export function ThemeBuilder({
  board,
  disabled,
  onChange,
  children,
}: {
  board: Board;
  disabled: boolean;
  onChange: (patch: Partial<Board>) => void;
  children: [ReactNode, ReactNode, ReactNode, ReactNode];
}) {
  const closeSection = useRef<((focus?: HTMLElement) => void) | null>(null);
  const selectedPalette = palettes.find(
    (palette) =>
      board.background.toLowerCase() === palette.background &&
      board.cellBackgroundColor?.toLowerCase() === palette.surface &&
      board.headingBackgroundColor?.toLowerCase() === palette.background &&
      board.headingTextColor?.toLowerCase() === palette.text &&
      board.cellTextColor?.toLowerCase() === palette.text &&
      board.captionOverlayColor?.toLowerCase() === palette.overlay,
  );
  const appliedPalette =
    selectedPalette ??
    palettes.find((palette) => palette.name === board.colorTheme);
  const colorsModified = !selectedPalette;
  const steps = [
    {
      title: t("builder.colors"),
      summary: appliedPalette
        ? colorsModified
          ? t("builder.modifiedNamed", {
              value1: t(`builder.palettes.${appliedPalette.name}`),
            })
          : t(`builder.palettes.${appliedPalette.name}`)
        : t("builder.custom"),
    },
    {
      title: t("builder.layout"),
      summary: t(`editor.imageShape.${board.imageAspect ?? "square"}`),
    },
    {
      title: t("builder.heading"),
      summary: board.headingVisible ? board.headingFont : t("builder.off"),
    },
    {
      title: t("builder.captions"),
      summary:
        board.titlesVisible !== false ? board.cellFont : t("builder.off"),
    },
  ];
  return (
    <section
      aria-label={t("presets.title")}
      data-theme-builder
      className="flex min-w-0 flex-col"
    >
      {steps.map((item, index) => (
        <Disclosure
          as="section"
          key={item.title}
          defaultOpen={index === 0}
          data-design-accordion
          className="min-w-0 border-0 border-b border-solid border-(--line) last:border-b-0"
        >
          {({ open, close }) => (
            <>
              <h3 className="m-0 text-sm">
                <DisclosureButton
                  ref={(element: HTMLButtonElement | null) => {
                    if (element && open) closeSection.current = close;
                  }}
                  type="button"
                  onClick={(event) => {
                    if (!open) {
                      closeSection.current?.(event.currentTarget);
                      closeSection.current = close;
                    }
                  }}
                  className="relative flex min-h-14 w-full items-center gap-3 rounded-none! border-0! bg-transparent! py-3! pr-12! pl-3! text-left text-sm! data-hover:bg-(--selected)! focus-visible:-outline-offset-3!"
                >
                  <span
                    className={`flex size-6 shrink-0 items-center justify-center rounded-full text-xs ${open ? "bg-(--accent) text-(--bg)" : "bg-(--selected) text-(--muted)"}`}
                  >
                    {index + 1}
                  </span>
                  <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span>{item.title}</span>
                    <span className="truncate text-xs font-normal text-(--muted)">
                      {item.summary}
                    </span>
                  </span>
                  <span className="pointer-events-none absolute inset-y-0 right-0 flex aspect-square items-center justify-center">
                    <ChevronDown
                      aria-hidden="true"
                      className={`size-4! ${open ? "rotate-180" : ""}`}
                    />
                  </span>
                </DisclosureButton>
              </h3>
              <AnimatePresence initial={false}>
                {open && (
                  <AccordionPanel key="panel" onReveal={revealDesignPanel}>
                    <fieldset
                      id={`theme-step-${index}`}
                      disabled={disabled}
                      className="m-0 flex min-w-0 flex-col gap-4 border-0 p-3"
                    >
                      {index === 0 && (
                        <RadioGroup
                          value={selectedPalette?.name ?? ""}
                          onChange={(name) => {
                            const palette = palettes.find(
                              (item) => item.name === name,
                            );
                            if (palette)
                              onChange({
                                colorTheme: palette.name,
                                background: palette.background,
                                headingBackgroundColor: palette.background,
                                headingTextColor: palette.text,
                                cellBackgroundColor: palette.surface,
                                cellTextColor: palette.text,
                                captionOverlayColor: palette.overlay,
                              });
                          }}
                          aria-label={t("builder.colors")}
                          className="grid grid-cols-3 gap-2"
                        >
                          {palettes.map((palette) => (
                            <Radio
                              as={ChoiceButton}
                              key={palette.name}
                              type="button"
                              value={palette.name}
                              disabled={selectedPalette === palette}
                              title={t(`builder.palettes.${palette.name}`)}
                              className="group flex min-h-18 min-w-0 flex-col items-center gap-2 rounded-md border border-solid border-(--line) bg-transparent! p-2! text-xs! aria-checked:border-(--accent)! data-hover:border-(--accent) focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-(--accent) disabled:opacity-100!"
                            >
                              <span
                                aria-hidden="true"
                                className="flex h-7 w-full overflow-hidden rounded-sm"
                              >
                                <span
                                  className="flex-1"
                                  style={{
                                    backgroundColor: palette.background,
                                  }}
                                />
                                <span
                                  className="flex-1"
                                  style={{ backgroundColor: palette.surface }}
                                />
                                <span
                                  className="w-3"
                                  style={{ backgroundColor: palette.text }}
                                />
                              </span>
                              <span>
                                {t(`builder.palettes.${palette.name}`)}
                              </span>
                            </Radio>
                          ))}
                        </RadioGroup>
                      )}
                      {index === 1 && (
                        <>
                          <IconRadioField
                            id="image-shape"
                            label={t("editor.imageShape.label")}
                            value={board.imageAspect ?? "square"}
                            columns={3}
                            options={[
                              {
                                value: "portrait",
                                label: t("editor.imageShape.portrait"),
                                icon: RectangleVertical,
                              },
                              {
                                value: "landscape",
                                label: t("editor.imageShape.landscape"),
                                icon: RectangleHorizontal,
                              },
                              {
                                value: "square",
                                label: t("editor.imageShape.square"),
                                icon: Square,
                              },
                            ]}
                            onChange={(imageAspect) =>
                              onChange({
                                imageAspect:
                                  imageAspect as Board["imageAspect"],
                              })
                            }
                          />
                          <SelectField
                            id="builder-spacing"
                            label={t("builder.spacing")}
                            value={
                              board.gap === 0 && board.canvasPadding === 0
                                ? "flush"
                                : board.gap === 24 && board.canvasPadding === 36
                                  ? "compact"
                                  : board.gap === 60 &&
                                      board.canvasPadding === 60
                                    ? "airy"
                                    : "custom"
                            }
                            options={[
                              { value: "flush", label: t("builder.flush") },
                              { value: "compact", label: t("builder.compact") },
                              { value: "airy", label: t("builder.airy") },
                              {
                                value: "custom",
                                label: t("builder.custom"),
                                disabled: true,
                              },
                            ]}
                            onChange={(value) => {
                              if (value !== "custom")
                                onChange(
                                  value === "flush"
                                    ? { gap: 0, canvasPadding: 0 }
                                    : value === "compact"
                                      ? { gap: 24, canvasPadding: 36 }
                                      : { gap: 60, canvasPadding: 60 },
                                );
                            }}
                          />
                          <Toggle
                            label={t("builder.rounded")}
                            checked={(board.cornerRadius ?? 0) > 0}
                            onChange={(rounded) =>
                              onChange({ cornerRadius: rounded ? 12.5 : 0 })
                            }
                          />
                          <Toggle
                            label={t("builder.borders")}
                            checked={board.cardBorderVisible === true}
                            onChange={(cardBorderVisible) =>
                              onChange({ cardBorderVisible })
                            }
                          />
                          {board.cardBorderVisible && (
                            <div className="flex flex-col gap-4">
                              <ColorField
                                id="card-border-color"
                                label={t("builder.borderColor")}
                                value={board.cardBorderColor ?? "#eef1f3"}
                                onChange={(cardBorderColor) =>
                                  onChange({ cardBorderColor })
                                }
                              />
                              <PercentField
                                id="card-border-width"
                                label={t("builder.borderThickness")}
                                max={5}
                                outputValue={`${board.cardBorderWidth ?? 0.5}%`}
                                value={board.cardBorderWidth ?? 0.5}
                                onChange={(cardBorderWidth) =>
                                  onChange({ cardBorderWidth })
                                }
                              />
                            </div>
                          )}
                        </>
                      )}
                      {index === 2 && (
                        <Toggle
                          label={t("settings.fields.showHeading")}
                          checked={board.headingVisible}
                          onChange={(headingVisible) =>
                            onChange({ headingVisible })
                          }
                        />
                      )}
                      {index === 3 && (
                        <Toggle
                          label={t("settings.fields.showTitles")}
                          checked={board.titlesVisible !== false}
                          onChange={(titlesVisible) =>
                            onChange({ titlesVisible })
                          }
                        />
                      )}
                      {((index === 2 && board.headingVisible) ||
                        (index === 3 && board.titlesVisible !== false)) && (
                        <SelectField
                          id={index === 2 ? "heading-font" : "cell-font"}
                          label={t("builder.typography")}
                          value={
                            index === 2 ? board.headingFont : board.cellFont
                          }
                          largeFontPreview
                          options={fontOptions.map((font) => ({
                            value: font,
                            label: font,
                            fontFamily: font,
                            fontWeight: resolveFontWeight(
                              font,
                              index === 2
                                ? board.headingFontWeight
                                : board.cellFontWeight,
                            ),
                          }))}
                          onChange={(font) =>
                            onChange(
                              index === 2
                                ? {
                                    headingFont: font as Board["headingFont"],
                                    headingFontWeight: resolveFontWeight(
                                      font,
                                      board.headingFontWeight,
                                    ),
                                  }
                                : {
                                    cellFont: font as Board["cellFont"],
                                    cellFontWeight: resolveFontWeight(
                                      font,
                                      board.cellFontWeight,
                                    ),
                                  },
                            )
                          }
                        />
                      )}
                      {index === 3 && board.titlesVisible !== false && (
                        <IconRadioField
                          id="caption-position"
                          label={t("editor.captionPosition.label")}
                          value={
                            board.captionPlacement === "overlay"
                              ? `overlay-${board.captionAlignment === "top" ? "top" : "bottom"}`
                              : (board.captionPlacement ?? "below")
                          }
                          columns={2}
                          options={[
                            {
                              value: "above",
                              label: t("editor.captionPosition.above"),
                              icon: PanelTop,
                            },
                            {
                              value: "below",
                              label: t("editor.captionPosition.below"),
                              icon: PanelBottom,
                            },
                            {
                              value: "overlay-top",
                              label: t("editor.captionPosition.overlayTop"),
                              icon: PanelTopDashed,
                            },
                            {
                              value: "overlay-bottom",
                              label: t("editor.captionPosition.overlayBottom"),
                              icon: PanelBottomDashed,
                            },
                          ]}
                          onChange={(position) =>
                            onChange(
                              position === "above" || position === "below"
                                ? { captionPlacement: position }
                                : {
                                    captionPlacement: "overlay",
                                    captionAlignment:
                                      position === "overlay-top"
                                        ? "top"
                                        : "bottom",
                                  },
                            )
                          }
                        />
                      )}
                      {(index < 2 ||
                        (index === 2 && board.headingVisible) ||
                        (index === 3 && board.titlesVisible !== false)) && (
                        <Disclosure
                          as="section"
                          key={index}
                          data-design-accordion
                          data-design-customize
                          className="min-w-0 border-0 border-l-2 border-solid border-(--line) pl-3"
                        >
                          {({ open: customOpen }) => (
                            <>
                              <DisclosureButton
                                data-customize-toggle
                                className="flex min-h-11 w-full cursor-pointer items-center gap-2 rounded-sm border-0 bg-(--bg) px-3 text-left text-xs text-(--muted) hover:text-(--text) data-open:text-(--text)"
                              >
                                <SlidersHorizontal
                                  aria-hidden="true"
                                  className="size-4"
                                />
                                <span className="min-w-0 flex-1">
                                  {t("builder.customizeNamed", {
                                    value1: item.title,
                                  })}
                                </span>
                                <ChevronDown
                                  aria-hidden="true"
                                  className={`size-4 shrink-0 transition-transform motion-reduce:transition-none ${customOpen ? "rotate-180" : ""}`}
                                />
                              </DisclosureButton>
                              <AnimatePresence initial={false}>
                                {customOpen && (
                                  <AccordionPanel
                                    key="customize"
                                    onReveal={revealDesignPanel}
                                  >
                                    <div className="flex min-w-0 flex-col gap-4 pt-3">
                                      {children[index]}
                                    </div>
                                  </AccordionPanel>
                                )}
                              </AnimatePresence>
                            </>
                          )}
                        </Disclosure>
                      )}
                    </fieldset>
                  </AccordionPanel>
                )}
              </AnimatePresence>
            </>
          )}
        </Disclosure>
      ))}
    </section>
  );
}
