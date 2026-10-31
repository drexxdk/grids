# Gridroom Product And Implementation Plan

Status: proposal, not implemented. Prepared October 31, 2026.

## 1. Product Direction

Build a general-purpose, local-first grid and image-board editor for anime, characters, movies, games, books, cards, photographs, and personal collections. Keep the frontend deployable to GitHub Pages. Expand beyond the reference grid maker through independent layout controls, reusable styling, custom typography, nondestructive image editing, multiple image catalogs, and portable editable projects.

The core editor must work without an account, API key, paid service, or backend. An optional provider gateway can unlock services that require protected credentials or do not support browser requests. Adding that gateway is a separate deployment decision, not a prerequisite for uploads, themes, fonts, or grids.

### Reference Features Confirmed

The live interface at https://www.anime.com/grid/new was inspected without signing in:

- The reference site uses fixed grid-size choices. Gridroom will not copy that approach: use right-edge column and bottom-edge row add/remove buttons instead.
- Square/portrait image aspect switching.
- Grid name, custom-text toggle, shuffle control, and download control.
- Search shows; a characters category is also available.
- Template categories: shows/movies, characters, top 10 anime, anime taste, alignment charts, month charts, and MBTI charts.
- Community selection and a Post control.

These are observed controls, not a claim that every reference-site interaction or export was tested. The site's underlying image provider, exact portrait ratio, authenticated posting flow, and download output were not verified. Use the workflows as reference, not its artwork, branding, source code, or proprietary templates.

### Current Starting Point

- React 19 and Vite, with a GitHub Pages workflow and repository-subpath browser tests.
- Multiple boards, custom uploads, library placement, cell swapping, titles, and grid resizing from 1 to 6 rows/columns.
- Fit/fill, background and gap controls, three bundled display fonts, and comic publisher palettes.
- PNG/JPEG/WebP canvas exports and browser-local persistence.
- Demo content is mixed with runtime fonts and unused files in the public asset directory.
- Defaults, categories, and palette choices currently assume DC/Marvel boards.
- Images are saved as data URLs inside localStorage; there is no true crop editor, provider search, undo history, project backup, or general theme system.
- Export geometry assumes square image cells and fixed proportional header/caption bands.

## 2. Scope And Priorities

| Priority               | Deliverable                                                                                                                                 | Reason                                                                 |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| Foundation             | Chatter-derived UI primitives and tooling, general asset model, versioned storage, stable IDs, shared layout geometry                       | Reuse solved interaction behavior and remove demo-specific assumptions |
| First release          | Edge-based row/column controls, board deletion, visibility toggles, image ratios, themes, custom fonts, crop editor, reliable local uploads | A complete useful editor independent of APIs                           |
| First provider release | Three validated catalogs across at least two content domains, plus uploads and demo packs                                                   | Useful breadth without shipping many fragile integrations              |
| Expansion              | More catalog adapters, templates, batch actions, ZIP export, portability, tier boards                                                       | Distinct advantages over a simple grid maker                           |
| Optional later         | Credential gateway, remote sharing, accounts, collaboration                                                                                 | Introduces hosting cost, privacy, and operational responsibilities     |

Do not describe an integration as supported until search, image loading, export, provider terms, and deployment-origin behavior pass its acceptance gate. Candidate providers are a backlog, not a promise that all permit every editor feature.

## 3. Asset Organization And Demo Content

### Proposed Responsibilities

```text
src/
  components/ui/           Chatter-derived accessible UI primitives
  browser/                 Scrollbar measurement, touch/focus helpers
  assets/fonts/             Build-managed bundled fonts
  fonts/                   Font catalog and loading service
  themes/                  Theme definitions and validation
  templates/               Layout/template definitions
  demo/                    Demo-pack manifests and opt-in loader
  features/editor/         Board viewport, cell controls, inspector
  features/library/        Uploads, collections, provider search
  features/crop/           Crop editing UI
  model/                   Versioned document types, commands, migration
  rendering/               Shared geometry, text layout, canvas export
  providers/               Adapter registry and provider implementations
  storage/                 IndexedDB persistence and media resolution
public/
  demo/comics/             Optional example images, if distribution rights allow
  licenses/                Publicly accessible redistribution notices
  icons/                   App-owned favicon and installation icons
tests/
  fixtures/                Test-only images and fonts, not shipped publicly
docs/
  product-plan.md
```

This is a target ownership map, not a requirement to create every directory before code needs it. Extract modules incrementally. Move build-managed assets through imports instead of leaving every font in the public directory; retain public paths only where stable direct URLs are useful.

- Fresh installations start with one neutral empty 3x3 board, not comic boards.
- Offer a Load Example command inside the usable editor. Do not create a marketing landing page.
- Demo packs have manifests: ID, name, asset paths, default board settings, source/rights information, and attribution.
- Demo packs load only after selection; importing one must not overwrite existing boards.
- Move the current comic content into one optional example pack. Review distribution rights before continuing to publish it; substituting owned/licensed examples is preferable when rights are unclear.
- Keep licenses with clearly identified assets. Font licensing and image licensing are separate.
- Remove the unused global Lucide bundle and unused logos after checking references. Continue using the installed React icon package.
- Move test-only samples out of public builds. Do not make release tests depend on copyrighted demo content.
- Migrate saved relative image paths when demo assets move; keep asset IDs and titles intact. Existing DC/Marvel boards become legacy style presets, not a runtime content taxonomy.
- Empty libraries are valid saved workspaces. Removing every image must not cause a reset back to the demo.
- Default loading must not request demo images or any external image catalog.

Acceptance: production runtime has no automatic demo population; examples remain explicitly available; current saved edits and references survive the migration; licenses remain discoverable.

## 4. Grid Layout And Templates

### Three Separate Controls

1. Grid layout: row/column count and slot arrangement.
2. Image-cell aspect ratio: the shape into which each image is composed.
3. Export dimensions: the final image's pixel size and optional outer canvas ratio.

Changing one must not silently change the others. Portrait cells do not automatically mean a portrait exported board.

### Regular Grids

- No grid-size preset selector. Place plus/minus icon buttons on the right edge to add/remove a column and on the bottom edge to add/remove a row. Each action changes that dimension by one; controls remain available after applying any template.
- Show columns x rows consistently. Keep edge controls outside the composition, visible and reachable on desktop/mobile, with stable sizing, accessible names, tooltips, and keyboard activation. They never appear in exports.
- Add/remove the trailing column or row without rearranging unaffected cells. Preserve stable cell IDs, selection where possible, and recoverable removed placements; resizing is undoable.
- Minimum one row and one column; proposed initial ceiling 12 in each direction, subject to a 144-visible-cell cap and rendering-budget checks. Disable only the relevant action at a limit and explain why; limits are capacity safeguards, not fixed layout choices.
- Image ratio presets: 1:1, 2:3, 3:4, 4:5, 3:2, 4:3, 16:9, and 9:16, plus a validated custom ratio.
- Uniform image ratio per board in the first release. Mixed-ratio or spanning tiles are a later layout mode, not a hidden override that breaks regular grids.
- Separate horizontal/vertical gaps, outer padding, border width/color, optional rounded image corners, and header/caption sizing.
- Optional heading/header, subtitle, footer, rank numbers, row labels, column labels, and per-cell text use explicit on/off switches wherever visibility is a binary choice. A heading is not disabled by erasing its text.
- Persist visibility independently from text and styling. Switching a section off removes its reserved space in preview/export but retains its contents/settings for switching back on; toggles are undoable. Keep editor-only board names separate from visible headings.
- Numbering order: row-first or column-first; optionally omit numbering from exports.
- Reorder/swap, duplicate, clear, lock, and select multiple cells. Keyboard and touch alternatives to drag-and-drop are required.
- Shrinking a grid retains overflow cells in a recoverable tray; increasing it restores them. Confirm irreversible deletion separately.
- Ratio changes preserve originals and focal points; adapt crops without stretching or destructively rewriting images.

### Template System

- Blank grid, top 9/top 10, favorites, watchlist, before/after comparisons, month chart, alignment chart, and 16-slot personality chart.
- Domain-neutral templates with optional content suggestions: anime, games, books, films, characters, personal photos.
- Template data includes slot labels, layout, default aspect ratio, text settings, and suggested theme; no dependency on a provider.
- Preview the template and let the user choose whether to keep existing content, duplicate into a new board, or replace layout.
- Save a board's layout and styling as a reusable personal template without including private images by default.
- Later: hero tile with spans, mixed layouts, collage arrangements, and true tier-list mode with variable-length labeled rows and an unranked tray.

Acceptance: every reference grid size is reachable through edge controls, without presets or template lock-in; square/portrait workflows and custom ratios render consistently in preview/export; unaffected placements stay put; no image is lost when removing/restoring rows or columns; heading switches preserve contents while removing hidden sections from exports.

## 5. Themes And Appearance

Separate editor theme from board/export theme.

### Editor Themes

- Light, dark, and high-contrast palettes, with a System preference that follows the device until overridden.
- Neutral operational UI; preserve dense, useful controls and an unobstructed board viewport.
- Store theme preference globally; changing it must not recolor exported boards.
- Theme tokens for surfaces, text, borders, focus, selected cells, disabled states, and accents.
- All themes must support keyboard focus, readable contrast, loading/error states, and reduced motion.

### Board Themes

- Initial presets: Minimal Light, Minimal Dark, Comic, Poster Wall, Photo Contact Sheet, and Custom.
- Board-level background, heading band, caption band, borders, text colors, text outlines/shadows, corner treatment, and spacing.
- Save named custom themes, duplicate presets, reset individual settings, and import/export theme JSON.
- Optional custom background image with explicit fit/position/opacity; use the same media safety and attribution rules as cell images.
- Provide swatches and live previews, not only theme names.
- Style precedence: preset defaults, then board overrides, then explicit cell overrides. Applying a theme does not silently erase custom titles/crops/overrides; offer a separate reset action.
- Snapshot the resolved style settings into projects so an updated preset cannot unexpectedly change old exports.
- DC/Marvel palettes remain optional legacy/demo presets without being the main theme system. No automatic inference of a publisher from ordinary uploaded images.

Acceptance: editor and export themes are independent; saved custom themes survive reload; preset changes are undoable; preview and export agree.

## 6. Fonts And Text

- A curated, licensed bundled font catalog covering readable sans, serif, condensed, display/comic, and monospaced styles.
- Custom uploads: WOFF2, WOFF, TTF, and OTF where the browser's FontFace implementation can decode them; report unsupported or malformed files.
- Persist font blobs and metadata in IndexedDB, not just an ephemeral object URL or a CSS family name.
- Register fonts under unique internal family IDs so similarly named custom fonts do not collide.
- Use the FontFace API for loading. Wait for required faces before measuring text, rendering the crop preview if text is present, or exporting.
- Font selectors display an actual sample, available weights/styles, and loading/error states.
- Global board fonts for heading, subtitle, captions, and labels, with optional per-cell overrides.
- Text controls: weight/style when supported, size or auto-fit, line-height, alignment, letter spacing, case preservation/uppercase, color, outline, and shadow.
- Caption placement: below image, above image, overlay top/bottom, or hidden. Labels and accessible descriptions are separate from decorative titles.
- Support multiline text, long single words, accented text, CJK, and right-to-left text; expose fallback/glyph limitations honestly.
- Bundled font notices remain available. User font sharing/embedding requires user permission; project export can omit restricted font binaries and identify replacements.
- Optional Google Fonts catalog later; prefer approved self-hosted subsets for stable export and privacy. Do not pretend all Google Fonts can be bundled without reviewing their license and download size.

Acceptance: an uploaded font still renders after reload and project round-trip; canvas exports use the intended font; missing fonts produce a clear fallback decision instead of silently changing typography.

## 7. Images, Uploads, And Cropping

### Imports And Library

- File picker, desktop file drop, clipboard image paste where supported, and mobile photo selection.
- Batch imports with progress, per-file failures, ordering, and cancel support. One failed file must not discard successful imports.
- Initially guarantee JPEG, PNG, and WebP. AVIF is conditional on browser decoding. Animated formats are first-frame imports initially; HEIC conversion is a separately evaluated feature.
- Do not inject uploaded SVG markup into the DOM. Either reject it initially or implement a vetted sanitized/rasterized path with no external resource execution.
- Validate file size, decoded pixel dimensions, real decode success, and type. Proposed starting limits: 20 MB/file and 40 megapixels, refined by mobile benchmarks.
- Detect duplicate content with a hash; reuse binary media while allowing different cell crops and titles.
- Library search, rename, tags, collections, favorites, recent imports, used/unused filtering, and source metadata.
- Deleting media used by boards requires a choice to cancel, replace, or clear affected placements. Offer undo and recoverable trash before permanent deletion.
- URL imports accept HTTPS image resources only, not arbitrary webpage scraping. Explain unsupported CORS, broken URLs, or provider restrictions and retain upload as a fallback.
- Locally imported images never leave the device unless a future explicit sharing/upload action is approved.

### Nondestructive Crop Editor

- Use a maintained library such as react-easy-crop for touch-friendly crop interactions; do not hand-roll the crop gesture engine.
- Drag to pan, zoom slider/stepper, rotate, flip horizontally/vertically, center/reset, and an aspect-ratio lock matching the destination cell.
- Live target-cell preview and optional composition guides. Apply/Cancel creates a single undoable operation; cancelling changes nothing.
- Preserve original images. Persist normalized crop/focal point and transforms per cell, not as a globally replaced asset or repeatedly re-encoded image.
- Same source can appear twice with different crops without duplication of the original bytes.
- Preserve focal point when changing cell ratio; offer Reset Crop or Keep Composition. Clamp invalid crop regions deterministically.
- Apply a transform to selected cells, or reset a selection, when provider permissions allow it.
- Provider-specific permissions can disable cropping, rotation, filters, or overlays; expose a readable reason.
- Later extras: brightness, contrast, saturation, grayscale, and optional local background removal. These are secondary to reliable crop geometry and must obey image-source rules.

Acceptance: crop pan/zoom/rotate/flip matches exported pixels, survives reload, remains independent across reused images, works with touch/keyboard, and never mutates the original.

## 8. Provider Strategy

### Candidate Catalogs

Every row remains subject to current terms, endpoint health, query CORS, image-CDN CORS, export permissions, and rate limits. Direct candidate means worth testing in the browser, not already verified here.

| Provider                        | Content                                                            | Proposed access                                                    | Important gate                                                                                                        |
| ------------------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------- |
| AniList                         | Anime, manga, character portraits                                  | Public-query direct candidate; OAuth only for later personal lists | Review API terms/use limits and image export/CORS                                                                     |
| Jikan                           | Anime, manga, characters via unofficial MAL API                    | Keyless direct candidate                                           | Documented 3 requests/sec and 60/min; upstream outages; independent image rights                                      |
| Wikimedia Commons               | Broad photography, illustrations, public-domain/open-license media | Keyless direct candidate                                           | API origin=\* support; retain per-file license/creator; test actual image CDN                                         |
| Open Library                    | Books and author photos                                            | Keyless direct candidate                                           | Respect cover hotlink guidance/no bulk crawling; verify export/CORS separately                                        |
| Scryfall                        | Magic cards and provided art crops                                 | Keyless direct candidate                                           | Full cards cannot lose artist/copyright marks or be distorted/filtered; approved art crops need artist/source context |
| PokéAPI                         | Pokemon metadata and sprites                                       | Keyless direct candidate                                           | Sprite resolution, artwork rights, source hosts, and export quality                                                   |
| The Met Collection              | Public-domain museum collection imagery                            | Keyless direct candidate                                           | Only enable downloadable/open-access imagery with valid rights metadata                                               |
| NASA Image and Video Library    | Space imagery                                                      | Keyless direct candidate                                           | Asset-specific restrictions, credits, image resolution, and endpoints                                                 |
| MusicBrainz + Cover Art Archive | Album metadata and cover art                                       | Direct candidate or gateway depending on service headers/limits    | Two-service lookup; identification requirements, cover rights, CDN exportability                                      |
| TMDB                            | Film/TV posters, backdrops, people                                 | Managed credential gateway recommended                             | Application auth and required branding/attribution; poster/people coverage and export rights                          |
| IGDB                            | Game covers, artwork, screenshots, characters                      | Gateway required                                                   | Official docs prohibit browser requests; Twitch client secret/token lifecycle; usage terms                            |
| RAWG                            | Games and screenshots                                              | Credential gateway candidate                                       | Current API access, licensing, quotas, attribution, and image export                                                  |
| Unsplash                        | Photography                                                        | Approved application access; gateway recommended for quota control | Mandatory hotlinking, photographer/Unsplash attribution, and download tracking; caching/export policy                 |
| Pexels                          | Photography                                                        | Credential gateway candidate                                       | Current API rules, attribution, quota, and storage/export policy                                                      |
| Pixabay                         | Photography and illustrations                                      | Credential gateway candidate                                       | Current API rules, caching/hotlink requirements, rights, and quotas                                                   |
| Europeana                       | Cultural collections                                               | Credential gateway candidate                                       | Per-object rights, provider links, variable image availability                                                        |

Suggested order: spike AniList and Jikan, choose the more reliable first anime integration, then add Wikimedia Commons and one books/art/card integration that clears export policy. Extend toward films, games, and photography after the gateway decision. Maintain all 16 candidates in the registry backlog, but do not ship disabled buttons implying unavailable providers work.

Scryfall and Unsplash demonstrate why availability of an API is not blanket permission to crop, cache, or redistribute its images. Do not solve terms restrictions by proxying images. Metadata licensing does not automatically license artwork.

### Adapter Contract

- Registry: provider ID, domain/category, icon, capabilities, configuration needs, availability, policy summary, and supported filters.
- Operations: search, get item/details, list image variants, resolve permitted preview/export resources, and perform required selection/download attribution hooks.
- Normalize results into entity ID, provider ID, title/alternative titles, type, year, source page, thumbnail, image variants, dimensions, creator, license/rights, and attribution requirements.
- Keep entity identity distinct from image identity; a film can have multiple posters and a book multiple edition covers.
- Keep provider provenance when combining catalogs. Deduplicate by authoritative cross-provider IDs where available, not only by a similar title.
- Search starts in one chosen provider/domain. Optional combined search later queries only user-enabled providers with controlled concurrency; do not fan out to every catalog on every keystroke.
- Debounce text searches, cancel stale requests, paginate, cache within provider policy, respect Retry-After, and maintain per-provider throttling.
- Loading, empty, offline, unavailable, quota, unsupported-domain, and authorization states are distinct and actionable.
- Variant picker supports posters, portraits, backdrops, editions, language, and resolution when supplied.
- A user can place in the selected cell, queue results, or batch-fill empty unlocked cells. Never overwrite populated cells without a deliberate replacement action.
- Search-result selection is not a promise of export readiness. Validate/cache or retain the required remote representation before confirming placement.
- Provider searches reveal query text and network identity to that service; explain this in privacy settings. Upload-only workflows remain independent of search.

### Provider Acceptance Gate

For each adapter, record a small compatibility report with date and deployment origin:

1. Search and pagination work without leaking protected credentials.
2. Returned image variants load from the real GitHub Pages origin.
3. A CORS-safe fetch/decode or approved image path can generate an untainted canvas export.
4. Required attribution and transformations/storage restrictions are represented in UI, documents, and export behavior.
5. Missing images, timeouts, bad responses, 429s, and access failures recover without damaging the board.
6. No persistent cache or offline export promise exceeds provider permissions.

Use mocked fixtures in routine tests; perform small real-provider smoke checks separately to avoid unreliable CI and excessive API usage.

## 9. Hosting And Optional Gateway

- Keep React/Vite frontend and all local editing on GitHub Pages, including repository-subpath-safe assets.
- Direct browser providers are possible only where query AND image access are compatible.
- Setting an image's crossOrigin before src requests CORS permission; it does not manufacture permission. A preview-visible image can still taint a canvas or fail an anonymous image load.
- Never place protected API secrets or tokens into VITE\_\* variables, checked-in configuration, static JavaScript, or public project files. Frontend build variables are public.
- Optional gateway recommendation: a small separately deployed Cloudflare Worker, or an equivalent serverless service, enabled only after approval of credentials, terms, and costs.
- Gateway uses fixed provider routes and validated resource identifiers. No unrestricted fetch-any-URL proxy.
- If image fetching is permitted, constrain HTTPS hosts and paths, validate redirects at every hop, block private/reserved network targets, enforce file/type/dimension/time limits, and apply quotas/caching policies.
- Restrict CORS origins, but do not treat CORS as authentication or quota protection. Add independent request budgets and abuse controls.
- Keep gateway credentials and rotation server-side. Do not log secrets, private uploads, or full sensitive query payloads unnecessarily.
- Provider kill switches and bounded caches limit costs during outages or abuse.
- Missing gateway configuration disables only relevant catalogs; it does not disable the editor.
- No public unaudited CORS proxies; no automatic upload of private images to remote conversion/cropping services.
- Public sharing, synchronization, and collaborative editing require a separate storage/auth/backend plan; they cannot be supplied by GitHub Pages alone.

## 10. Documents, Storage, And Undo

### Versioned Domain Model

| Record    | Main responsibilities                                                                                       |
| --------- | ----------------------------------------------------------------------------------------------------------- |
| Workspace | Schema version, ordered board IDs, active board ID, collections, preferences                                |
| Board     | Stable ID, name, layout type, grid dimensions, ratio, ordered cell IDs, style snapshot, export settings     |
| Cell      | Stable ID, placement/image ID, caption/alt text, crop/focal point, transform, lock state, style overrides   |
| Media     | Stable ID/hash, original/thumbnail blob refs, dimensions, MIME, origin kind, provider provenance and rights |
| Font      | Stable ID, internal family, weight/style metadata, blob ref, source and sharing permissions                 |
| Theme     | Stable ID/version, validated tokens, named preset/custom definition                                         |
| Template  | Stable ID/version, slot labels/layout and default style references                                          |

- Stable selected-cell and board IDs replace fragile array-index identity for async imports and layout changes.
- Async import captures destination board/cell ID and resolves against the latest document; deleted/resized destinations do not receive misplaced assets.
- Separate ephemeral UI state from saved document state: selection, open panels, crop drafts, request progress, and provider results.
- Start with typed TypeScript domain/render/provider modules and Zod boundary validation; convert UI files incrementally rather than mandating a big rewrite first.
- Central document commands/reducer for placement, edits, layout changes, and bulk actions. Reuse React first; add a dedicated state library only if interaction/subscription needs justify it.
- Undo/redo covers text, crops, layout, templates, board deletion, and batch operations. Coalesce typing and slider drags; one Apply or bulk action is one history entry.
- History references media IDs and small document patches, not repeated copies of full image binaries. Keep deleted media recoverable while referenced by history/trash.
- Board deletion is a first-release core command, not a later batch-tool feature. Provide a visible trash-icon action beside active-board navigation, with an accessible board-specific name and tooltip; do not bury deletion exclusively in a context menu.
- Deleting a board selects a surviving adjacent board by ID and offers Undo without a mandatory confirmation for a recoverable action. Deleting the last board leaves an intentional empty workspace with an Add Board command; do not silently recreate demos. Restoration includes cells, media references, layout, headings, and visibility settings.

### IndexedDB And Migration

- Use Dexie for boards/media/fonts/thumbnails and transactional persistence. localStorage holds only small global preferences and a migration marker.
- Generate temporary object URLs for display and revoke them when released; regenerate them from stored blobs after reload.
- Debounced autosave shows Saving, Saved, or Save Failed based on completed persistence, not optimistic UI alone. A failed save must not appear durable.
- Migrate gridroom-v1 in an idempotent transaction: validate, extract image data URLs to blobs, translate legacy fonts/styles/paths, verify references, then mark success.
- Keep the legacy source until migration completes; quota or decode failure must not destroy the only copy. Offer backup/retry.
- Missing assets/fonts remain identifiable with repair actions; do not replace the whole workspace with demos after one malformed reference.
- Storage usage, unused-media cleanup, recoverable trash, backup reminder, and best-effort persistent-storage request.
- Multi-tab protection with revision checks and BroadcastChannel notifications; never silently overwrite a newer tab's document.
- Local browser storage is not a permanent backup or synchronization system. Explain origin changes and browser eviction.

Acceptance: existing workspaces migrate without losing edits; empty libraries persist; failed writes/partial migrations retain recoverable data; undo does not balloon memory with images.

## 11. Preview And Export

- Introduce a shared layout/composition builder that resolves numeric geometry, cell rectangles, header/caption/footer blocks, text line breaks, crop coordinates, and styles.
- Keep an accessible DOM editor with focusable cells and text inputs. DOM preview and canvas export consume the same composition; avoid independent square-cell formulas and crop calculations.
- Renderer supports arbitrary image ratios, optional text, borders/clips, backgrounds, font faces, and permitted rotations/flips.
- Preserve PNG/JPEG/WebP. PNG/WebP transparency is optional; JPEG requires an explicit flatten background. Validate actual encoded MIME support.
- Export controls support final width/height or scale, common social sizes, quality, filename, and optional labels/credits. Do not stretch the composed grid to force a final ratio; use padding or a reviewed layout adjustment.
- Preflight all images/fonts/policies before drawing. Report the exact missing or nonexportable placements; offer replacement, retry, or an explicit placeholder export, never silent omission.
- Show output dimensions, likely file-size range when estimable, and effective image resolution/upscaling warnings.
- Bound output megapixels and simultaneous decoded images. Proposed starting budgets: 16 MP mobile and 32 MP desktop, subject to browser/device probes and refinement; these are ceilings to validate, not universal capacity guarantees.
- Decoded canvas memory is roughly four bytes per pixel before image buffers, rotated intermediates, thumbnails, and encoding. Grid count alone is not a safe memory limit.
- Export one board at a time; stream/batch media decoding where practical. Add worker rendering with OffscreenCanvas only after capability testing, with a main-thread fallback.
- Progress/cancel and smaller-resolution recovery. Do not promise unlimited-resolution output on mobile browsers.
- Multi-board ZIP export using fflate avoids repeated-download prompts; preflight memory and process boards sequentially.
- Editable .gridroom archive: versioned JSON plus permitted media/fonts, thumbnails, and attribution manifest. Restricted fonts/media remain references with explicit portability limitations.
- Archive imports validate schema, paths, file count, compressed/uncompressed sizes, and pixel dimensions before modifying the workspace; protect against zip bombs and unsafe paths.
- Theme/template JSON exports exclude private media and credentials.
- Later: image copy to clipboard, native share where supported, and downloadable attribution sheet. Required image credits are not an optional toggle when source terms demand them.

Acceptance: export geometry and crop pixels agree with preview across ratios/themes/fonts; errors identify offending cells; portable upload-only projects round-trip offline without external dependencies.

## 12. Interface And Accessibility

- Desktop: compact top toolbar, central board viewport, left library/search, right contextual inspector. Avoid opening several competing settings panels at once.
- Toolbar: board navigation with easy deletion, undo/redo, ratio selector, template command, appearance, and export. Grid growth/shrink controls live on the right/bottom edges, not in a preset menu.
- Library tabs: Uploads, Search, Collections, Examples; domain/provider filters belong to Search, not a permanent DC/Marvel filter.
- Inspector sections: Layout, Appearance, Typography, Cell; reveal context-specific controls rather than a single huge form.
- Mobile: board stays the primary surface; library/inspector become deliberately opened sheets with touch-friendly controls and no input autofocus.
- Use Headless UI wherever an appropriate primitive exists: Dialog, Menu, Listbox/Combobox, Disclosure for accordions, Switch for binary toggles, and TabGroup for views. Ordinary add/remove icon commands remain semantic buttons.
- Use Motion (`motion/react`) for dropdown/menu entry/exit, accordion expansion/collapse, modal/sheet entry/exit, and toggle thumb/state animations. Motion owns animation; Headless UI owns semantics, interaction, and focus. Honor reduced motion and use viewport-edge modal scrolling.
- Tailwind for new UI styling and shared tokens. Migrate existing stylesheet rules by feature when practical; retain custom rules only for a concrete rendering/typography need.
- Lucide icon tools with names/tooltips; swatches for colors, segmented selectors for fit modes, toggles for binary states, and numeric steppers/sliders.
- Full keyboard editing and accessible move/swap commands; no drag-only workflows. Focus restoration must not summon the mobile keyboard.
- Theme contrast, visible selection/focus, accessible crop controls, progress announcements, touch targets, and correct disabled/loading states.
- Prepare count-based strings as single plural-aware messages if localization is introduced. Include Unicode/RTL text in typography tests.
- Keep the first screen a usable editor. No feature-explanation marketing text or demo-dependent welcome wall.

### Required Frontend Stack

Use `C:/Users/draxx/Sources/Chatter/apps/web` as the implementation reference, not merely as visual inspiration. Its frontend files were inspected for this plan. Copy/adapt the relevant owned code and behavior rather than re-solving known modal, scrollbar, focus, and popup problems.

| Layer                 | Choice                                                            | Reuse boundary                                                                                                          |
| --------------------- | ----------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| UI framework          | React with TypeScript and Vite                                    | Keep this app independently deployable; do not adopt Chatter's monorepo/backend                                         |
| Accessible primitives | `@headlessui/react` v2                                            | Dialog, menu, listbox/combobox, Disclosure accordions, tabs, and switches; Motion owns animations                       |
| Styling               | Tailwind CSS v4 with `@tailwindcss/vite`                          | Utility-first UI and theme tokens; small global browser/rendering rules are intentional exceptions                      |
| Animation             | `motion`, imported from `motion/react`                            | Dropdowns, accordions, modals/sheets, switches, and view transitions via shared primitives; reduced motion is mandatory |
| Component variants    | `class-variance-authority` and `clsx`                             | Consistent buttons, inputs, tool states, and surfaces                                                                   |
| Icons                 | `lucide-react`                                                    | Reuse the current icon library; icon buttons have accessible names/tooltips                                             |
| Notifications         | `sonner` when the notification layer is built                     | Save/import/export feedback; do not replace inline actionable errors with disappearing toasts                           |
| Quality tooling       | TypeScript, ESLint, Prettier, Vitest, Testing Library, Playwright | Adapt frontend-only configuration and focused checks                                                                    |
| Conditional additions | Floating UI and TanStack Virtual                                  | Only when advanced anchored popups or large catalog libraries need them                                                 |

Select compatible supported package versions at installation time, using Chatter's working setup as guidance rather than copying its entire dependency manifest. Its chat-specific packages, server checks, authentication, TipTap, sockets, Redis, CMS, and deployment scripts are not prerequisites here. Localization can reuse its i18next/ICU approach when introduced, but is not required just to render a modal.

### Concrete Chatter Reuse Map

The following paths are relative to the Chatter repository, not files already present in Gridroom:

- `apps/web/src/components/Modal.tsx`: dialog structure, title/close controls, mounted-open entry behavior, delayed close completion, and view-change behavior.
- `apps/web/src/scrollbarWidth.ts`: measure the reserved scrollbar gutter and publish `--scrollbar-width`; do not remeasure it as zero while a dialog has removed the gutter.
- `apps/web/src/index.css`: stable root gutter plus the portal-dialog rule that locks scrolling, removes the gutter, compensates page padding, and publishes `--fixed-scrollbar-inset`.
- `apps/web/src/components/ViewTransition.tsx`: `LazyMotion`, `domAnimation`, `MotionConfig reducedMotion="user"`, and `AnimatePresence`; exiting views become inert and hidden from assistive technology.
- `apps/web/src/components/FocusSearch.tsx`: intentional desktop search focus without automatically opening the keyboard on touch devices; carry its touch-detection dependency too.
- `apps/web/src/components/ReturnFocus.tsx`: restore lost keyboard focus to the trigger with `preventScroll`, without stealing focus after pointer use.
- `apps/web/src/components/dropdown.ts`: shared surface/viewport constraint patterns; replace chat header/composer variables and forced dark scrollbars with editor geometry and theme tokens.
- `apps/web/src/components/SideDrawer.tsx`: accessible sheet structure and shared backdrop/header; adapt scrolling to the editor workflow rather than copying its chat sidebar sizing blindly.
- Inspect the shared Button component and its local dependencies when implementing the primitives; adapt variants to editor tools without inheriting chat translation keys or branding.

Do not copy Chatter's whole stylesheet, glass palette, route-depth animations, or room-specific offsets. Reuse interaction correctness while preserving Gridroom's domain, multiple themes, and existing editor layout. Keep a brief source/adaptation note for copied primitives and comply with any applicable source/dependency license requirements.

### Modal Scrollbar Takeover Contract

This is required baseline behavior, not an optional polish task:

1. The document normally reserves its scrollbar gutter so short/long content changes do not shift the page.
2. Before a dialog opens, publish the actual gutter width, including zero for overlay scrollbars. Initialize once and update safely on viewport changes.
3. While a Headless UI portal contains a modal dialog, lock background document scrolling and switch the document's gutter to auto.
4. Replace the removed gutter with equal page padding, overriding conflicting Headless UI compensation. Fixed-position editor controls account for the published inset as needed.
5. A fixed full-viewport modal frame owns vertical overflow. Its scrollbar occupies the viewport edge where the page scrollbar was; a long ordinary modal does not become a small scrollable DialogPanel.
6. Keep the portal/dialog mounted through its exit transition. The CSS lock follows DOM presence so background scrolling does not return as soon as the open prop changes.
7. On final removal, restore page gutter/scrollability and the original scroll position without a jump. Nested dialogs keep the lock until the last modal leaves.
8. Preserve a single full-frame scroll owner, safe viewport padding, and access to controls on narrow screens/with the virtual keyboard. Specialized crop canvases may manage gestures internally, but do not become accidental nested page scrollers.

Chatter's modal currently uses Headless UI/CSS transitions for entry/exit and the Web Animations API for in-dialog view changes. Its broader page transitions use Motion. Reuse its scroll/focus/lifecycle behavior, but adapt modal and in-dialog animations to Motion for this project. Do not copy the legacy animation owners alongside Motion.

Build one shared integration pattern using Motion presence/state animation and Headless UI's supported controlled/static rendering APIs as appropriate. Retain the dialog/portal and required focus/scroll protection through exit, then complete dismissal and focus restoration once. Apply the same single-owner principle to dropdowns and accordions: closed/exiting contents cannot remain interactive or keyboard-focusable. Switch values change immediately; the thumb animation is only presentation. Test rapid open/close/reopen and reduced motion without stuck intermediate states.

Adapt the scrollbar helper to clean up its probe/listener on teardown or hot-module reload and refresh measurements after the final dialog closes if the viewport changed while it was locked. Verify browser support for the `:has` portal selector and define a fallback only if the supported-browser policy requires it.

### UI Primitive Acceptance Checks

- Open a modal while the editor is scrolled: underlying board and toolbar positions stay stable, background wheel/touch scrolling is blocked, and a long modal scrolls at the viewport edge.
- Test short pages, long pages, classic scrollbars, overlay-scrollbar behavior, and viewport changes during an open dialog; compensation must not add a double gutter.
- Check both the closing animation and final unmount: no early scrollbar return, no page jump, no lingering lock/padding after cleanup.
- Nested dialogs retain correct scroll locking and topmost keyboard focus. Close the outer flow only after the appropriate topmost interaction.
- Escape, backdrop click, close button, and programmatic closure restore focus predictably; no focusable duplicate exit view remains.
- Desktop intentional search focus works; mobile opening/closing menus/dialogs/sheets does not autofocus a text field or summon the virtual keyboard.
- Motion animates dropdowns, accordions, dialogs/sheets, and switches through shared primitives. Keyboard/assistive-technology states track actual state, not animation progress; rapid reversals and reduced motion do not leave hidden focus targets or stuck panels.
- Long modal contents, empty states, and sheets keep frame-owned bottom spacing and usable controls at mobile sizes.
- Reduced motion, light/dark/high-contrast themes, and accessible titles/announcements work. Do not hardcode dark scrollbar styling into every popup.
- Use real-browser Playwright tests for scrolling, viewport geometry, and portal lifecycle; DOM-only tests cannot certify scrollbar behavior. Compare geometry against the page body's bounds where stable gutters affect viewport metrics.

## 13. Implementation Phases

### Phase 0: Compatibility Spikes And Decisions

Work: test an anime provider and its image CDN from the deployed origin; choose crop library; define composition coordinates; prototype custom FontFace loading; benchmark realistic phone-size exports; review demo rights.

Deliverable: short provider compatibility notes, documented limits, schema draft, and accepted local-first/gateway boundary.

Gate: at least one provider image can legally and technically survive search -> placement -> crop policy -> canvas export; otherwise proceed upload-first while replacing that candidate.

### Phase 1: General Foundation And Demo Separation

Work: establish the Chatter-derived frontend stack and shared Headless UI/Motion primitives first, including dropdowns, accordions, switches, modal scrollbar takeover, and focus regression checks; then stable IDs/schema version, incremental editor module separation, IndexedDB media storage and legacy migration, explicit example packs, neutral empty defaults, transactional save status, document commands, initial undo, and visible undoable board deletion.

Dependencies: Phase 0 schema/storage decisions.

Gate: modal scrollbar takeover, exit lifecycle, focus, and theme-aware primitives meet the UI acceptance checks; legacy boards and custom edits survive; an empty workspace remains empty; examples are opt-in; upload/cell operations and existing export checks remain green.

### Phase 2: Layout And Rendering

Work: shared geometry/composition, right-edge column and bottom-edge row add/remove controls (no grid-size presets), cell aspect ratios, padding/gaps/borders, heading/caption/footer visibility switches, recoverable overflow, resolution preflight.

Dependencies: stable cell IDs and new schema from Phase 1.

Gate: reference sizes remain reachable after any template without layout lock-in; edge controls are usable on desktop/mobile; custom ratios export correctly; removing/restoring rows or columns preserves unaffected placements; visibility switches retain text/settings and remove hidden sections from exports.

### Phase 3: Appearance And Typography

Work: independent editor/board themes, tokenized styling, custom theme persistence, font catalog, custom font upload/storage, text layout/options, per-cell style overrides.

Dependencies: shared text/composition path from Phase 2.

Gate: custom fonts reload/export correctly; editor theme does not change output; custom style precedence and legacy palettes remain predictable.

### Phase 4: Image Editing And Library

Work: crop library integration, normalized crop/rotation/flip, touch controls, copy/reset transforms, clipboard/batch import, deduplication, collections, referenced-media deletion/trash.

Dependencies: media storage, shared image transforms, command history; custom backgrounds reuse this media path.

Gate: same image can have two independent crops; undo/apply/cancel work; original bytes remain unchanged; mobile gestures and exported pixels match.

### Phase 5: Initial Catalog Search

Work: provider registry/adapters, search UI, pagination/cancellation/throttling, normalized provenance, image variants, per-source policies/credits, preflight export validation; ship three catalogs that pass the gates.

Dependencies: compatibility spikes plus media/policy/crop/export foundations.

Gate: upload-only core still works offline; a failed catalog cannot damage boards; no protected credentials in static assets; provider terms and deployment-origin image export verified.

### Phase 6: Templates, Batch Tools, And Portable Projects

Work: template catalog/personal templates, multi-selection, lock/shuffle/sort/fill-empty actions, board duplicate/reorder, ZIP output, .gridroom round-trip, attribution manifests. Board deletion already ships in Phase 1.

Dependencies: stable commands/history, themes, shared renderer, media/font policy model.

Gate: a project with uploaded images, custom fonts, and different crops opens correctly in a clean browser; archives cannot overwrite arbitrary data or exceed import limits.

### Phase 7: Provider Breadth And Optional Gateway

Work: approve/deploy gateway, secret rotation and abuse protection, then films/games/photography adapters and additional open catalogs. Add providers one at a time through the same contract tests.

Dependencies: explicit hosting/credentials/cost approval; Phase 5 adapter acceptance gates.

Gate: frontend remains independently deployable to Pages; gateway outage degrades only affected search; quotas, policy compliance, and credential protection verified.

### Phase 8: Advanced Boards And Sharing

Work: tier-list mode, spanning/irregular collage layouts, worker/performance improvements, optional installable offline shell, then separately scoped remote sharing/accounts/collaboration.

Dependencies: demonstrated demand and explicit approval for server-backed capabilities.

Gate: new layout modes do not corrupt regular grids; any cloud feature has a defined privacy, authentication, moderation, retention, and operating-cost plan.

Recommended first implementation package: Phases 1 and 2, with the small Phase 0 risks resolved first. Do not begin with sixteen provider integrations or cloud accounts.

## 14. Verification And Release Criteria

- Unit coverage for layout rectangles, ratio conversion, text sizing, transforms, ID-based commands, migration, and theme precedence.
- Crop/export fixtures with known pixels: square/portrait/landscape, pan/zoom/rotate/flip, transparent images, long text, and custom fonts.
- Browser flows for upload, right/bottom edge resizing and overflow recovery, active/last-board deletion and undo, heading/section switches with text retention and export parity, crop apply/cancel, undo/redo, themes, font reload, templates, project round-trip, and downloads.
- Failure checks for quotas, corrupt files/fonts, missing media, interrupted migration, provider 429/timeouts, stale searches, CORS failures, and archive limits.
- Mock provider traffic in CI; tiny real-service tests separately at integration/release checkpoints. Never run bulk catalog crawls for tests.
- Desktop/mobile screenshot review, no text overflow, keyboard-only use, touch alternatives to dragging, reduced motion, and high-contrast theme checks.
- Keep current deployed-subpath Playwright coverage and extend it to examples, font imports, workers/archives, and configured gateway URLs as those features land.
- Run the smallest behavior-scoped checks during development; run the relevant integrated release set when shared rendering/storage changes or a milestone ships.
- Require migration, crop/export fidelity, and provider-policy gates before public release. Build success alone is not a rendering or data-integrity test.

## 15. Open Decisions

Defaults recommended here are intended to let implementation proceed without a long requirements interview:

- Fresh workspace: neutral empty 3x3, square cells, system editor theme, Minimal board style.
- First catalogs: one validated anime provider, Commons, and one export-compatible books/art/card provider. AniList and Jikan both remain candidates for expansion.
- Custom fonts mean local file uploads in the first release; hosted font browsing is optional later.
- Regular grids first; true tier rows and mixed/spanning collage layouts later.
- No accounts, cloud storage, or arbitrary public plugin execution in the first release.
- Gateway hosting/credentials and continued distribution of current demo artwork require explicit decisions before those features ship.
- Performance limits are adaptive, validated starting budgets, not an unlimited feature promise.
- Timeline/effort estimates should follow the Phase 0 provider/crop/storage spikes; no fixed delivery date is assumed.

## Sources And Research Limits

- Reference interface: https://www.anime.com/grid/new (live controls inspected).
- AniList documentation: https://docs.anilist.co/ (public overview; detailed terms/export behavior still to validate).
- Jikan documentation: https://docs.api.jikan.moe/.
- MediaWiki CORS: https://www.mediawiki.org/wiki/API:Cross-site_requests.
- Open Library cover guidance: https://openlibrary.org/dev/docs/api/covers.
- TMDB application authentication: https://developer.themoviedb.org/docs/authentication-application.
- IGDB authentication and browser/CORS restrictions: https://api-docs.igdb.com/.
- Unsplash API requirements: https://unsplash.com/documentation.
- Scryfall image-use restrictions: https://scryfall.com/docs/api.

Documentation was reviewed for planning, not a live integration certification. The remaining catalog candidates have not been independently checked in this planning pass. Recheck current terms and actual deployed-origin requests before implementation; technical access is not proof of image reuse permission.
