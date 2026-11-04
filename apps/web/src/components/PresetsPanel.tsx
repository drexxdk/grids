import { LayoutGrid, RotateCcw, Settings2 } from "lucide-react";
import type { EditorSettings } from "../model";
import { samePresetSettings, starterPresets, type PresetChoice } from "../presets";
import { t } from "../i18n";
import { Button } from "./ui/controls";

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
      <ul className="m-0 grid list-none grid-cols-3 gap-2 p-0">
        {starterPresets.map((starter) => {
          const original = { ...starter, name: t(`presets.names.${starter.nameKey}`) };
          const choice = { ...original, settings: customizations[starter.id] ?? starter.settings };
          const applied = appliedPresetId === choice.id || (appliedPresetId === null && samePresetSettings(choice.settings, currentSettings));
          const modified = !samePresetSettings(starter.settings, applied ? currentSettings : choice.settings);
          const metadata = [applied ? t("presets.applied") : "", modified ? t("presets.modified") : ""].filter(Boolean).join(" / ");
          return <li key={choice.id} className="flex min-w-0 flex-col gap-2">
            <button type="button" disabled={disabled}
              aria-label={t("presets.previewNamed", { name: choice.name })}
              title={applied ? t("presets.appliedNamed", { name: choice.name }) : choice.name}
              aria-pressed={previewId === choice.id}
              data-applied={applied ? "" : undefined}
              data-customized={modified ? "" : undefined}
              className="flex min-h-34 w-full flex-col items-center justify-center gap-2 rounded-lg border border-solid border-(--line) bg-(--bg) p-2 text-center text-(--text) data-applied:border-(--accent) data-applied:bg-(--selected) enabled:hover:border-(--accent) focus-visible:outline-2 focus-visible:outline-(--accent) disabled:opacity-50"
              onClick={() => onPreview(choice)}
            >
              <span className="flex size-10 shrink-0 items-center justify-center rounded-md border border-solid border-(--line)"
                style={{ background: choice.settings.style.background, color: choice.settings.style.headingTextColor ?? "#d8f36a" }}>
                <LayoutGrid aria-hidden="true" className="size-5" />
              </span>
              <span className="min-w-0 w-full">
                <span className="flex min-h-8 items-center justify-center wrap-anywhere text-xs leading-4 font-semibold">{choice.name}</span>
                {metadata && <span className={`mt-1 block text-xs ${applied ? "text-(--accent)" : "text-(--muted)"}`}>{metadata}</span>}
              </span>
            </button>
            {applied && <div role="group" aria-label={t("presets.controlsNamed", { name: choice.name })} className="flex flex-col gap-2">
              <Button disabled={disabled} className="min-h-11 w-full gap-1 px-2 text-xs" onClick={() => onSettings(choice)}>
                <Settings2 aria-hidden="true" className="size-4!" />{t("editor.settings")}
              </Button>
              {modified && <Button disabled={disabled} className="min-h-11 w-full gap-1 px-2 text-xs" onClick={() => onReset(original)}>
                <RotateCcw aria-hidden="true" className="size-4!" />{t("presets.reset")}
              </Button>}
            </div>}
          </li>;
        })}
      </ul>
    </section>
  </section>;
}
