import { RotateCcw } from "lucide-react";
import type { EditorSettings } from "../model";
import {
  samePresetSettings,
  starterPresets,
  type PresetChoice,
} from "../presets";
import { t } from "../i18n";
import { Button } from "./ui/controls";
import { ThemeThumbnail } from "./ThemeThumbnail";
import { CardFrame } from "./CardFrame";

const imageShapes = ["square", "landscape", "portrait"];
const captionPlacements = ["above", "below", "overlay"];
const sortedStarters = [...starterPresets].sort((a, b) => {
  const first = a.settings.style;
  const second = b.settings.style;
  const shape =
    imageShapes.indexOf(first.imageAspect ?? "square") -
    imageShapes.indexOf(second.imageAspect ?? "square");
  const firstCaption =
    first.titlesVisible === false
      ? -1
      : captionPlacements.indexOf(first.captionPlacement ?? "below");
  const secondCaption =
    second.titlesVisible === false
      ? -1
      : captionPlacements.indexOf(second.captionPlacement ?? "below");
  return shape || firstCaption - secondCaption;
});
const starterGroups = (
  [
    { headingVisible: true, label: "presets.withHeading" },
    { headingVisible: false, label: "presets.withoutHeading" },
  ] as const
).map((group) => ({
  ...group,
  starters: sortedStarters.filter(
    (starter) => starter.settings.style.headingVisible === group.headingVisible,
  ),
}));

export function PresetsPanel({
  previewId,
  currentSettings,
  appliedPresetId,
  customizations,
  disabled,
  onPreview,
  onReset,
}: {
  previewId?: string;
  currentSettings: EditorSettings;
  appliedPresetId: string | null;
  customizations: Readonly<Record<string, EditorSettings>>;
  disabled: boolean;
  onPreview: (choice: PresetChoice) => void;
  onReset: (choice: PresetChoice) => void;
}) {
  return (
    <section
      aria-label={t("presets.title")}
      className="flex min-w-0 flex-col gap-5 px-4 pb-6 max-[901px]:px-0 max-[901px]:pb-0"
    >
      <p className="m-0 text-xs leading-relaxed text-(--muted) max-[901px]:hidden">
        {t("presets.help")}
      </p>
      <section
        aria-label={t("presets.starters")}
        className="flex min-w-0 flex-col gap-5 max-[901px]:flex-row max-[901px]:overflow-x-auto max-[901px]:overflow-y-hidden max-[901px]:py-4 max-[901px]:px-4"
      >
        {starterGroups.map((group) => (
          <section
            key={group.label}
            aria-label={t(group.label)}
            className="flex min-w-0 flex-col gap-2 max-[901px]:shrink-0"
          >
            <h3 className="field-label font-normal max-[901px]:hidden!">
              {t(group.label)}
            </h3>
            <ul className="m-0 grid list-none grid-cols-2 items-start gap-3 p-0 max-[901px]:flex">
              {group.starters.map((starter) => {
                const original = {
                  ...starter,
                  name: t(`presets.names.${starter.nameKey}`),
                };
                const choice = {
                  ...original,
                  settings: customizations[starter.id] ?? starter.settings,
                };
                const applied =
                  appliedPresetId === choice.id ||
                  (appliedPresetId === null &&
                    samePresetSettings(choice.settings, currentSettings));
                const selected = previewId ? previewId === choice.id : applied;
                const modified = !samePresetSettings(
                  starter.settings,
                  applied ? currentSettings : choice.settings,
                );
                return (
                  <li
                    key={choice.id}
                    data-applied={applied ? "" : undefined}
                    data-selected={selected ? "" : undefined}
                    data-theme-tile
                    className="image-card group/theme @container relative flex min-w-0 flex-col max-[901px]:w-32 max-[901px]:shrink-0 rounded-lg border border-solid border-(--line) bg-(--bg) data-selected:border-(--accent) [--card-frame-color:transparent] [--card-frame-opacity:0.6] data-selected:bg-(--selected) has-[button:enabled:hover]:[--card-frame-color:var(--accent)] has-[button:focus-visible]:[--card-frame-color:var(--accent)]"
                  >
                    <button
                      type="button"
                      disabled={disabled}
                      aria-label={t("presets.previewNamed", {
                        name: choice.name,
                      })}
                      title={
                        previewId === choice.id
                          ? t("presets.previewing", { name: choice.name })
                          : applied
                            ? t("presets.appliedNamed", { name: choice.name })
                            : choice.name
                      }
                      aria-pressed={previewId === choice.id}
                      data-applied={applied ? "" : undefined}
                      data-customized={modified ? "" : undefined}
                      className="block min-h-11 w-full shrink-0 overflow-hidden rounded-[calc(var(--radius-lg)-1px)] border-0 bg-transparent p-0! outline-none! disabled:opacity-50"
                      style={{ color: starter.settings.style.headingTextColor }}
                      onClick={() => onPreview(choice)}
                    >
                      <ThemeThumbnail
                        theme={starter}
                        name={original.name}
                        rows={currentSettings.layout.rows}
                        columns={currentSettings.layout.columns}
                      />
                    </button>
                    {applied && modified && (
                      <Button
                        disabled={disabled}
                        aria-label={t("presets.reset")}
                        title={t("presets.reset")}
                        className="absolute top-1 right-1 z-60 size-8 min-h-0 p-0! opacity-0 group-focus-within/theme:opacity-100 group-hover/theme:opacity-100 pointer-coarse:opacity-100"
                        onClick={() => onReset(original)}
                      >
                        <RotateCcw aria-hidden="true" className="size-4!" />
                      </Button>
                    )}
                    <CardFrame dashed={false} />
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </section>
    </section>
  );
}
