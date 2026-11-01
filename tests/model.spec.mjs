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

test("independent typography settings validate, roundtrip and reset without changing content", () => {
  const workspace = localWorkspace();
  Object.assign(workspace.grid, {
    headingFont: "Bebas Neue",
    headingFontSize: 30,
    headingTextColor: "#cc4488",
    cellFont: "Boogaloo",
    cellFontSize: 24,
    cellTextColor: "#39a36f",
  });
  const settings = model.getEditorSettings(workspace);
  expect(settings.style).toMatchObject({
    headingFont: "Bebas Neue",
    headingFontSize: 30,
    headingTextColor: "#cc4488",
    cellFont: "Boogaloo",
    cellFontSize: 24,
    cellTextColor: "#39a36f",
  });
  expect(JSON.stringify(settings)).not.toContain("Private");
  const restored = model.applyEditorSettings(
    localWorkspace(),
    JSON.parse(JSON.stringify(settings)),
  );
  expect(model.getEditorSettings(restored)).toEqual(settings);
  expect(model.cellGeometry(restored.grid, 150).captionHeight).toBe(55);
  expect(model.cellGeometry(restored.grid, 150, 0)).toMatchObject({
    captionHeight: 0,
    imageTop: 0,
    height: 200,
  });
  for (const patch of [
    { cellFontSize: 0 },
    { headingFontSize: 37 },
    { cellTextColor: "red" },
    { headingTextColor: "#fff" },
  ]) {
    expect(
      model.editorSettingsSchema.safeParse({
        ...settings,
        style: { ...settings.style, ...patch },
      }).success,
    ).toBe(false);
  }
  const reset = model.resetWorkspace(workspace);
  expect(reset.grid.headingFontSize).toBeUndefined();
  expect(reset.grid.cellFontSize).toBeUndefined();
  expect(reset.grid.headingTextColor).toBeUndefined();
  expect(reset.grid.cellTextColor).toBeUndefined();
  expect(reset.assets).toBe(workspace.assets);
  expect(
    reset.grid.overflow.find(
      (entry) => entry.cell.id === workspace.grid.cells[15].id,
    ).cell.title,
  ).toBe("Private caption");
});

test("image caption edits synchronize library, placements and overflow without changing crops", () => {
  const workspace = localWorkspace();
  const asset = workspace.assets[0];
  const crop = { x: 0.5, y: 0, width: 0.5, height: 1 };
  workspace.grid.cells[15].crop = crop;
  const overflow = model.resizeBoard(workspace.grid, 3, 3);
  workspace.grid = overflow;
  workspace.grid.cells[0] = {
    ...workspace.grid.cells[0],
    assetId: asset.id,
    title: "Old title",
  };
  const updated = model.documentReducer(workspace, {
    type: "asset/title",
    assetId: asset.id,
    title: "Mixed Case caption",
  });
  expect(updated.assets[0].title).toBe("Mixed Case caption");
  expect(updated.assets[0].src).toBe(asset.src);
  expect(updated.grid.cells[0].title).toBe("Mixed Case caption");
  expect(
    updated.grid.overflow.find((entry) => entry.cell.assetId === asset.id).cell,
  ).toMatchObject({ title: "Mixed Case caption", crop });
  expect(updated.grid.cells[1]).toBe(workspace.grid.cells[1]);
  expect(model.workspaceSchema.safeParse(updated).success).toBe(true);
  expect(JSON.stringify(model.getEditorSettings(updated))).not.toContain(
    "Mixed Case caption",
  );
  expect(
    model.documentReducer(workspace, {
      type: "asset/title",
      assetId: crypto.randomUUID(),
      title: "Missing",
    }),
  ).toBe(workspace);
  expect(
    model.documentReducer(workspace, {
      type: "asset/title",
      assetId: asset.id,
      title: "x".repeat(121),
    }),
  ).toBe(workspace);
});

test("visual crops preserve originals and share full-box source rectangles", () => {
  const workspace = localWorkspace();
  const cell = workspace.grid.cells[15];
  const crop = { x: 0.5, y: 0, width: 0.5, height: 1 };
  const command = {
    type: "cell/crop",
    gridId: workspace.grid.id,
    cellId: cell.id,
    assetId: cell.assetId,
    crop,
  };
  const cropped = model.documentReducer(workspace, command);
  expect(cropped.grid.cells[15].crop).toEqual(crop);
  expect(cropped.assets).toBe(workspace.assets);
  expect(workspace.grid.cells[15].crop).toBeUndefined();
  expect(model.workspaceSchema.safeParse(cropped).success).toBe(true);
  expect(JSON.stringify(model.getEditorSettings(cropped))).not.toContain(
    '"crop"',
  );
  expect(model.sourceRectangle(undefined, 400, 200, 1)).toEqual({
    x: 100,
    y: 0,
    width: 200,
    height: 200,
  });
  expect(model.sourceRectangle(crop, 400, 200, 1)).toEqual({
    x: 200,
    y: 0,
    width: 200,
    height: 200,
  });
  expect(model.sourceRectangle(crop, 400, 200, 3 / 4)).toEqual({
    x: 225,
    y: 0,
    width: 150,
    height: 200,
  });
  expect(
    model.documentReducer(cropped, {
      ...command,
      assetId: crypto.randomUUID(),
    }),
  ).toBe(cropped);
  expect(
    model.documentReducer(cropped, {
      ...command,
      crop: { ...crop, width: 0.8 },
    }),
  ).toBe(cropped);
  const replaced = model.documentReducer(cropped, {
    type: "cell/place",
    gridId: workspace.grid.id,
    cellId: cell.id,
    assetId: cell.assetId,
  });
  expect(replaced.grid.cells[15].crop).toBeUndefined();
  const uploaded = model.documentReducer(cropped, {
    type: "assets/import",
    gridId: workspace.grid.id,
    cellId: cell.id,
    assets: [{ ...workspace.assets[0], id: crypto.randomUUID() }],
  });
  expect(uploaded.grid.cells[15].crop).toBeUndefined();
  const swapped = model.documentReducer(cropped, {
    type: "cell/swap",
    gridId: workspace.grid.id,
    sourceCellId: cell.id,
    targetCellId: workspace.grid.cells[0].id,
  });
  expect(swapped.grid.cells[0].crop).toEqual(crop);
});

test("multiline caption geometry grows shared bands without changing image ratios", () => {
  const style = {
    ...model.makeWorkspace().grid,
    imageAspect: "square",
    captionPlacement: "below",
  };
  expect(model.cellGeometry(style, 600, 6)).toMatchObject({
    imageHeight: 600,
    captionHeight: 482,
    height: 1082,
  });
  expect(
    model.cellGeometry({ ...style, captionPlacement: "above" }, 600, 6),
  ).toMatchObject({ imageTop: 482, captionTop: 0, height: 1082 });
  expect(
    model.cellGeometry(
      {
        ...style,
        imageAspect: "landscape",
        captionPlacement: "overlay",
        captionAlignment: "bottom",
      },
      600,
      6,
    ),
  ).toMatchObject({
    aspectRatio: 4 / 3,
    imageHeight: 450,
    captionHeight: 482,
    imageTop: 16,
    captionTop: 0,
    height: 482,
  });
});

test("grid appearance settings roundtrip and share cell geometry", () => {
  const workspace = localWorkspace();
  Object.assign(workspace.grid, {
    imageAspect: "portrait",
    captionPlacement: "overlay",
    captionAlignment: "middle",
    captionOverlayColor: "#123456",
    captionOverlayOpacity: 40,
  });
  const settings = model.getEditorSettings(workspace);
  expect(settings.style).toMatchObject({
    imageAspect: "portrait",
    captionPlacement: "overlay",
    captionAlignment: "middle",
    captionOverlayColor: "#123456",
    captionOverlayOpacity: 40,
  });
  const restored = model.applyEditorSettings(model.makeWorkspace(), settings);
  expect(model.getEditorSettings(restored)).toEqual(settings);
  expect(model.workspaceSchema.safeParse(workspace).success).toBe(true);
  expect(model.cellGeometry(workspace.grid, 600)).toMatchObject({
    imageHeight: 800,
    captionHeight: 138,
    captionTop: 331,
    height: 800,
  });
  expect(
    model.cellGeometry(
      {
        ...workspace.grid,
        imageAspect: "landscape",
        captionPlacement: "above",
      },
      600,
    ),
  ).toMatchObject({
    imageHeight: 450,
    imageTop: 138,
    captionTop: 0,
    height: 588,
  });
  expect(
    model.cellGeometry(
      { ...workspace.grid, imageAspect: "square", captionPlacement: "below" },
      600,
    ),
  ).toMatchObject({ imageHeight: 600, captionTop: 600, height: 738 });
  expect(model.captionPadding(600)).toEqual({ horizontal: 36, vertical: 30 });
  expect(
    model.editorSettingsSchema.safeParse({
      ...settings,
      style: { ...settings.style, captionOverlayOpacity: 101 },
    }).success,
  ).toBe(false);
  const defaults = model.getEditorSettings(model.makeWorkspace()).style;
  expect(defaults).toMatchObject({
    imageAspect: "portrait",
    captionPlacement: "overlay",
    captionAlignment: "bottom",
  });
  expect(model.cellGeometry(defaults, 600)).toMatchObject({
    imageHeight: 800,
    captionTop: 662,
    height: 800,
  });
  const reset = model.resetWorkspace(workspace);
  expect(model.getEditorSettings(reset).style).toEqual(defaults);
  expect(reset.assets).toEqual(workspace.assets);
});

test("independent spacing and background settings roundtrip and reset", () => {
  const workspace = localWorkspace();
  const settings = model.getEditorSettings(workspace);
  Object.assign(settings.style, {
    gap: 120,
    canvasPadding: 120,
    canvasBackgroundColor: "#d9e7f0",
    headingBackgroundColor: "#114455",
    cellBackgroundColor: "#335577",
  });
  const restored = model.applyEditorSettings(workspace, settings);
  expect(model.getEditorSettings(restored)).toEqual(settings);
  expect(model.gridSpacing(restored.grid, 150)).toEqual({
    gap: 30,
    headingGap: 30,
    padding: 30,
  });
  expect(model.gridSpacing(restored.grid, 300)).toEqual({
    gap: 60,
    headingGap: 60,
    padding: 60,
  });
  expect(restored.assets).toBe(workspace.assets);
  expect(restored.grid.cells).toEqual(workspace.grid.cells);
  for (const invalid of [
    { gap: 121 },
    { canvasPadding: 121 },
    { headingBackgroundColor: "invalid" },
    { cellBackgroundColor: "invalid" },
  ]) {
    expect(
      model.editorSettingsSchema.safeParse({
        ...settings,
        style: { ...settings.style, ...invalid },
      }).success,
    ).toBe(false);
  }
  const reset = model.resetWorkspace(restored);
  expect(model.gridSpacing(reset.grid, 600)).toEqual({
    gap: 60,
    headingGap: 60,
    padding: 60,
  });
  for (const field of [
    "canvasBackgroundColor",
    "headingBackgroundColor",
    "cellBackgroundColor",
  ]) {
    expect(reset.grid[field]).toBeUndefined();
  }
});

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
      headingFontWeight: 400,
      cellFontWeight: 400,
      imageAspect: "portrait",
      captionPlacement: "overlay",
      captionAlignment: "bottom",
      gap: 60,
      canvasPadding: 60,
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
  expect(workspace.grid.gap).toBe(60);
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

test("font weights roundtrip and reset without theme profiles", () => {
  const workspace = localWorkspace();
  const settings = model.getEditorSettings(workspace);
  Object.assign(settings.style, {
    headingFontWeight: 800,
    cellFontWeight: 700,
  });
  const restored = model.applyEditorSettings(workspace, settings);
  expect(model.getEditorSettings(restored)).toEqual(settings);
  expect(restored.grid.cells).toEqual(workspace.grid.cells);
  expect(restored.assets).toBe(workspace.assets);
  expect(workspace.grid.headingFontWeight).not.toBe(800);
  expect(
    model.fontWeightOptions("Manrope").map((option) => option.value),
  ).toEqual([100, 200, 300, 400, 500, 600, 700, 800, 900]);
  for (const font of ["Bangers", "Boogaloo", "Bebas Neue"]) {
    expect(model.fontWeightOptions(font).map((option) => option.value)).toEqual(
      [400, 700],
    );
    expect(model.resolveFontWeight(font, 800)).toBe(700);
    expect(model.resolveFontWeight(font, 300)).toBe(400);
  }
  const reset = model.resetWorkspace(restored);
  expect(model.getEditorSettings(reset).style).toMatchObject({
    headingFontWeight: 400,
    cellFontWeight: 400,
  });
  for (const field of ["headingFontWeight", "cellFontWeight"]) {
    for (const value of [99, 450, 1000]) {
      expect(
        model.editorSettingsSchema.safeParse({
          ...settings,
          style: { ...settings.style, [field]: value },
        }).success,
      ).toBe(false);
    }
  }
  for (const invalid of [
    { ...settings, themeSettings: {} },
    { ...settings, style: { ...settings.style, template: "Clean" } },
  ]) {
    expect(model.editorSettingsSchema.safeParse(invalid).success).toBe(false);
    expect(() => model.applyEditorSettings(workspace, invalid)).toThrow();
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
  expect(applied.grid.gap).toBe(60);
  expect(applied.exportSettings.quality).toBe(95);
});

test("document commands patch, place, swap and clear content without replacing cell identities", () => {
  const workspace = localWorkspace();
  const original = structuredClone(workspace);
  const [first, second] = workspace.grid.cells;
  let edited = model.documentReducer(workspace, {
    type: "grid/patch",
    gridId: workspace.grid.id,
    patch: { heading: "Edited banner", gap: 20 },
  });
  edited = model.documentReducer(edited, {
    type: "export/patch",
    patch: { quality: 80 },
  });
  edited = model.documentReducer(edited, {
    type: "cell/place",
    gridId: workspace.grid.id,
    cellId: first.id,
    assetId: workspace.assets[0].id,
  });
  edited = model.documentReducer(edited, {
    type: "cell/patch",
    gridId: workspace.grid.id,
    cellId: first.id,
    patch: { title: "Edited caption", fit: "cover" },
  });
  edited = model.documentReducer(edited, {
    type: "cell/swap",
    gridId: workspace.grid.id,
    sourceCellId: first.id,
    targetCellId: second.id,
  });
  expect(edited.grid.cells[1]).toMatchObject({
    id: second.id,
    title: "Edited caption",
    fit: "cover",
    assetId: workspace.assets[0].id,
  });
  expect(edited.grid.cells[0].id).toBe(first.id);
  edited = model.documentReducer(edited, {
    type: "cell/clear",
    gridId: workspace.grid.id,
    cellId: second.id,
  });
  expect(edited.grid.cells[1]).toEqual({
    id: second.id,
    title: "",
    fit: "cover",
    crop: undefined,
    assetId: null,
  });
  expect(edited.grid.heading).toBe("Edited banner");
  expect(edited.exportSettings.quality).toBe(80);
  expect(edited.assets).toBe(workspace.assets);
  expect(model.workspaceSchema.safeParse(edited).success).toBe(true);
  expect(workspace).toEqual(original);
  expect(
    model.documentReducer(edited, {
      type: "cell/place",
      gridId: workspace.grid.id,
      cellId: first.id,
      assetId: crypto.randomUUID(),
    }),
  ).toBe(edited);
});

test("document resize and reset commands replay stable IDs and preserve newer edits", () => {
  const workspace = model.makeWorkspace();
  const resize = model.createResizeCommand(workspace.grid.id, 4, 4);
  expect(model.documentReducer(workspace, resize)).toEqual(
    model.documentReducer(workspace, resize),
  );
  const grown = model.documentReducer(workspace, resize);
  const cell = grown.grid.cells[15];
  const edited = model.documentReducer(grown, {
    type: "cell/patch",
    gridId: grown.grid.id,
    cellId: cell.id,
    patch: { title: "Newer edit" },
  });
  const reset = model.createResetCommand();
  const resetWorkspace = model.documentReducer(edited, reset);
  expect(resetWorkspace).toEqual(model.documentReducer(edited, reset));
  expect(
    resetWorkspace.grid.overflow.find(
      (entry) => entry.row === 3 && entry.column === 3,
    )?.cell.title,
  ).toBe("Newer edit");
  const restored = model.documentReducer(resetWorkspace, resize);
  expect(restored.grid.cells[15]).toMatchObject({
    id: cell.id,
    title: "Newer edit",
  });
  const small = model.documentReducer(
    workspace,
    model.createResizeCommand(workspace.grid.id, 1, 1),
  );
  expect(model.documentReducer(small, reset)).toEqual(
    model.documentReducer(small, reset),
  );
  expect(model.workspaceSchema.safeParse(restored).success).toBe(true);
});

test("document import commands use latest cell IDs and retain media for stale destinations", () => {
  const workspace = model.makeWorkspace();
  const destination = workspace.grid.cells[3];
  const asset = {
    id: crypto.randomUUID(),
    category: "Imported",
    title: "A".repeat(150),
    src: "data:image/png;base64,local",
  };
  const command = {
    type: "assets/import",
    gridId: workspace.grid.id,
    cellId: destination.id,
    assets: [asset],
  };
  const grown = model.documentReducer(
    workspace,
    model.createResizeCommand(workspace.grid.id, 3, 4),
  );
  const placed = model.documentReducer(grown, command);
  expect(placed.grid.cells[4]).toMatchObject({
    id: destination.id,
    assetId: asset.id,
    title: "A".repeat(120),
  });
  expect(placed.grid.cells[3].assetId).toBeNull();
  const removed = model.documentReducer(
    workspace,
    model.createResizeCommand(workspace.grid.id, 1, 1),
  );
  const retained = model.documentReducer(removed, command);
  expect(retained.assets).toEqual([asset]);
  expect(retained.grid).toBe(removed.grid);
  const replaced = { ...workspace, grid: model.makeBoard("Another grid") };
  const stale = model.documentReducer(replaced, command);
  expect(stale.assets).toEqual([asset]);
  expect(stale.grid).toBe(replaced.grid);
  expect(stale.exportSettings).toBe(workspace.exportSettings);
  expect(model.documentReducer(stale, command).assets).toHaveLength(1);
  expect(
    model.documentReducer(stale, {
      type: "cell/patch",
      gridId: workspace.grid.id,
      cellId: destination.id,
      patch: { title: "Stale edit" },
    }),
  ).toBe(stale);
  expect(model.workspaceSchema.safeParse(stale).success).toBe(true);
});

test("document batch imports retain latest media and preferences", () => {
  const workspace = model.makeWorkspace();
  const assets = Array.from({ length: 3 }, (_, index) => ({
    id: crypto.randomUUID(),
    category: "Imported",
    title: `Image ${index}`,
    src: `data:image/png;base64,local-${index}`,
  }));
  const batch = {
    type: "assets/import",
    gridId: workspace.grid.id,
    cellId: workspace.grid.cells[8].id,
    assets,
  };
  const imported = model.documentReducer(workspace, batch);
  expect(imported).toEqual(model.documentReducer(workspace, batch));
  expect(imported.assets).toEqual(assets);
  expect(imported.grid.cells[8]).toMatchObject({
    id: workspace.grid.cells[8].id,
    assetId: assets[0].id,
    title: "Image 0",
  });
  const updated = model.documentReducer(imported, {
    type: "export/patch",
    patch: { quality: 85 },
  });
  expect(updated.assets).toEqual(assets);
  expect(updated.exportSettings.quality).toBe(85);
  expect(model.workspaceSchema.safeParse(updated).success).toBe(true);
  expect(workspace.assets).toEqual([]);
});

test("library deletion retains visible and removed references while deleting unused images", () => {
  const workspace = localWorkspace();
  const unused = {
    ...workspace.assets[0],
    id: crypto.randomUUID(),
    title: "Unused",
  };
  workspace.assets.push(unused);
  workspace.grid.cells[0] = {
    ...workspace.grid.cells[0],
    assetId: workspace.assets[0].id,
    title: "Keep visible caption",
  };
  const reduced = model.documentReducer(
    workspace,
    model.createResizeCommand(workspace.grid.id, 3, 3),
  );
  const original = structuredClone(reduced);
  const deleted = model.documentReducer(reduced, {
    type: "assets/delete",
    assetIds: workspace.assets.map((asset) => asset.id),
  });
  expect(deleted.assets).toEqual([
    { ...workspace.assets[0], libraryHidden: true },
  ]);
  expect(deleted.grid).toBe(reduced.grid);
  expect(deleted.grid.cells[0]).toMatchObject({
    assetId: workspace.assets[0].id,
    title: "Keep visible caption",
  });
  expect(
    deleted.grid.overflow.find(
      (entry) => entry.cell.id === workspace.grid.cells[15].id,
    ).cell,
  ).toMatchObject({
    assetId: workspace.assets[0].id,
    title: "Private caption",
  });
  expect(model.workspaceSchema.safeParse(deleted).success).toBe(true);
  expect(reduced).toEqual(original);
  expect(
    model.documentReducer(deleted, {
      type: "assets/delete",
      assetIds: [workspace.assets[0].id],
    }),
  ).toBe(deleted);
});

test("trash cleanup protects live and overflow references and restores image identity", () => {
  const workspace = localWorkspace();
  const unused = {
    ...workspace.assets[0],
    id: crypto.randomUUID(),
    title: "Unused",
  };
  workspace.assets.push(unused);
  const reduced = model.documentReducer(
    workspace,
    model.createResizeCommand(workspace.grid.id, 3, 3),
  );
  const original = structuredClone(reduced);
  const trashed = model.documentReducer(reduced, {
    type: "assets/trash-unused",
    assetIds: workspace.assets.map((asset) => asset.id),
    trashedAt: 123,
  });
  expect(trashed.assets[0].trashedAt).toBeUndefined();
  expect(trashed.assets[1]).toEqual({ ...unused, trashedAt: 123 });
  expect(trashed.grid).toBe(reduced.grid);
  expect(
    model.documentReducer(trashed, {
      type: "cell/place",
      gridId: trashed.grid.id,
      cellId: trashed.grid.cells[0].id,
      assetId: unused.id,
    }),
  ).toBe(trashed);
  const restored = model.documentReducer(trashed, {
    type: "assets/restore",
    assetIds: [unused.id],
  });
  expect(restored.assets[1]).toMatchObject(unused);
  expect(restored.assets[1].trashedAt).toBeUndefined();
  const purged = model.documentReducer(trashed, {
    type: "assets/purge",
    assetIds: workspace.assets.map((asset) => asset.id),
  });
  expect(purged.assets).toEqual([workspace.assets[0]]);
  expect(model.workspaceSchema.safeParse(purged).success).toBe(true);
  expect(reduced).toEqual(original);
});

test("trash commands recheck current usage rather than trusting stale cleanup selections", () => {
  const workspace = localWorkspace();
  const unused = { ...workspace.assets[0], id: crypto.randomUUID() };
  workspace.assets.push(unused);
  const pending = {
    type: "assets/trash-unused",
    assetIds: [unused.id],
    trashedAt: 123,
  };
  const placed = model.documentReducer(workspace, {
    type: "cell/place",
    gridId: workspace.grid.id,
    cellId: workspace.grid.cells[0].id,
    assetId: unused.id,
  });
  expect(
    model.documentReducer(placed, pending).assets[1].trashedAt,
  ).toBeUndefined();
  const invalid = structuredClone(placed);
  invalid.assets[1].trashedAt = 123;
  expect(model.workspaceSchema.safeParse(invalid).success).toBe(false);
});
