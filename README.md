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

## Frontend Foundation

Controls use Headless UI for accessible interactions, Motion for animation, and Tailwind CSS v4 for styling. Tailwind uses the `tw:` prefix without Preflight while existing canvas styles are migrated incrementally. All application modules use TypeScript/TSX and are strictly checked during every production build; run `npm run typecheck` separately when needed. Directly executed Node configs and browser-test scripts use `.mjs`. Do not add authored `.js` or `.jsx` files; Vite's generated JavaScript bundles are build output, not application source.

The header has the single Export grid action; the Export tab contains its format, resolution and quality settings. The Templates tab has a theme selector and one settings body. Clean, Editorial, Superhero and Custom each remember their last configuration, including across reloads; Custom is last, and DC/Marvel are Superhero sub-themes. The Show heading switch hides the exported heading without erasing its text or styling. Reset grid settings has a confirmation explaining which settings change and which images/content remain. Dialogs scroll at the viewport edge and keep the background locked through their exit animations. Touch devices focus a non-input control rather than opening the keyboard automatically.

Desktop keeps the image library on the left and settings on the right; reset and local storage are part of the settings aside, not a separate grid toolbar. At 900px and below, the same library/settings move into an animated non-modal bottom drawer. It opens collapsed to a horizontal image strip with an upload tile first, Clear all images below, and Expand tools; expansion reveals examples, templates, export settings, reset and storage. The grid stays interactive behind it, no text input autofocuses, and uploads/placements remain intact across viewport changes. The drawer accounts for safe-area and modal-scrollbar spacing and reserves page space for the grid's lower controls.

Theme, font, format and resolution dropdowns share a Headless UI listbox with 44px controls and viewport-edge clearance. Background has a 64x44 color-picker target and a separate editable hex textbox. Six-digit hex accepts an optional `#`; valid edits update the grid, while incomplete/invalid text reverts on blur or Escape. Picker and text changes stay synchronized.

The modal structure and scrollbar-compensation pattern were adapted from the user's Chatter frontend (`apps/web/src/components/Modal.tsx`, `apps/web/src/scrollbarWidth.ts`, and the portal-dialog rules in `apps/web/src/index.css`). Grids uses Motion instead of Chatter's CSS/Web Animations transitions, adds listener/probe cleanup and post-dialog measurements, and keeps its own editor styling and deployment. No Chatter backend code is included.

Development order and progress are tracked in [docs/roadmap.md](docs/roadmap.md). Provider sign-in/database settings, general undo/redo, uploaded fonts/thumbnails, image ratios, and reviewed/licensed examples remain pending. Dexie stores image blobs and the coherent local grid snapshot in IndexedDB (`grids-client-v1`); localStorage holds only the settings cache (`grids-settings-v1`). Restoration uses strict Zod validation and fresh blob URLs. Obsolete prototype localStorage documents are ignored, without migration or backup UI.

The image-library Load example icon opens a DC/Marvel preset selector. Use example deliberately replaces the current grid; Cancel leaves it unchanged, and existing library uploads are retained. Repeat loads reuse matching library images. Neither the example module nor its images are requested by a fresh workspace until applied. Defaults use Manrope and do not infer comic branding from the grid name or uploaded images.

The model separates layout/style/export configuration from local cell content and media. Its strict settings-only representation excludes images, font files, URLs/paths, placements, IDs, grid names, headings, and captions. Applying settings validates before changing the grid and preserves local content, including removed-cell recovery. Reset uses this shared path, with an explicit reset of the grid name and banner text. This is a client-side boundary, not account sync; future backend ownership and validation remain required.

All editor document changes use typed commands and a React reducer: grid/cell/export edits, theme switching, placement/swaps/clearing, resizing/recovery/reset, completed imports, and deliberate example replacement. Commands resolve current cell IDs rather than stale positions; resize/reset prepare new-cell IDs before dispatch so replay stays stable. Example replacement merges the latest local library instead of restoring an older snapshot. Dialogs, save/export progress, pending image decoding, and session resize history remain outside the saved document. General undo/redo is still pending.

## Deploy To GitHub Pages

1. Push the project to the GitHub repository's `main` branch. The repository is already initialized with an `origin` remote.
2. In the GitHub repository, open **Settings > Pages** and set **Source** to **GitHub Actions**.
3. Push to `main`, or run **Deploy GitHub Pages** manually from the **Actions** tab.

The workflow installs locked dependencies, builds the site, runs the browser tests, and deploys `dist/` only after those checks pass. Pull requests run the same checks without deploying. The published URL is shown in the deployment environment, normally `https://<username>.github.io/<repository>/`.

No API keys or application secrets are needed for guest editing. Saved grids belong to each browser origin: a localhost grid will not automatically appear on the published site. GitHub Pages does not sync grids between devices. Planned provider login and account settings need a separately hosted backend; images will remain client-only. Review the rights to supplied images before publishing them in a public repository.

## Project Structure

- [src/App.tsx](src/App.tsx): typed React editor UI, command dispatch, and import/download interactions.
- [src/components/EditorLayout.tsx](src/components/EditorLayout.tsx): desktop sidebars and the image-first Headless UI/Motion mobile drawer.
- [src/model.ts](src/model.ts): versioned single-grid/settings schemas, typed document commands/reducer, settings extraction/application, defaults/reset, and coordinate-preserving resizing.
- [src/storage.ts](src/storage.ts): Dexie grid/image transactions, serialized saves, strict restoration, settings-only localStorage cache, and managed object URLs.
- [src/demo/comics.ts](src/demo/comics.ts): lazily loaded single-grid example presets, including the unresolved source/rights record.
- [src/export.ts](src/export.ts): typed canvas sizing, image rendering, and export generation.
- `src/components/ui/`: typed Headless UI/Motion buttons, switches, accordion, action menu, and modal.
- `src/browser/scrollbar.ts`: scrollbar measurement and dialog lifecycle compensation support.
- `styles.css`: existing responsive canvas/editor styling and incremental Tailwind utilities.
- `public/assets/`: local fonts, images, and redistribution notices.
- [tests/editor.spec.mjs](tests/editor.spec.mjs): Node-side production-build browser regression checks.
- [tests/model.spec.mjs](tests/model.spec.mjs): in-memory TypeScript checks for settings boundaries, immutable document commands, replay-stable IDs, batch imports, and stale-target/media recovery.
- [vite.config.mjs](vite.config.mjs) and [playwright.config.mjs](playwright.config.mjs): directly executed ESM tooling configuration.
- `.github/workflows/deploy.yml`: test and GitHub Pages deployment workflow.

## Editing And Export

Saves coalesce edits over 300 ms and attempt a flush when the page becomes hidden. Unsaved or failed edits retain a leave-page warning; wait for Saved in this browser before closing because abrupt termination can still lose pending changes. The toolbar's Local storage tool reports stored-image size, browser-origin usage/quota, and persistence status. Persistent storage requires an intentional request and may be denied or unavailable; it is not permanent backup.

The library begins with an Add images placeholder: a square tile when images exist, or a full-width larger target when empty. Hover a library image on desktop or tap it on mobile to reveal Delete. Clear all images sits below the library. Both actions remove library entries directly, without confirmations or a trash flow. Images already placed on the canvas or in removed cells remain intact, along with captions and placements, across reloads; their local media stays stored but is no longer offered in the library or image picker. Unused images are deleted transactionally with their metadata, and URLs are revoked only after successful deletion. Failed saves retain the stored snapshot/files for retry; wait for Saved in this browser before closing. Deletion is unavailable while loading an example. Future undo must define media retention without changing this direct interaction.

Guest documents carry opaque revision tokens. Saving compares the loaded revision inside the image/document transaction before changing files or the settings cache, so stale tabs cannot silently overwrite newer saves. Successful commits send only the guest document ID and revision through BroadcastChannel; focus/visibility checks cover unavailable or missed notifications. Opening an unchanged saved grid does not create another revision. Restoration reads the document and blobs from one coherent transaction.

Changed in another tab stops this tab's autosaves and displays a persistent warning. Local edits and images remain available for session editing/export; they are not automatically merged or discarded. Reload saved grid requires confirmation before replacing them with the saved version, and Cancel preserves them. Ordinary write failures still retry on subsequent edits; revision conflicts require an explicit reload.

- Add/remove columns with right-edge plus/minus buttons and rows with bottom-edge buttons, from 1 to 12 in each direction. Existing cells stay at their coordinates, and removed cells are saved across reloads. Expanding restores them; the removed-cell tray restores a cell by expanding to its original coordinates. Undo grid resize restores prior dimensions during the current session without overwriting newer edits.
- Reset grid settings restores grid configuration and export preferences and clears the banner heading after confirmation. Local images, cell captions, and placements are retained; cells outside the default 3x3 area remain recoverable by expanding the grid. Reset clears session resize Undo history and cached theme profiles, not the image library. Cancel leaves everything unchanged.
- Click or tap the whole empty image placeholder to choose an image. An empty library opens file upload directly; otherwise the picker offers library images and upload. Empty cells have no hover upload tools.
- Drop image files anywhere in the image-library panel to import them without placing them. Drop files or library images into a cell to place them there; drag feedback marks the receiving area. Hover or tap a library image to reveal its delete control.
- Category filters appear only for libraries with multiple categories. All includes every active image; Imported restricts a mixed library to uploads. Empty or uploaded-only libraries have no redundant filters.
- Drag filled cells to swap them. Hover or tap a filled image for its available Replace, Fit/Fill and top-right Clear tools, each on a translucent contrasting surface without an opaque tool strip. Clearing a cell leaves its library image available. Cells are not selected, and captions are edited directly beneath each image.
- Set an optional Image heading above the grid, such as Team DC or Team Marvel. Turn off Show heading to export without a banner while retaining the text; an empty heading also omits the banner.
- Choose a theme, then adjust its settings below. Superhero includes DC/Marvel sub-themes with blue/red publisher colors; other themes have no publisher selector. Colors are included in exports and saved with the grid. Headers keep the team name centered without logos.
- Choose Manrope, Bangers, Boogaloo, or Bebas Neue separately for the banner and cell headings.
- Upload additional images, choose Fit or Fill, and adjust spacing and background.
- Export the grid as PNG, JPEG, or WebP. Format, resolution, and quality preferences survive reloads.
- Exports include the optional image heading, images, and cell headings, not editor controls or the grid's workspace name.

The optional legacy comic pairing is Bangers for the image heading and Boogaloo for cell headings, with 0.5px letter spacing. Default grids use Manrope. All fonts are bundled locally. Fonts, icons, and original images stay local; no third-party service receives uploads. Imported files use managed blob URLs and persist as IndexedDB blobs, not base64 strings in localStorage. Preset source tags retain image identity across reloads without storing temporary blob URLs.

Saving changes.../Saved in this browser/Save failed reflect asynchronous persistence; wait for Saved in this browser before closing to retain pending edits. Grid and new-image writes are transactional and serialized; failed saves leave editing/export usable and subsequent edits retry. Unavailable storage or a missing saved image enters Session only mode without overwriting the stored grid. Browser storage is not permanent backup or cross-device synchronization. Canvas exports remain capped at 16 MP on narrow/touch layouts and 32 MP otherwise; choose 150/300 px per image for larger grids. These are initial allocation safeguards, not a guarantee against every device's memory limits.

## Check

```sh
npm run check
```

The browser tests run against the production build under `/tier-list/` to verify repository-subpath hosting. They check neutral first launch without demo requests, deliberate single-grid example replacement/cancel, real drag-and-drop, uploads, grid resizing, autosave/reset/export preferences, invalid-document rejection, storage-failure feedback, the mobile layout, and downloaded PNG/JPEG/WebP image pixels. Comic-based checks explicitly load the legacy example; its image-rights review and replacement with owned/licensed fixtures remain pending. Foundation checks cover heading visibility/export parity, animated controls, rename persistence/cancel, modal scroll/focus lifecycle, and touch-device no-autofocus. The multi-format export check has a larger timeout for image decoding and full-resolution output. Tests also write the two example full-resolution PNGs to `exports/`, which is ignored by Git.

Storage checks use real browser IndexedDB: large blobs and private grid content, settings-only localStorage, fresh object URLs, latest-edit persistence, transaction rollback/retry, unavailable-storage fallback, missing-image overwrite protection, and object-URL disposal. Trash checks cover visible/removed-cell protection, restoration identity and reload, confirmed/cancelled deletion, blob reclamation, and failed-purge rollback/retry without premature URL revocation. Tests await completed saves before reload and verify preset deduplication after blob restoration.

Multi-tab checks cover unchanged tab opening, metadata-only notifications, local edit/export preservation, confirmed/cancelled reload, mobile warning layout, focus/visibility fallback without BroadcastChannel, stale purge/write rejection, simultaneous-writer atomicity, commit-only notifications, revision retry after rollback, and channel disposal.

```sh
npx playwright install chromium
npm test
```

`npm test` builds the app automatically and starts a dedicated preview server on localhost port 5840. That test port must be free; tests never reuse an unrelated project's server.

## Asset Notices

Font redistribution licenses are bundled alongside the font files. Icons are provided by `lucide-react`. Publisher colors do not include logos in the editor or exports. Supplied character artwork and unused publisher logo files remain subject to their owners' rights; this project does not grant a license to that artwork.
