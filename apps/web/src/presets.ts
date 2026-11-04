import {
  applyEditorSettings, editorSettingsSchema, getEditorSettings, makeWorkspace,
  type Asset, type EditorSettings, type Workspace,
} from "./model";
import type en from "./locales/en.json";
import { isLightCanvasColor } from "./canvasTheme";

type SampleSet = "botanical" | "objects";
export type PresetChoice = {
  id: string;
  name: string;
  settings: EditorSettings;
  samples?: SampleSet;
  updatedAt?: string;
};
type Starter = {
  id: keyof typeof en.presets.names;
  style: Partial<EditorSettings["style"]> & Pick<EditorSettings["style"], "background">;
  samples?: SampleSet;
};
const defaults = getEditorSettings(makeWorkspace());
const starters: Starter[] = [
  { id: "gallery", style: { background: "#f5f1e8", cellBackgroundColor: "#fffdf8", gap: 24, canvasPadding: 48, titlesVisible: false, headingTextColor: "#252923", cornerRadius: 0 } },
  { id: "botanical", style: { background: "#18382b", cellBackgroundColor: "#244b3a", gap: 24, canvasPadding: 36, titlesVisible: false, headingTextColor: "#f0e9ce" } },
  { id: "midnight", style: { background: "#0e1118", cellBackgroundColor: "#1b2232", imageAspect: "square", gap: 18, canvasPadding: 30, titlesVisible: false, headingTextColor: "#f4f4f8" } },
  { id: "postcards", style: { background: "#e9ddd0", imageAspect: "landscape", captionPlacement: "below", cellBackgroundColor: "#fffaf2", cellTextColor: "#40342c", headingTextColor: "#40342c", gap: 36, cornerRadius: 0 } },
  { id: "contact", style: { background: "#101010", cellBackgroundColor: "#202020", imageAspect: "square", gap: 8, canvasPadding: 16, headingVisible: false, titlesVisible: false, cornerRadius: 0 } },
  { id: "editorial", style: { background: "#faf9f5", captionPlacement: "below", cellBackgroundColor: "#faf9f5", cellTextColor: "#202020", headingTextColor: "#202020", headingFont: "Bebas Neue", gap: 32, cornerRadius: 0 } },
  { id: "filmstrip", style: { background: "#151515", cellBackgroundColor: "#252525", imageAspect: "landscape", gap: 12, canvasPadding: 30, headingVisible: false, titlesVisible: false, cornerRadius: 0 } },
  { id: "portraits", style: { background: "#292228", cellBackgroundColor: "#3a3038", gap: 18, canvasPadding: 36, titlesVisible: false, headingTextColor: "#f9e8ef" } },
  { id: "polaroids", style: { background: "#d8cbb8", imageAspect: "square", captionPlacement: "below", cellBackgroundColor: "#ffffff", cellTextColor: "#303030", headingTextColor: "#43372b", gap: 40, cornerRadius: 0 } },
  { id: "pastel", style: { background: "#e9e3f0", cellBackgroundColor: "#f7f2fc", imageAspect: "square", gap: 24, canvasPadding: 42, titlesVisible: false, headingTextColor: "#44354e", cornerRadius: 20 } },
  { id: "terracotta", style: { background: "#a94e37", cellBackgroundColor: "#f8e9d8", cellTextColor: "#593224", gap: 24, canvasPadding: 42, titlesVisible: false, headingTextColor: "#fff1df" }, samples: "objects" },
  { id: "museum", style: { background: "#f1ede4", captionPlacement: "below", cellBackgroundColor: "#f1ede4", cellTextColor: "#33302a", headingTextColor: "#33302a", gap: 48, cornerRadius: 0 }, samples: "objects" },
  { id: "panorama", style: { background: "#e8eee8", cellBackgroundColor: "#f6faf4", imageAspect: "landscape", gap: 24, titlesVisible: false, headingTextColor: "#213b2d", cornerRadius: 0 } },
  { id: "story", style: { background: "#eee5d9", captionPlacement: "below", cellBackgroundColor: "#faf6f0", cellTextColor: "#3d3329", headingTextColor: "#3d3329", gap: 30, cornerRadius: 0 } },
  { id: "collage", style: { background: "#17191b", cellBackgroundColor: "#25282b", imageAspect: "square", gap: 0, canvasPadding: 0, headingVisible: false, titlesVisible: false, cornerRadius: 0 } },
  { id: "spotlight", style: { background: "#1d2c28", cellBackgroundColor: "#2b4038", imageAspect: "landscape", gap: 30, canvasPadding: 60, titlesVisible: false, headingTextColor: "#fff5db" } },
  { id: "duet", style: { background: "#eee9df", cellBackgroundColor: "#fffdf7", gap: 36, canvasPadding: 48, titlesVisible: false, headingTextColor: "#33382e" } },
  { id: "scrapbook", style: { background: "#f0d7b6", imageAspect: "square", captionPlacement: "below", cellFont: "Boogaloo", cellBackgroundColor: "#fff8e9", cellTextColor: "#614329", headingTextColor: "#614329", gap: 42, cornerRadius: 8 } },
  { id: "pop", style: { background: "#f4ca36", cellBackgroundColor: "#fff0a3", headingFont: "Bangers", cellFont: "Bangers", headingTextColor: "#222222", captionOverlayColor: "#222222", cellTextColor: "#ffffff", gap: 18, cornerRadius: 0 }, samples: "objects" },
  { id: "ocean", style: { background: "#123d51", cellBackgroundColor: "#1c5167", imageAspect: "square", titlesVisible: false, headingTextColor: "#def5f4", gap: 20, canvasPadding: 40 } },
  { id: "minimal", style: { background: "#ffffff", cellBackgroundColor: "#f7f7f5", imageAspect: "square", headingVisible: false, titlesVisible: false, gap: 48, canvasPadding: 72, cornerRadius: 0 } },
  { id: "catalogue", style: { background: "#f7f5ef", imageAspect: "square", captionPlacement: "below", cellBackgroundColor: "#f7f5ef", cellTextColor: "#32372e", headingTextColor: "#32372e", cellFontSize: 9, gap: 24, cornerRadius: 0 }, samples: "objects" },
  { id: "rose", style: { background: "#613745", cellBackgroundColor: "#754957", imageAspect: "square", titlesVisible: false, headingTextColor: "#ffe6e9", gap: 28, canvasPadding: 44, cornerRadius: 18 } },
  { id: "wide", style: { background: "#f3eee1", cellBackgroundColor: "#fffcf4", imageAspect: "landscape", titlesVisible: false, headingTextColor: "#3c392f", gap: 20, canvasPadding: 36, cornerRadius: 0 } },
];

export const starterPresets = starters.map(({ id, style, samples }) => ({
  id: `starter:${id}`,
  nameKey: id,
  samples: samples ?? "botanical",
  settings: editorSettingsSchema.parse({
    ...defaults,
    style: {
      ...defaults.style,
      headingBackgroundColor: style.background,
      headingTextColor: isLightCanvasColor(style.background) ? "#202325" : "#f4f4ef",
      cellTextColor: isLightCanvasColor(style.cellBackgroundColor ?? style.background) ? "#202325" : "#f4f4ef",
      captionOverlayColor: style.cellBackgroundColor ?? style.background,
      ...style,
    },
  }),
}));

const sampleSets: Record<SampleSet, Asset[]> = {
  botanical: [
    ["V0047265", "Flowers in bloom"],
    ["V0043473", "Still life"],
    ["V0046796", "Botanical study"],
    ["V0046797", "Leaves and flowers"],
    ["V0046568", "Painted garden"],
    ["V0017153", "Floral composition"],
  ].map(([id, title]) => ({
    id: crypto.randomUUID(), category: "preset-preview", title: title!,
    src: `https://iiif.wellcomecollection.org/image/${id}/full/!800,800/0/default.jpg`,
  })),
  objects: [
    ["OaGiv", "Decorative cup"], ["BzEyk", "Cup and saucer"], ["IHTbi", "Pattern and form"],
  ].map(([id, title]) => ({
    id: crypto.randomUUID(), category: "preset-preview", title: title!,
    src: `https://iiif.micr.io/${id}/full/!800,800/0/default.jpg`,
  })),
};

export function presetSettingsForLayout(settings: EditorSettings, { rows, columns }: EditorSettings["layout"]): EditorSettings {
  return { ...settings, layout: { rows, columns } };
}

export function samePresetSettings(a: EditorSettings, b: EditorSettings): boolean {
  return JSON.stringify(presetSettingsForLayout(a, b.layout)) === JSON.stringify(b);
}

export function presetPreviewWorkspace(choice: PresetChoice, layout: EditorSettings["layout"]): Workspace {
  const preview = applyEditorSettings(makeWorkspace(), presetSettingsForLayout(choice.settings, layout));
  const assets = sampleSets[choice.samples ?? "botanical"];
  return {
    ...preview,
    assets,
    grid: {
      ...preview.grid, heading: choice.name, overflow: [],
      cells: preview.grid.cells.map((cell, index) => {
        const asset = assets[index % assets.length]!;
        return { ...cell, assetId: asset.id, title: asset.title };
      }),
    },
  };
}
