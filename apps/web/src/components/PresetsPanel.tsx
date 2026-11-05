import { RotateCcw, Settings2 } from "lucide-react";
import type { EditorSettings } from "../model";
import { samePresetSettings, starterPresets, type PresetChoice } from "../presets";
import { t } from "../i18n";
import { Button } from "./ui/controls";
import { ThemeThumbnail } from "./ThemeThumbnail";
import { CardFrame } from "./CardFrame";

const imageShapes = ["square", "landscape", "portrait"];
const captionPlacements = ["above", "below", "overlay"];
const sortedStarters = [...starterPresets].sort((a, b) => {
  const first = a.settings.style;
  const second = b.settings.style;
  const shape = imageShapes.indexOf(first.imageAspect ?? "square") - imageShapes.indexOf(second.imageAspect ?? "square");
  const firstCaption = first.titlesVisible === false ? -1 : captionPlacements.indexOf(first.captionPlacement ?? "below");
  const secondCaption = second.titlesVisible === false ? -1 : captionPlacements.indexOf(second.captionPlacement ?? "below");
  return shape || firstCaption - secondCaption;
});
const starterGroups = ([
  { headingVisible: true, label: "presets.withHeading" },
  { headingVisible: false, label: "presets.withoutHeading" },
] as const).map((group) => ({
  ...group,
  starters: sortedStarters.filter((starter) => starter.settings.style.headingVisible === group.headingVisible),
}));

export function PresetsPanel({ previewId, currentSettings, appliedPresetId, customizations, disabled, onPreview, onSettings, onReset }: {
  previewId?: string;
  currentSettings: EditorSettings;
  appliedPresetId: string | null;
  customizations: Readonly<Record<string, EditorSettings>>;
  disabled: boolean;
  onPreview: (choice: PresetChoice) => void;
  onSettings: (choice: PresetChoice) => void;
  onReset: (choice: PresetChoice) => void;
}) {
  return <section aria-label={t("presets.title")} className="flex min-w-0 flex-col gap-5 px-4 pb-6">
    <p className="m-0 text-xs leading-relaxed text-(--muted)">{t("presets.help")}</p>
    <section aria-label={t("presets.starters")} className="flex min-w-0 flex-col gap-5">
      {starterGroups.map((group) => <section key={group.label} aria-label={t(group.label)} className="flex min-w-0 flex-col gap-2">
      <h3 className="field-label font-normal">{t(group.label)}</h3>
      <ul className="m-0 grid list-none grid-cols-2 items-start gap-2 p-0">
        {group.starters.map((starter) => {
          const original = { ...starter, name: t(`presets.names.${starter.nameKey}`) };
          const choice = { ...original, settings: customizations[starter.id] ?? starter.settings };
          const applied = appliedPresetId === choice.id || (appliedPresetId === null && samePresetSettings(choice.settings, currentSettings));
          const modified = !samePresetSettings(starter.settings, applied ? currentSettings : choice.settings);
          return <li key={choice.id} data-applied={applied ? "" : undefined} data-theme-tile
            className="image-card @container relative flex min-w-0 flex-col rounded-lg border border-solid border-(--line) bg-(--bg) [--card-frame-color:transparent] data-applied:bg-(--selected) data-applied:[--card-frame-color:var(--accent)] has-[button:enabled:hover]:[--card-frame-color:var(--accent)] has-[button:focus-visible]:[--card-frame-color:var(--accent)]">
            <button type="button" disabled={disabled}
              aria-label={t("presets.previewNamed", { name: choice.name })}
              title={applied ? t("presets.appliedNamed", { name: choice.name }) : choice.name}
              aria-pressed={previewId === choice.id}
              data-applied={applied ? "" : undefined}
              data-customized={modified ? "" : undefined}
              className="block min-h-11 w-full shrink-0 overflow-hidden rounded-[calc(var(--radius-lg)-1px)] border-0 bg-transparent p-0! outline-none! disabled:opacity-50"
              style={{ color: starter.settings.style.headingTextColor }}
              onClick={() => onPreview(choice)}
            >
              <ThemeThumbnail theme={starter} name={original.name} rows={currentSettings.layout.rows} columns={currentSettings.layout.columns} />
            </button>
            {applied && <div role="group" aria-label={t("presets.controlsNamed", { name: choice.name })}
              className="flex shrink-0 divide-x divide-(--line) overflow-hidden rounded-b-[calc(var(--radius-lg)-1px)] border-0 border-t border-solid border-(--line)">
              <Button disabled={disabled} aria-label={t("editor.settings")} title={t("editor.settings")}
                className="min-h-11 min-w-0 flex-1 rounded-none! border-0 p-0! focus-visible:-outline-offset-2!" onClick={() => onSettings(choice)}>
                <Settings2 aria-hidden="true" className="size-5!" />
              </Button>
              {modified && <Button disabled={disabled} aria-label={t("presets.reset")} title={t("presets.reset")}
                className="min-h-11 min-w-0 flex-1 rounded-none! border-0 p-0! focus-visible:-outline-offset-2!" onClick={() => onReset(original)}>
                <RotateCcw aria-hidden="true" className="size-5!" />
              </Button>}
            </div>}
            <CardFrame dashed={false} />
          </li>;
        })}
      </ul>
      </section>)}
    </section>
  </section>;
}
