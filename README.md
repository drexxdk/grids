# Grids

A browser-only, single-grid image editor built with React 19 and Vite. Fresh workspaces start with one empty, neutral 3x3 grid and an empty image library. No backend is required for guest editing.

## Run

Requires Node.js 22.12 or newer. Node.js 22 is used for deployment.

```sh
npm ci
npm run dev
```

Open the localhost URL printed in the terminal, normally http://localhost:5837. If that port is occupied, Vite automatically tries the next available port. `npm start` also starts the development server. Use Vite rather than opening the HTML directly so modules, fonts, and canvas exports load consistently.

## Build And Preview

```sh
npm run build
npm run preview
```

The production site is generated in `dist/`. Preview normally runs at http://localhost:5838 and also falls back to another port when occupied. Relative build paths support both a GitHub Pages repository URL and a custom domain.

## Install And Offline Use

On Android, open the published site in Chrome and use **Install app** or **Add to Home screen** from its menu. On iPhone, open it in Safari and choose **Share > Add to Home Screen**, with **Open as Web App** enabled if offered. Browser wording and automatic install prompts vary.

After the first online visit finishes caching, Grids can launch, edit local images and export offline. Its production service worker caches the app, local fonts and icons, not uploaded images; those remain in IndexedDB. Installation is not backup or cross-device sync, and some browsers keep installed-app storage separate from browser-tab storage. Updates are checked on launch and resume without reusing cached worker scripts. New workers activate automatically; an already-open page reloads only after changes are saved and active editors, settings, dialogs and uploads have finished. Existing installations using the old update behavior may need one close and reopen after deployment; do not clear site data, which contains local images and grids. Service workers are disabled in development; installation requires HTTPS or localhost and the production build.

## Frontend Foundation

Controls use Headless UI for accessible interactions, Motion for animation, and Tailwind CSS v4 for styling. Tailwind uses standard, unprefixed utilities without Preflight while existing canvas styles are migrated incrementally. All application modules use TypeScript/TSX and are strictly checked during every production build; run `npm run typecheck` separately when needed. Directly executed Node configs and browser-test scripts use `.mjs`. Do not add authored `.js` or `.jsx` files; Vite's generated JavaScript bundles are build output, not application source.

The header's Export grid button opens one dialog with format, resolution, quality, output dimensions and a Download image action. Export options persist across reloads; PNG disables lossy quality adjustment. Settings are grouped into Canvas, Heading and Card style. Canvas style contains Background, Padding and one shared Gap between the heading/grid and between cards. Fonts, weights, colors and sizes are adjusted directly, without themes or remembered preset profiles. Reset grid settings has a confirmation explaining which settings change and which images/content remain. Dialogs scroll at the viewport edge and keep the background locked through their exit animations. Touch devices focus a non-input control rather than opening the keyboard automatically.

The full-width header centers the row/column controls and Reset grid above the canvas, with Export grid and the sidebar toggle at the top right. Resize buttons use the supplied line-style add/remove row icons, rotated for columns, with green add and red remove themes across the whole button. Descriptive tooltips explain each action and its limits. Export switches to icon-only when its label no longer fits beside the centered controls. The controls then align left if needed; the header uses two rows only when the full left-aligned icon-only row also runs out of room. Controls remain fixed while grid items scroll, and no side or bottom control tracks reduce the canvas area. The Grids icon and title sit at the header's left when they fit beside the centered controls, otherwise moving into the right aside below the header. Branding never shifts the centered controls, and the aside has no empty branding row when the brand is in the header. Desktop has Images and Settings tabs; mobile uses the same aside as a Settings-only overlay and uses the image picker for library access. The only sidebar close button stays in the main header. Opening the mobile overlay does not resize the canvas, and the closed overlay does not intercept canvas input. Reset grid settings remains at the bottom of Settings. Settings reset preserves placements and captions; full grid reset confirms before creating an empty default 3x3 grid, clearing headings/crops/overflow and resetting export settings while keeping library images. Online provides keyless Commons image search. Uploads and placements survive viewport changes, and touch dialogs do not autofocus text inputs.

Settings select portrait (3:4), landscape (4:3), or square (1:1) image tiles independently of row/column counts. Captions remain directly editable above, below, or on the image. On-image captions support top or bottom alignment and adjustable overlay color/opacity. Preview and export share tile/caption geometry; style changes retain images and text. Reset restores portrait tiles with bottom-overlay captions. Native grid scrollbars live at the dotted workspace edges: wheel or finger scrolling moves grid items while the grid heading and resize controls remain fixed. Card touch gestures still move images; the surrounding dotted area supports native panning.

Images always fill their tile. Crop image opens a fullscreen `react-easy-crop` editor with the current tile ratio, mouse/touch/keyboard panning, zoom, guides and reset. Apply saves validated normalized coordinates per cell; Cancel leaves the saved crop unchanged. Reopening restores the crop, and the grid and export use the same source rectangle, including after ratio changes. The original image file is never cropped or replaced, so reused images can have independent crops and can always be cropped differently later.

Font, format and resolution dropdowns share a Headless UI listbox with 44px controls and viewport-edge clearance. Font-family menus are alphabetical and preview each face in both options and triggers at 20px, with reduced vertical padding only for those menus. Heading and Card style each have a separate font-weight slider: Manrope supports 100 through 900 in 100-point steps; display fonts offer Regular (400) and browser-synthesized Bold (700). The selected weight affects previews, text measurement and exports, persists across reloads, and resets to 400. Background has a 64x44 color-picker target and a separate editable hex textbox. Six-digit hex accepts an optional `#`; valid edits update the grid, while incomplete/invalid text reverts on blur or Escape. Picker and text changes stay synchronized.

The modal structure and scrollbar-compensation pattern were adapted from the user's Chatter frontend (`apps/web/src/components/Modal.tsx`, `apps/web/src/scrollbarWidth.ts`, and the portal-dialog rules in `apps/web/src/index.css`). Grids uses Motion instead of Chatter's CSS/Web Animations transitions, adds listener/probe cleanup and post-dialog measurements, and keeps its own editor styling and deployment. No Chatter backend code is included.

Development order and progress are tracked in [docs/roadmap.md](docs/roadmap.md). Provider sign-in/database settings, uploaded fonts/thumbnails, and additional/custom ratios remain pending. Dexie stores image blobs and the coherent local grid snapshot in IndexedDB (`grids-client-v1`); localStorage holds only the settings cache (`grids-settings-v1`). Restoration uses strict Zod validation and fresh blob URLs. Obsolete prototype localStorage documents are ignored, without migration or backup UI.

The image library has one Image source dropdown listing Imported and each enabled provider, currently Wikimedia Commons, without a separate Online/provider dropdown or demo/example loader. Commons searches public-domain/CC0 raster images without an API key. Sidebar imports add to the library; picker imports place only the chosen image. Original blobs and source/creator/license metadata stay in IndexedDB and survive reload; source links remain available in Imported. Searches and image requests disclose query/network information to Commons, not local uploads. Other licenses and providers are not enabled. See [provider scope and compatibility checks](docs/providers.md). Defaults use Manrope and do not infer branding from the grid name or uploaded images. Artwork used by browser tests lives only in test fixtures, outside public builds.

The model separates layout/style/export configuration from local cell content and media. Its strict settings-only representation excludes images, font files, URLs/paths, placements, IDs, grid names, headings, and captions. Applying settings validates before changing the grid and preserves local content, including cells outside the visible grid. Reset uses this shared path, with an explicit reset of the grid name and banner text. This is a client-side boundary, not account sync; future backend ownership and validation remain required.

All editor document changes use typed commands and a React reducer: grid/cell/export edits, placement/swaps/clearing, resizing/reset, and completed imports. Commands resolve current cell IDs rather than stale positions; resize/reset prepare new-cell IDs before dispatch so replay stays stable. Dialogs, save/export progress and pending image decoding remain outside the saved document. There is no undo feature.

## Deploy To GitHub Pages

1. Push the project to the GitHub repository's `main` branch. The repository is already initialized with an `origin` remote.
2. In the GitHub repository, open **Settings > Pages** and set **Source** to **GitHub Actions**.
3. Push to `main`, or run **Test And Deploy GitHub Pages** manually from the **Actions** tab.

The workflow installs locked dependencies and typechecks/builds the site once. A successful build allows `main` to deploy `dist/` immediately; model tests and four browser-test shards run independently and do not block deployment. Failed tests still report errors and upload their reports, so the overall workflow can be red even when deployment succeeds. A failed build prevents deployment. Pull requests run the same checks without deploying. The published URL is shown in the deployment environment, normally `https://<username>.github.io/<repository>/`.

No API keys or application secrets are needed for guest editing. Saved grids belong to each browser origin: a localhost grid will not automatically appear on the published site. GitHub Pages does not sync grids between devices. Planned provider login and account settings need a separately hosted backend; images will remain client-only. Review the rights to supplied images before publishing them in a public repository.

## Project Structure

- [src/App.tsx](src/App.tsx): typed React editor UI, command dispatch, and import/download interactions.
- [src/components/EditorLayout.tsx](src/components/EditorLayout.tsx): desktop sidebars and the image-first Headless UI/Motion mobile drawer.
- [src/model.ts](src/model.ts): versioned single-grid/settings schemas, typed document commands/reducer, settings extraction/application, defaults/reset, and coordinate-preserving resizing.
- [src/storage.ts](src/storage.ts): Dexie grid/image transactions, serialized saves, strict restoration, settings-only localStorage cache, and managed object URLs.
- [tests/fixtures/comics.ts](tests/fixtures/comics.ts): test-only workspace fixtures; fixture artwork is excluded from public builds.
- [src/export.ts](src/export.ts): typed canvas sizing, image rendering, and export generation.
- `src/components/ui/`: typed Headless UI/Motion buttons, switches, accordion, action menu, and modal.
- `src/browser/scrollbar.ts`: scrollbar measurement and dialog lifecycle compensation support.
- `styles.css`: existing responsive canvas/editor styling and incremental Tailwind utilities.
- `public/assets/`: local fonts and redistribution notices.
- [tests/editor.spec.mjs](tests/editor.spec.mjs): Node-side production-build browser regression checks.
- [tests/model.spec.mjs](tests/model.spec.mjs): in-memory TypeScript checks for settings boundaries, immutable document commands, replay-stable IDs, batch imports, and stale-target/media recovery.
- [vite.config.mjs](vite.config.mjs) and [playwright.config.mjs](playwright.config.mjs): directly executed ESM tooling configuration.
- `.github/workflows/deploy.yml`: test and GitHub Pages deployment workflow.

## Editing And Export

Saving is automatic, with no storage-management dialog or persistence request. Image blobs and grid content stay in this browser's IndexedDB; localStorage holds a settings-only cache. Saves coalesce edits over 300 ms and attempt a flush when the page becomes hidden. Routine progress and success messages are hidden; save failures, session-only mode and conflicts remain visible. Unsaved or failed edits retain a leave-page warning because abrupt termination can still lose pending changes. Browser storage is not permanent backup or synchronization.

The library begins with an Add images placeholder: a square tile when images exist, or a full-width larger target when empty. Placeholder text/icons, captions, and in-card action buttons scale with their card; controls outside cards retain their fixed dimensions. Hover a library image on desktop or tap it on mobile to reveal Delete. Clear all images sits below the library. Both actions remove library entries directly, without confirmations or a trash flow. Images already placed on the canvas or in removed cells remain intact, along with captions and placements, across reloads; their local media stays stored but is no longer offered in the library or image picker. Unused images are deleted transactionally with their metadata, and URLs are revoked only after successful deletion. Failed saves retain the stored snapshot/files for retry.

Guest documents carry opaque revision tokens. Saving compares the loaded revision inside the image/document transaction before changing files or the settings cache, so stale tabs cannot silently overwrite newer saves. Successful commits send only the guest document ID and revision through BroadcastChannel; focus/visibility checks cover unavailable or missed notifications. Opening an unchanged saved grid does not create another revision. Restoration reads the document and blobs from one coherent transaction.

Changed in another tab stops this tab's autosaves and displays a persistent warning. Local edits and images remain available for session editing/export; they are not automatically merged or discarded. Reload saved grid requires confirmation before replacing them with the saved version, and Cancel preserves them. Ordinary write failures still retry on subsequent edits; revision conflicts require an explicit reload.

- Add/remove columns and rows with the centered header controls, from 1 to 12 in each direction. Preview cards scale between 128 and 320 CSS pixels wide, scrolling when they cannot fit; export resolution is unchanged. Existing cells stay at their coordinates, and cells outside the visible grid are saved across reloads and reappear when expanding. There is no removed-cell tray, individual recovery control, or resize history.
- Reset grid settings restores grid configuration and export preferences and clears the banner heading after confirmation. Local images, cell captions, and placements are retained; cells outside the default 3x3 area remain recoverable by expanding the grid. Cancel leaves everything unchanged.
- Click or tap the whole empty image placeholder to choose an image. An empty library opens file upload directly; otherwise the picker offers library images and upload. Empty cells have no hover upload tools.
- Drop image files anywhere in the image-library panel to import them without placing them. Drop files or library images into a cell to place them there; drag feedback marks the receiving area. Hover or tap a library image to reveal its delete control.
- The library's Image source dropdown lists Imported and enabled providers directly, not category filters or a nested Online selector. Imported contains client-local images; Wikimedia Commons provides paginated public-domain/CC0 image search with source/rights links. Search failures do not affect the grid or Imported.
- Drag filled cells to swap them, including their crops. Hover or tap a filled image for its available Replace, Crop image and top-right Clear tools, each on a translucent contrasting surface without an opaque tool strip. Replacing or clearing a cell resets its crop; clearing leaves its library image available. Cells are not selected; captions are edited directly in their chosen above/below/on-image position.
- Each placed card owns its caption and crop, even when multiple cards use the same library image. Editing one card does not rename the library image or other cards. Library renames leave existing cards unchanged; new placements start with the current library title.
- Set an optional Image heading above the grid, such as Team DC or Team Marvel. Turn off Show heading to export without a banner while retaining the text; an empty heading also omits the banner.
- Adjust Canvas, Heading and Card style directly. Colors and typography are included in exports and saved with the grid.
- Choose Bangers, Bebas Neue, Boogaloo, or Manrope separately for the banner and cell headings, then set each font's weight with its slider.
- Upload additional images, adjust their visual crops, spacing and background. Imports show a spinner and completed-file count in the upload tile on desktop and mobile. Processing yields between files so the editor can update; invalid images are skipped with an error, and loading clears when the batch finishes.
- Export the grid as PNG, JPEG, or WebP. Format, resolution, and quality preferences survive reloads.
- Exports include the optional image heading, images, and cell headings, not editor controls or the grid's workspace name.

The optional legacy comic pairing is Bangers for the image heading and Boogaloo for cell headings, with 0.5px letter spacing. Default grids use Manrope. All fonts are bundled locally. Fonts, icons, and original images stay local; no third-party service receives uploads. Imported files use managed blob URLs and persist as IndexedDB blobs, not base64 strings in localStorage. Preset source tags retain image identity across reloads without storing temporary blob URLs.

Automatic persistence is quiet during normal editing; Save failed and other actionable warnings remain visible. Grid and new-image writes are transactional and serialized; failed saves leave editing/export usable and subsequent edits retry. Unavailable storage or a missing saved image enters Session only mode without overwriting the stored grid. Browser storage is not permanent backup or cross-device synchronization. Canvas exports remain capped at 16 MP on narrow/touch layouts and 32 MP otherwise; choose 150/300 px per image for larger grids. These are initial allocation safeguards, not a guarantee against every device's memory limits.

## Check

```sh
npm run check
```

The browser tests run against the production build under `/grids/` to verify repository-subpath hosting. They check neutral first launch without demo requests, real drag-and-drop, uploads, grid resizing, autosave/reset/export preferences, invalid-document rejection, storage-failure feedback, responsive layout, caption editing, modal scroll/focus lifecycle, touch-device no-autofocus, and downloaded PNG/JPEG/WebP image pixels. Comic-based checks seed test-only fixtures directly into isolated browser storage; fixture artwork is excluded from public builds. The multi-format export check has a larger timeout for image decoding and full-resolution output. Tests also write full-resolution PNGs to `exports/`, which is ignored by Git.

Storage checks use real browser IndexedDB: large blobs and private grid content, settings-only localStorage, fresh object URLs, latest-edit persistence, transaction rollback/retry, unavailable-storage fallback, missing-image overwrite protection, and object-URL disposal. Library deletion checks verify retained canvas/overflow images, unused-blob reclamation, and rollback/retry without premature URL revocation. Tests await completed saves before reload and verify restored content and media identity.

Multi-tab checks cover unchanged tab opening, metadata-only notifications, local edit/export preservation, confirmed/cancelled reload, mobile warning layout, focus/visibility fallback without BroadcastChannel, stale purge/write rejection, simultaneous-writer atomicity, commit-only notifications, revision retry after rollback, and channel disposal.

```sh
npx playwright install chromium
npm test
```

`npm test` builds the app automatically and starts a dedicated preview server on localhost port 5840. That test port must be free; tests never reuse an unrelated project's server.

For focused browser runs, rebuild first after application or CSS changes: Playwright's preview server serves the existing `dist/`, not source files. In [tests/editor.spec.mjs](tests/editor.spec.mjs), reuse `openSidebarPanel`, `closeSidebarPanel`, and `selectField` for panel-dependent actions, and `setEditorViewport` before settled geometry checks. Panel helpers wait for real exit/removal and entry boundaries rather than sleeps. Compare sidebar/workspace geometry with the permanent header and actual native-scrollbar content box, not retired drawer selectors or fixed offsets. Use `paletteColor` for editor-token assertions while retaining exact saved-content/export pixel checks. Use `touchTest` for automatic touch-context cleanup and `scrollbarTest` when testing classic native gutters. Selected choices are natively disabled; keyboard tests must verify that navigation skips them.

## Asset Notices

Font redistribution licenses are bundled alongside the font files. Icons are provided by `lucide-react`. Publisher colors do not include logos in the editor or exports. Supplied character artwork and unused publisher logo files remain subject to their owners' rights; this project does not grant a license to that artwork.
