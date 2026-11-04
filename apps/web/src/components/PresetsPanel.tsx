import { RotateCcw, Settings2 } from "lucide-react";
import type { EditorSettings } from "../model";
import { samePresetSettings, starterPresets, type PresetChoice } from "../presets";
import { t } from "../i18n";
import { Button } from "./ui/controls";
import { ThemeThumbnail } from "./ThemeThumbnail";

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
    <section aria-label={t("presets.starters")} className="flex min-w-0 flex-col gap-2">
      <h3 className="field-label font-normal">{t("presets.starters")}</h3>
      <ul className="m-0 grid list-none grid-cols-2 gap-2 p-0">
        {starterPresets.map((starter) => {
          const original = { ...starter, name: t(`presets.names.${starter.nameKey}`) };
          const choice = { ...original, settings: customizations[starter.id] ?? starter.settings };
          const applied = appliedPresetId === choice.id || (appliedPresetId === null && samePresetSettings(choice.settings, currentSettings));
          const modified = !samePresetSettings(starter.settings, applied ? currentSettings : choice.settings);
          const metadata = [applied ? t("presets.applied") : "", modified ? t("presets.modified") : ""].filter(Boolean).join(" / ");
          return <li key={choice.id} data-applied={applied ? "" : undefined}
            className="flex min-w-0 flex-col overflow-hidden rounded-lg border border-solid border-(--line) bg-(--bg) data-applied:border-(--accent) data-applied:bg-(--selected) has-[button:enabled:hover]:border-(--accent) focus-within:border-(--accent)">
            <button type="button" disabled={disabled}
              aria-label={t("presets.previewNamed", { name: choice.name })}
              title={applied ? t("presets.appliedNamed", { name: choice.name }) : choice.name}
              aria-pressed={previewId === choice.id}
              data-applied={applied ? "" : undefined}
              data-customized={modified ? "" : undefined}
              className="flex min-h-34 w-full flex-1 flex-col items-center justify-center gap-2 border-0 bg-transparent p-2 text-center text-(--text) focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-(--accent) disabled:opacity-50"
              onClick={() => onPreview(choice)}
            >
              <ThemeThumbnail theme={starter} name={original.name} rows={currentSettings.layout.rows} columns={currentSettings.layout.columns} />
              {metadata && <span className={`min-w-0 w-full text-xs ${applied ? "text-(--accent)" : "text-(--muted)"}`}>{metadata}</span>}
            </button>
            {applied && <div role="group" aria-label={t("presets.controlsNamed", { name: choice.name })}
              className="flex shrink-0 divide-x divide-(--line) border-0 border-t border-solid border-(--line)">
              <Button disabled={disabled} aria-label={t("editor.settings")} title={t("editor.settings")}
                className="min-h-11 min-w-0 flex-1 rounded-none! border-0 p-0! focus-visible:-outline-offset-2!" onClick={() => onSettings(choice)}>
                <Settings2 aria-hidden="true" className="size-5!" />
              </Button>
              {modified && <Button disabled={disabled} aria-label={t("presets.reset")} title={t("presets.reset")}
                className="min-h-11 min-w-0 flex-1 rounded-none! border-0 p-0! focus-visible:-outline-offset-2!" onClick={() => onReset(original)}>
                <RotateCcw aria-hidden="true" className="size-5!" />
              </Button>}
            </div>}
          </li>;
        })}
      </ul>
    </section>
  </section>;
}
