import { test, expect } from "@playwright/test";
import { build } from "vite";
import { fileURLToPath } from "node:url";

let model;
test.beforeAll(async () => {
  const result = await build({
    configFile: false,
    logLevel: "error",
    build: {
      write: false,
      minify: false,
      lib: {
        entry: fileURLToPath(new URL("../src/model.ts", import.meta.url)),
        formats: ["es"],
        fileName: "model",
      },
    },
  });
  const output = (Array.isArray(result) ? result[0] : result).output;
  const chunk = output.find((entry) => entry.type === "chunk" && entry.isEntry);
  model = await import(
    `data:text/javascript;base64,${Buffer.from(chunk.code).toString("base64")}`
  );
});

function localWorkspace() {
  const workspace = model.makeWorkspace();
  const asset = {
    id: crypto.randomUUID(),
    category: "Imported",
    title: "Private photograph",
    src: "data:image/png;base64,private-local-media",
  };
  workspace.assets = [asset];
  workspace.grid = model.resizeBoard(workspace.grid, 4, 4);
  workspace.grid.name = "Private collection";
  workspace.grid.heading = "Private banner";
  workspace.grid.cells[15] = {
    ...workspace.grid.cells[15],
    assetId: asset.id,
    title: "Private caption",
    fit: "cover",
  };
  workspace.exportSettings = {
    format: "image/webp",
    resolution: 300,
    quality: 70,
  };
  return workspace;
}

test("settings boundary extracts only allowlisted configuration and detached values", () => {
  const workspace = localWorkspace();
  const settings = model.getEditorSettings(workspace);
  expect(settings).toEqual({
    version: 1,
    layout: { rows: 4, columns: 4 },
    style: {
      publisher: "none",
      headingVisible: true,
      headingFont: "Manrope",
      cellFont: "Manrope",
      gap: 12,
      background: "#17191b",
    },
    exportSettings: { format: "image/webp", resolution: 300, quality: 70 },
  });
  const serialized = JSON.stringify(settings);
  for (const privateValue of [
    workspace.grid.id,
    workspace.assets[0].id,
    workspace.assets[0].src,
    workspace.grid.cells[15].id,
    workspace.grid.name,
    workspace.grid.heading,
    workspace.grid.cells[15].title,
  ]) {
    expect(serialized).not.toContain(privateValue);
  }
  settings.layout.rows = 1;
  settings.style.gap = 40;
  settings.exportSettings.quality = 50;
  expect(workspace.grid.rows).toBe(4);
  expect(workspace.grid.gap).toBe(12);
  expect(workspace.exportSettings.quality).toBe(70);
});

test("settings boundary rejects unknown fields, media and invalid configuration without mutation", () => {
  const workspace = localWorkspace();
  const original = structuredClone(workspace);
  const settings = model.getEditorSettings(workspace);
  const invalid = [
    workspace,
    { ...settings, assets: workspace.assets },
    { ...settings, content: workspace.grid },
    { ...settings, imageUrl: "https://example.com/private.png" },
    { ...settings, fontData: "data:font/woff2;base64,private" },
    { ...settings, version: 99 },
    {
      ...settings,
      layout: { ...settings.layout, cells: workspace.grid.cells },
    },
    { ...settings, layout: { ...settings.layout, rows: 13 } },
    { ...settings, layout: { ...settings.layout, columns: 1.5 } },
    {
      ...settings,
      style: { ...settings.style, heading: workspace.grid.heading },
    },
    {
      ...settings,
      style: { ...settings.style, background: "data:image/png;base64,private" },
    },
    {
      ...settings,
      style: {
        ...settings.style,
        headingFont: "https://example.com/font.woff2",
      },
    },
    {
      ...settings,
      exportSettings: {
        ...settings.exportSettings,
        imagePath: "C:/private/photo.png",
      },
    },
    {
      ...settings,
      exportSettings: { ...settings.exportSettings, resolution: 999 },
    },
    {
      ...settings,
      exportSettings: { ...settings.exportSettings, quality: 101 },
    },
  ];
  for (const input of invalid) {
    expect(model.editorSettingsSchema.safeParse(input).success).toBe(false);
    expect(() => model.applyEditorSettings(workspace, input)).toThrow();
    expect(workspace).toEqual(original);
  }
});

test("settings boundary applies configuration while preserving local content and recoverable coordinates", () => {
  const workspace = localWorkspace();
  const original = structuredClone(workspace);
  const defaults = model.getEditorSettings(model.makeWorkspace());
  const applied = model.applyEditorSettings(workspace, defaults);
  expect(model.getEditorSettings(applied)).toEqual(defaults);
  expect(applied.assets).toBe(workspace.assets);
  expect(applied.grid.id).toBe(workspace.grid.id);
  expect(applied.grid.name).toBe(workspace.grid.name);
  expect(applied.grid.heading).toBe(workspace.grid.heading);
  expect(applied.grid.cells[0].id).toBe(workspace.grid.cells[0].id);
  expect(
    applied.grid.overflow.find((entry) => entry.row === 3 && entry.column === 3)
      ?.cell,
  ).toEqual(workspace.grid.cells[15]);
  expect(model.workspaceSchema.safeParse(applied).success).toBe(true);
  const restored = model.applyEditorSettings(
    applied,
    model.getEditorSettings(workspace),
  );
  expect(restored.grid.cells).toEqual(workspace.grid.cells);
  expect(restored.grid.overflow).toEqual([]);
  expect(workspace).toEqual(original);
  defaults.style.gap = 40;
  defaults.exportSettings.quality = 50;
  expect(applied.grid.gap).toBe(12);
  expect(applied.exportSettings.quality).toBe(95);
});
