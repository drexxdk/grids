# Gridz Roadmap

Updated November 3, 2026. `[x]` = implemented and checked. `[ ]` = remaining work, including partial features. Only work items have checkboxes.

Build a general-purpose, single-grid editor for anime, characters, films, games, books, cards, photographs, and personal collections. Guests can use it without an account, API key, paid service, or backend. Optional provider accounts save named reference-only grids and private/public layout/style presets in Postgres. Uploaded images remain browser-only; provider image binaries are not persisted. The static frontend can stay on GitHub Pages, but authentication/database access needs a separately hosted backend.

This is a new project with no users or real data. Prototype schemas, storage keys, and demo saves can be replaced or reset during development. Do not build legacy migrations, compatibility layers, or backup/recovery flows for prototype data.

## Agreed Direction

- One working grid, not a multi-board workspace. No board tabs, Add Board, duplication/reordering, or multi-board export.
- Guests automatically save grid/media to IndexedDB and a settings-only cache to localStorage. Reset grid settings is a separate confirmed action; removing library images preserves canvas placements.
- Next, integrate image providers across anime/characters, film/TV, games, books, music, cards, photography, art/cultural collections, and space imagery. Start with browser-compatible keyless sources, then add credentialed sources only after their hosting/policy requirements are approved. Guest search/import must not depend on Gridz sign-in.
- Google, Discord and Facebook are the only account types. Named grid saves/loads and private/public presets are explicit actions; login/logout never silently replace the browser draft.
- Keep direct Canvas, Heading and Card style controls, with optional reusable layout/style presets rather than Theme/Sub-theme hierarchies. One Gap controls heading-to-grid and inter-card spacing; Canvas padding/background belong to the exported composition, not the dotted workspace.
- Store validated settings-only presets and reference-only grids (captions, crops, approved provider metadata/URLs and opaque browser-local image IDs), never image/font binaries, blob/data URLs or local paths. A different browser reloads provider images but cannot recover local uploads.
- No local username/password accounts or implicit provider linking.

The single-grid editor, guest autosave/reset, provider-only account API, Docker Postgres and saved-grid/preset UI are implemented in npm workspaces. Live provider consent/configuration and production hosting still need deployment checks.

Current limits: local-upload blobs and grid/reference snapshots use IndexedDB; localStorage holds a settings-only cache and separate navigation preferences. Uploaded-font/thumbnail storage remains pending. Revision checks prevent stale multi-tab writes; conflict warnings require confirmed reload rather than automatic merging. Browser saves are automatic and debounced; account saves are explicit. Browser storage is not permanent backup. Library removal has no confirmation or trash UI and preserves canvas images. There is no undo feature or removed-cell recovery tray, though expanding restores saved overflow cells. Portrait/landscape/square tiles, direct appearance/typography settings and nondestructive per-cell fullscreen cropping are implemented. Online supports Commons and The Met; see [provider compatibility](providers.md). Additional ratios, advanced transforms, uploaded fonts and project archives remain unfinished. Real account consent and production hosting require deployment checks. Canvas caps do not guarantee device memory safety. Prototype storage is not a compatibility requirement.

## Development Order

**Next: expand reviewed image providers and complete account deployment checks.** Credentialed image providers require explicit hosting/terms approval. Provider-only accounts and grid/preset saves are implemented in step 3; password accounts are excluded. Failed catalog or account services must not block the guest upload-only editor. Candidate providers are not support promises, and no fixed delivery dates are assumed before compatibility checks.

### 1. Single Grid And Guest Storage

- [x] Replace the multi-board workspace with one grid and persisted export preferences; remove board navigation/add/delete/duplicate/reorder and Export All controls. Retain stable cell IDs and separate session UI state.
- [x] Start with a clean versioned schema/storage key, defaults, and strict Zod boundary validation. Ignore obsolete or invalid prototype saves; no multi-board selection, migration, or backup UI.
- [x] Guest autosave with settings-only localStorage and IndexedDB local-upload/reference storage. Reset retains local images/captions/placements. Saving/Saved/Save failed report real completion; unavailable storage leaves session editing/export usable. Account saves use separate server contracts.
- [x] Separate layout/style settings from cell content/media. Preset APIs accept the settings-only allowlist; saved-grid APIs use the reference-only contract, never the full local document. Shared schemas validate both boundaries.
- [x] Central typed document commands/React reducer for current mutations, with ID-based live targets, immutable updates, atomic batch imports, media-preserving replacement, and replay-stable resize/reset commands. Session UI and pending async work stay outside saved state; future crop drafts/provider requests must follow this boundary. No additional state library.
- [x] Fresh Dexie/IndexedDB storage for client-only image blobs and coherent grid snapshots, separate from account-settings payloads. Serialized transactional saves, validated restoration, managed/revoked object URLs, rollback/retry, and missing-image overwrite protection. The document's localStorage cache stores only settings; no prototype migration.
- [x] Remember editor navigation independently of grid/settings saves: shareable tab/provider/search/topic/raw-cursor URLs with Back/Forward support; validated local sidebar visibility, picker source, and per-provider/sidebar/picker browsing positions and previous cursors. Direct links override saved navigation, malformed/blocked preference storage is safe, and transient dialogs/mobile overlays never reopen automatically. Search terms are visible in links; local media and grid content are excluded.
- [ ] Extend client-only binary storage to uploaded fonts and generated thumbnails alongside those features; manage their object URLs and keep files out of account settings. Bundled fonts remain static assets for now.
- [x] Debounced Saving/Saved/Save Failed status: coalesce edits for 300 ms, flush on page hide, retain unsaved-navigation guards, and retry failed saves on subsequent edits. Background flush is best-effort, not a guarantee against abrupt termination.
- [x] Quiet automatic browser saving without storage-management controls or persistence requests; retain actionable failure/conflict warnings. Keep confirmed Reset grid settings at the bottom of the style settings on desktop and in the expanded mobile drawer. Combine export options and Download image in the header's Export grid dialog. Browser storage is not permanent backup or synchronization.
- [x] Direct library removal: hover/tap per-image Delete and Clear all images below the library, without confirmations or trash UI. Preserve visible/removed-cell placements and captions; retain referenced media locally while hiding it from the library and picker across reloads. Delete unused blobs and metadata transactionally and revoke URLs only after success. Failed writes retain stored data/URLs until retry commits. Upload is the first library tile and expands when empty. Define media retention alongside new media types.
- [x] Revision checks inside image/document transactions prevent stale writes/purges. Metadata-only BroadcastChannel notices and focus/visibility fallback report conflicts without overwriting local edits. Stop stale-tab autosaves, preserve session editing/export, and require confirmed reload; no automatic merge. Unchanged tab opening does not create a revision; failed commits do not notify or advance it.
- [ ] Incrementally separate editor/library/domain/rendering/storage ownership. Use build-managed font imports where suitable; retain stable public URLs where needed. Do not create empty architectural scaffolding.
- [x] Error-only Sonner notifications at the top right, separated/dismissible on desktop/mobile, with deduplicated save failures. Reset/export successes stay silent; actionable inline failure/conflict status remains visible.
- [x] Explicit Vite vendor chunks eliminate the oversized-bundle warning without raising its threshold; application TypeScript remains strictly checked during production builds. Upstream dependency annotation warnings are not hidden.
- [ ] ESLint, Vitest, Testing Library, broader component variants, and remaining primitive checks below. Prettier is used for touched files; Floating UI/TanStack Virtual only when needed.

Exit criteria: one usable grid with no board manager, initialized from the new schema; guest autosave/reset works across reloads without accidental media deletion; failed saves are reported. Retain single-grid/default/reset and image-placement/export coverage without bundled demo loading.

### 2. Image Providers And Online Search

This is the next implementation focus. Depends on the existing guest storage, crop, import and export paths, not account sign-in. Aim for coverage of every content domain below through individually validated providers; evaluate alternatives rather than claiming every candidate will ship.

- [x] Initial Wikimedia Commons public-domain/CC0 raster integration: typed adapter/registry, explicit paginated Online search, source/creator/rights details, canceled stale requests, quota/error isolation, bounded original download, intentional library/cell import and local provenance persistence. Production-origin CORS/export smoke and mocked desktop/mobile import/crop/export/reload checks pass; [dated scope and remaining gates](providers.md). Broader contracts below remain partial.
- [x] The Met keyless CC0 collection: current paginated search, bounded sequential object details, provider-specific topics in the shared control row, strict public-domain/host checks, shared import/drag/picker/crop/export and local provenance. Real production-origin JPEG/PNG/WebP checks and mocked desktop/mobile/error workflows pass. Chicago and Cleveland image delivery failed sampled CORS checks and remain deferred; see [provider compatibility](providers.md).
- [x] Additional keyless sources: SMK public-domain JPEGs, iNaturalist photo-level CC0 and Openverse Flickr/Wikimedia public-domain/CC0 images. Attribution-required images and unsafe hosts remain excluded; legacy credited images are removed safely without losing other content or settings. See [provider scope](providers.md).
- [x] Rijksmuseum and Wellcome Collection keyless public-domain/CC0 image search, per-image rights/access checks, bounded IIIF JPEG renditions and reference-only imports. Metadata licensing is not inferred to apply to photographs. See [provider scope](providers.md).
- [x] Commons/Met shared TanStack Query metadata cache: one-hour freshness, two-hour inactive retention, a 500-entry inactive-first limit, provider/query/page keys, separate Met object details, deduplicated requests and independent cancellation. Sidebar/picker and visited pages reuse metadata; failures and deadline-truncated pages are not treated as fresh. Cache stays in memory, separate from saved images/settings; focused lifecycle and editor expiry/reuse checks pass. Future providers still require their own policy review.
- [x] Combine typed search and topic scope without clearing either choice; All removes only the topic constraint. Preserve both across pagination, provider switches, reloads and URLs, with topic-aware cache keys. Commons uses bounded filename/category metadata matching; Met uses medium filters and portrait tags. Focused desktop/mobile, rejection, restoration and cache checks pass; topic metadata coverage is approximate, not exhaustive.
- [ ] Create a typed provider registry with domain, icon, capabilities, filters, configuration, availability and source-policy metadata. Define search/details/variants/permitted preview-export resolution and provider-required selection/download hooks. Keep provider-specific API handling out of editor components.
- [ ] Build Online library search with explicit provider/domain selection, suitable domain filters, paginated results, image variants and source/credit details. Retain Imported as the local library. Enable Online only when at least one real integration is usable; do not add placeholder provider buttons implying support.
- [ ] Normalize stable entity/image IDs, titles/alternatives, type/year, source page, thumbnails/variants/dimensions, creator/license/rights/attribution. Keep entities separate from image variants and preserve provenance; use authoritative cross-provider IDs for deduplication, not similar names.
- [ ] Connect result selection to the existing local import/placement/crop/export flow. Support importing into the library and intentionally placing into a chosen cell without accidental replacement. Fetch/decode images on the client; persist originals only where permitted, retaining any required remote representation and credits. Account settings must not receive media or image references.
- [ ] First wave: keyless anime/manga/character providers (spike AniList and Jikan), general open media (Wikimedia Commons), books (Open Library), trading-card/game imagery (Scryfall and PokéAPI), museum/art collections (The Met), space imagery (NASA), and music/cover art (MusicBrainz + Cover Art Archive where browser access and policy permit).
- [ ] Second wave: film/TV/people (TMDB), games (IGDB and RAWG), photography/illustration (Unsplash, Pexels and Pixabay), and cultural collections (Europeana). Each credentialed or browser-incompatible provider requires approved configuration/hosting/terms before implementation; use the same registry, UI and import contract rather than a separate feature per domain.
- [ ] Debounce queries, cancel/ignore stale responses, paginate, throttle, respect Retry-After and cache within provider policy. Start with one provider per search; combined search later uses explicitly enabled providers and bounded concurrency, never every provider per keystroke.
- [ ] Distinguish loading, empty, offline, unavailable, quota, unsupported-domain, missing-configuration and provider-auth states. Queries disclose search text/network identity to the chosen provider; local uploads remain local. A failed provider must not erase the current grid or disable other providers, imports or exports.
- [ ] Validate each candidate's current terms and actual deployment-origin search/image-CDN behavior before advertising it: search/details/pagination, anonymous image loading, untainted PNG/JPEG/WebP export, variants/resolution, attribution/transform/storage rules, 429/timeouts/bad responses/missing images, and permitted cache/offline use. Keep dated compatibility reports; substitute or omit candidates that fail.
- [ ] Add mocked provider contract/search/import/error tests and focused desktop/mobile search-to-placement-to-crop-to-export/reload checks. Verify stale responses, provenance/credits, safe local media retention and failure isolation. Use tiny real-service smoke checks at integration milestones, not bulk catalog traffic in CI.

Exit criteria: the Online library is usable across the planned content domains with clear provider capabilities and failure states; every advertised integration passes policy/real-origin/export checks. Keyless providers work without Gridz accounts or user API keys. Credentialed providers ship only with approved secure configuration; unavailable candidates are documented, not disguised as supported. No server-side image upload/storage/cache or arbitrary image proxy. API access is not permission to reuse images.

### 3. Provider Sign-In, Saved Grids And Presets

Depends on the shared single-grid/settings contracts. This supports reference-only saved grids, not image hosting. The November 3 account requirements supersede the earlier settings-only account plan.

- [x] Inspect Chatter and create one npm monorepo with separate web/API/database/shared-contract packages, Docker Postgres 16, persistent volume and transactional versioned migrations.
- [x] Implement Google, Facebook and Discord authorization-code flows; no password accounts. Keep secrets server-side, minimize scopes, bind single-use expiring state to the browser, and use PKCE where supported. Identify accounts by provider+subject; do not email-auto-link or retain provider tokens.
- [x] Explicit, session-bound provider linking and confirmed existing-account merges, preserving every cloud save and published/private preset. Keep one identity per provider, revoke incoming-account sessions after merging, and allow disconnect only while another configured sign-in provider remains.
- [x] Use opaque hashed sessions, HttpOnly/SameSite cookies, production Secure cookies, exact Origin/custom-header CSRF checks, validation, ownership, size/rate limits and logout/account deletion.
- [x] Explicitly save/load/replace/delete named grids with provider references, captions/crops and browser-local opaque IDs. Restore local images only when present in that browser; never upload local media or persist provider image bytes.
- [x] Save/apply/delete private or explicitly published presets containing layout/style/export settings only. Guests can browse/apply published presets; only owners can update visibility or delete.
- [x] Confirm destructive operations and preset application; protect replacements against stale versions. Login/logout leave the single browser draft and uploads intact, with a shared-device warning rather than promising per-account browser isolation.
- [x] Test contract boundaries, mocked code exchanges for all providers, real-Postgres migrations/state/session/ownership/public-private/stale-write/deletion behavior, and desktop/mobile account UI plus reference-image export/reload.
- [ ] Register real provider applications/callbacks, perform real consent and provider-review checks, and deploy a same-origin or same-site HTTPS web/API stack with private Postgres and backups. Plain GitHub Pages with an unrelated API domain cannot use the chosen SameSite=Lax sessions.

Exit criteria: provider-only sign-in and owned grid/preset persistence work; another device reloads provider references but never local uploads; guest editing/reset stays independent. Automated verification does not certify external consent screens or a live deployment.

### 4. Layout, Rendering, And Export Reliability

Depends on stable IDs/schema and client storage from step 1; rendering itself does not require sign-in.

- [x] Top appearance toolbar with portrait 3:4, landscape 4:3 and square 1:1 tiles; editable captions above/below/on-image, top/bottom overlay alignment, color and opacity. Shared tile/caption rectangles drive DOM preview and actual exports; preserve content, persist direct style settings and reset to portrait/bottom-overlay.
- [x] One percentage Gap shared by heading-to-grid and inter-card spacing, plus independent percentage Canvas padding and exportable background. Uniform outer padding surrounds heading and cards; native scrollbar gutter is outside the painted image. Preview and exported dimensions/colors agree; remove independent heading-gap/grid-padding configuration and the separate Grid style section.
- [x] Fit cards between 128 and 200 CSS pixels with balanced 44px arrow-only tracks attached 8px from the grid. Keep the heading fixed above internal two-axis canvas scrolling, including short/narrow screens; canvas background/padding never recolor or scroll the dotted workspace. Card content/icons/actions scale proportionally. Resize updates fitted geometry before the next paint, without Undo or a removed-cell tray.
- [ ] Extend the shared numeric composition path to heading/footer blocks, exact line breaks, crops, clips and transforms.
- [ ] Independent grid layout, image-cell ratio, and final export dimensions. Changing one never silently changes the others or stretches the composition to force an outer ratio.
- [ ] Uniform board ratios: 1:1, 2:3, 3:4, 4:5, 3:2, 4:3, 16:9, 9:16, validated custom ratios. Preserve originals/focal points; mixed/spanning tiles come later.
- [ ] Extend border width/color, corner treatment and heading/caption sizing while retaining one Gap and Canvas padding; do not reintroduce separate Grid style or competing gap controls.
- [ ] Subtitle/footer/rank/row-label/column-label/per-cell-text switches with retained settings; row-first/column-first numbering and optional exported numbering.
- [ ] Image/font/source-policy preflight identifying exact missing/nonexportable cells; retry/replacement or deliberate placeholder export, never silent omission.
- [ ] PNG/WebP transparency, explicit JPEG flattening, final dimensions/scale/social sizes, filename/credit controls, upscaling warnings and file-size estimates where practical.
- [ ] Bounded source decoding/concurrency and representative-device benchmarks. Canvas memory starts near four bytes/pixel before source images/intermediates/thumbnails/encoding. Add progress/cancel and resolution recovery for the current grid.

Exit criteria: preview/export agrees across ratios/visibility; layout preserves placements; errors name offending cells; measured budgets support realistic phone exports, not unlimited resolution.

### 5. Appearance, Fonts, And Text

Depends on shared composition/text from step 4. Account persistence stores style/font choices only; uploaded font files stay local.

- [x] Direct Canvas/Heading/Card style sections with independent heading/card fonts, sizes, text/background colors and always-available card overlay color/opacity. Remove Theme/Sub-theme controls, preset matching, template commands and remembered profiles from schemas/storage; style edits preserve local media/content and reset through the shared settings boundary.
- [ ] Independent editor Light/Dark/High Contrast/System preferences. Tokenize surfaces/text/borders/focus/selection/disabled/accent states; editor appearance cannot recolor exports. No board Theme/preset selector.
- [ ] Define direct board-style -> per-cell override precedence when cell overrides are implemented; preserve titles/crops/overrides unless explicitly reset, without saved theme profiles.
- [ ] Custom background images with fit/position/opacity under the same media safety/rights rules as cells.
- [ ] Licensed sans/serif/condensed/display/monospaced fonts; local WOFF2/WOFF/TTF/OTF uploads where FontFace decodes them; persisted blobs/metadata and unique internal family IDs.
- [x] Alphabetical built-in font menus: Bangers, Bebas Neue, Boogaloo, Manrope. Options and triggers preview the face and selected weight at 20px with reduced vertical padding only for font-family menus; preserve horizontal padding and 44px targets. Heading/card weight sliders show numeric values and accessible weight names: Manrope 100..900 by 100; display fonts Regular 400/Bold 700 by 300, with browser-synthesized bold. Persist/reset weights (default 400), normalize font changes, and measure/wrap/draw using the same selected weight.
- [x] Shared caption wrapping and row-height measurement preserve case and multiline/long-word content in preview/export, including independent library/canvas title editing. Heading text auto-fits; editable fields align with visible cell edges and have contained hover/focus feedback.
- [ ] Extend required-face readiness, selector styles/error states and missing-font fallback decisions to uploaded/additional fonts; bundled face loading and selected weights already drive preview/export measurement.
- [ ] Add subtitle/label fonts and per-cell overrides, italic/style, line-height, alignment, letter spacing, case controls, outline and shadow. Preserve existing independent heading/card weight, size and color controls.
- [ ] Extend above/below/top/bottom overlay captions with a hidden mode and verified accented/CJK/RTL behavior with honest glyph/fallback limits. Middle remains supported for historical geometry, not offered by the current controls. Accessible labels stay separate from decorative text.
- [ ] Font notices and permission-aware embedding/sharing. Google Fonts browsing is optional later; review licenses/subset sizes and prefer approved self-hosting.

Exit criteria: custom fonts survive reload/export and later project round-trip; editor/output styling stays independent; direct style precedence is predictable and accessible, without reintroducing Theme profiles.

### 6. Image Editing, Library, And Responsive Controls

Depends on stored originals and shared image transforms.

- [x] Always-full tiles and fullscreen react-easy-crop editing with validated normalized per-cell crops, mouse/touch/keyboard pan, zoom slider, guides and centered reset. Apply saves only crop metadata; Cancel leaves the saved crop unchanged. Reopen/reload retain independent crops of reused media; original blob bytes remain unchanged. Shared source rectangles match preview/export and adapt crops to the current tile ratio. Restore edited-cell focus after dialog exit, with no touch text autofocus.
- [ ] Zoom stepper, rotation, horizontal/vertical flip, custom ratio lock and advanced focal-point/transforms.
- [ ] Explicit Keep Composition/Reset Crop choices on ratio changes.
- [ ] Copy/reset/apply-to-selection transforms subject to source permissions; explain disabled crop/rotation/filter/overlay actions.
- [ ] Clipboard images where supported, verified mobile photo selection, cancellable ordered batch imports with progress/per-file failures retaining successful imports.
- [ ] Real decode/type/file-size/pixel validation. Initial proposals: 20 MB/file and 40 MP, subject to benchmarks. JPEG/PNG/WebP first; AVIF decode-dependent, animation first-frame, HEIC conversion separately evaluated. Reject SVG or use vetted sanitization/rasterization; never inject uploaded markup or execute external resources.
- [ ] Hash-based deduplication; library search/rename/tags/collections/favorites/recent/used-unused views and source metadata.
- [ ] Referenced-media Replace/Clear choices and media-retention policy. Preserve direct per-image and clear-all library deletion without confirmations.
- [ ] HTTPS image URL imports, not arbitrary webpage scraping; explain URL/CORS/provider failures and retain upload fallback.
- [x] Header-free desktop canvas between library/settings asides with fixed aside headers and independently scrolling bodies. Export belongs to the settings header on desktop and the canvas toolbar on mobile; ratio/caption dropdowns stay above the grid. Balanced control tracks and observed toolbar wrapping preserve fitted geometry.
- [x] Unified library/canvas cards with shared caption/image geometry, contained hover outlines and original-preserving crops. Native move/swap retains captions/crops, and caption editing stays focused when hover tools close. Imports normalize filenames and report failures without success notices.
- [ ] Add account/settings access and contextual inspectors only as their features land. Keep the canvas-first layout and direct style sections; library views may extend to Search/Collections, with domain filters in provider search, not the Imported source strip.
- [x] Mobile library access with Imported/Online source selection, shared image picker and Clear all images preserving canvas placements. Online now supports the initial Commons integration; no category filters. Retain touch placement, settings access, no input autofocus, safe-area spacing and desktop restoration.
- [x] Full-width square-corner mobile drawer with measured collapsed height, native-gutter compensation and preserved content/focus through desktop/mobile transitions. Internal canvas scrolling handles minimum-size overflow without whole-workspace scrolling; expanded tools remain independently scrollable.
- [ ] Extend the mobile board-first experience with contextual library/inspector sheets, no input autofocus. Headless UI Listbox/Combobox/TabGroup/sheets where applicable; shared Motion/reduced motion; feature-scoped Tailwind migration.
- [ ] Full keyboard/touch move/swap/selection alternatives to dragging. Named Lucide tools, swatches, segmented modes, switches/numeric controls, accessible progress/focus/contrast, 44px touch targets. If localized, single plural-aware count messages using Chatter's i18next/ICU approach.

Exit criteria: independent crops survive reload and match exported pixels; originals remain unchanged; batch failures recover; keyboard/touch editing and mobile sheets work.

### 7. Templates, Batch Tools, And Portable Projects

Depends on commands, direct style settings, renderer, media/font permissions. These are content/layout templates, not a return of the removed Theme selector.

- [ ] Blank/top 9/top 10/favorites/watchlist/before-after/month/alignment/16-slot personality templates. Domain-neutral definitions include labels/layout/ratio/text/direct styles, optional anime/game/book/film/photo suggestions, no provider dependency.
- [ ] Preview with Keep Content/Replace Layout choices for the current grid. Personal layouts/styles exclude private images by default. Right/bottom edge controls stay usable after every template: no layout lock-in or board duplication.
- [ ] Multi-selection, duplicate/clear/lock cells, shuffle/sort/fill-empty and keyboard/touch alternatives within one grid.
- [ ] Optional memory-preflighted client-side ZIP bundles of the current grid/output/attribution using fflate, not multi-board batch export.
- [ ] Versioned single-grid `.grids` archives with permitted media/fonts/thumbnails/attribution, generated/imported entirely client-side and never uploaded by account-settings sync. Restricted binaries remain explicit references/portability limits; settings/layout-template JSON excludes private media/credentials.
- [ ] Validate schema/archive paths/file counts/compressed and uncompressed sizes/pixel dimensions before workspace changes; protect against zip bombs and unsafe overwrites.
- [ ] Image clipboard export/native share where supported, attribution sheets. Required source credits are never an optional toggle.

Exit criteria: upload-only projects with custom fonts/independent crops round-trip offline in a clean browser; archives respect rights/limits; templates never trap layout or discard content accidentally.

### 8. Optional Provider Gateway And Hardening

Requires explicit hosting/credential/terms/cost approval and step 2 provider gates. Bring the minimum necessary gateway work forward during the credentialed-provider wave; do not make guest/keyless search wait for a backend. This is separate from the account-settings API.

- [ ] Separate Cloudflare Worker or equivalent metadata gateway only for protected credentials/incompatible browser access. Missing configuration/outages disable only affected catalogs. Fetch/decode catalog images on the client from permitted source CDNs; do not add server-side image upload/storage/cache or promise support for sources requiring an image proxy.
- [ ] Fixed provider routes/validated IDs, approved HTTPS hosts/paths, per-hop redirect validation, private/reserved target blocking, file/type/dimension/time limits, quotas/bounded caches/kill switches, independent abuse controls. No fetch-any-URL or public unaudited CORS proxy.
- [ ] Server-side secrets/rotation; none in `VITE_*`, static assets, projects, unnecessary logs. Restrict origins without treating CORS as authentication/quota protection. Never automatically send private images to remote conversion/cropping services.
- [ ] Extend operational coverage for the credentialed providers from step 2: health/configuration checks, quota/cost monitoring and per-provider disable switches. Add further catalogs individually through the same compatibility reports.

Exit criteria: frontend remains Pages-deployable; outages degrade relevant search only; policy/credentials/costs/abuse controls are verified.

### 9. Later Features And Local Accounts

Depends on demand; cloud scope needs separate approval.

- [ ] True tier rows with labels/variable lengths/unranked tray, hero/spanning tiles, mixed/irregular collages without corrupting regular grids.
- [ ] Brightness/contrast/saturation/grayscale and optional local background removal, subject to source rules/performance.
- [ ] Capability-tested worker/OffscreenCanvas rendering with main-thread fallback; optional installable offline shell.
- [ ] Local username/password accounts only after Google/Discord/Facebook and account settings are reliable. Reuse reviewed Chatter patterns for secure password storage, verification/recovery, rate limits, and account linking; this must not delay provider login.
- [ ] Separately scope settings-only sharing/collaboration, retaining the no-image-upload/storage boundary. Define privacy/authentication/moderation/retention/operating costs. No image cloud sync or arbitrary public plugin execution in the first release.

## Implementation Contracts

### Frontend And Chatter Reuse

Use React/Vite, strict TypeScript, Headless UI v2, Tailwind v4, Motion (`motion/react`), class-variance-authority/clsx, Lucide, TypeScript/Playwright. Adapt supported compatible versions and owned UI behavior from `C:/Users/draxx/Sources/Chatter/apps/web`; inspect its provider-auth/session/account-linking implementation when step 3 begins. Do not copy the whole manifest/stylesheet/glass palette/chat offsets/TipTap/sockets/Redis/CMS/chat backend. Reuse relevant security patterns without making the editor depend on Chatter's chat stack. Keep adaptation/license notes. Custom CSS needs a concrete rendering/typography reason.

Chatter reference paths (not Gridz files):

- `apps/web/src/components/Modal.tsx`, `apps/web/src/scrollbarWidth.ts`, `apps/web/src/index.css`: lifecycle, gutter measurement/compensation, `--scrollbar-width`/`--fixed-scrollbar-inset`.
- `apps/web/src/components/ViewTransition.tsx`: LazyMotion/domAnimation, MotionConfig reduced motion, AnimatePresence, inert/aria-hidden exit views. Adapt legacy modal CSS/Web Animations to Motion without conflicting owners.
- `apps/web/src/components/FocusSearch.tsx`, `apps/web/src/components/ReturnFocus.tsx`: desktop intentional focus/touch detection, preventScroll trigger restoration, no focus stealing after pointer use.
- `apps/web/src/components/dropdown.ts`, `apps/web/src/components/SideDrawer.tsx`, shared Button/dependencies: constrained surfaces/sheets/backdrop/header/editor variants without chat branding/translation keys.

### Remaining Modal And Primitive Checks

Preserve: stable gutter; measured width before opening, not zeroed during modal; background lock/gutter-auto/equal padding; full-viewport frame as single vertical scroll owner; mounted lock through exit; final gutter/position/focus restoration; helper/HMR cleanup. Headless UI owns semantics/focus, Motion owns presentation; switch values change immediately and exit content is inert/hidden from assistive technology.

- [ ] Short/long/scrolled pages, background wheel/touch blocking, classic/overlay scrollbars, viewport changes while open, no double compensation/lingering lock or padding.
- [ ] Nested-dialog locking/topmost focus until final removal; Escape/backdrop/close/programmatic dismissal and rapid open/close/reopen preserve focus/scroll through animation and unmount.
- [ ] Every primitive/sheet/view transition with reduced motion and Light/Dark/High Contrast, titles/announcements, no hidden duplicate focus targets.
- [ ] Virtual-keyboard/narrow viewport controls, frame-owned bottom spacing for long/empty contents. Crop gestures cannot introduce nested page scrollers; mobile popup opening/closing cannot autofocus text.
- [ ] Supported-browser/`:has` policy and fallback only if needed; fixed controls use the inset. Verify real-browser geometry against body bounds, not DOM-only tests/innerWidth assumptions.

### Module Ownership

Extract when needed: shared `components/ui`/`browser`; `features/editor`, `features/library`, `features/crop`; versioned `model`/commands, `storage`, shared `rendering`, `providers`, `fonts`, layout `templates`, `demo`, build-managed `assets/fonts`. Public files hold stable permitted demo URLs/licenses/app-owned icons; test-only images/fonts belong in `tests/fixtures`, not public builds. The next provider registry starts with the existing Online library boundary; do not create empty modules for later domains.

## Catalog Candidates

These candidates define the domain coverage for the next image-provider focus. The limited Commons and Met integrations described above are implemented; the other candidates are not certified. Direct means worth a browser spike, not verified support. Recheck current terms, query/image-CDN CORS, export/transform/cache rights, resolution/rate limits and deployed-origin behavior. The two rollout waves in step 2 do not override individual provider requirements; move a candidate to the credentialed/gateway wave or omit it if the checks require that. Do not show disabled buttons implying support.

| Provider                        | Content / access candidate                                                | Main check                                                                                                     |
| ------------------------------- | ------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| AniList                         | Anime/manga/characters; direct public queries, OAuth later personal lists | API terms/limits, image export/CORS                                                                            |
| Jikan                           | Unofficial MAL anime/manga/characters; keyless direct                     | Documented 3 requests/sec, 60/min; upstream outages, separate image rights                                     |
| Wikimedia Commons               | Broad open-license/public-domain media; keyless direct                    | API origin=\*; per-file creator/license, actual image CDN                                                      |
| Open Library                    | Books/author photos; keyless direct                                       | Cover hotlink guidance, no bulk crawling, export/CORS                                                          |
| Scryfall                        | Magic cards/art crops; keyless direct                                     | Full cards retain artist/copyright marks, no distortion/filtering; approved crops retain artist/source context |
| PokéAPI                         | Pokemon metadata/sprites; keyless direct                                  | Artwork rights, source hosts, resolution/export quality                                                        |
| The Met Collection              | Museum imagery; keyless direct                                            | Only valid open-access/downloadable imagery with rights metadata                                               |
| NASA Image and Video Library    | Space imagery; keyless direct                                             | Asset restrictions/credits, endpoints/resolution                                                               |
| MusicBrainz + Cover Art Archive | Music metadata/cover art; direct or gateway                               | Two-service lookup, identification/header/limit requirements, cover rights/CDN exportability                   |
| TMDB                            | Film/TV posters/backdrops/people; managed credentials recommended         | Auth, required branding/attribution, image coverage/export rights                                              |
| IGDB                            | Game covers/art/screenshots/characters; gateway required                  | Official browser restriction, Twitch secret/token lifecycle, terms                                             |
| RAWG                            | Games/screenshots; credential gateway candidate                           | Current access/license/quota/attribution/export rules                                                          |
| Unsplash                        | Photography; approved app, gateway recommended                            | Mandatory hotlinking/photographer and Unsplash attribution/download tracking/cache-export policy               |
| Pexels                          | Photography; credential gateway candidate                                 | API rules/attribution/quota/storage-export policy                                                              |
| Pixabay                         | Photography/illustrations; credential gateway candidate                   | API/cache/hotlink rules/rights/quotas                                                                          |
| Europeana                       | Cultural collections; credential gateway candidate                        | Per-object rights/provider links/variable image availability                                                   |

`crossOrigin` before `src` requests permission, not CORS authorization. Visible previews may fail anonymous loading or taint canvas. Metadata licensing does not license artwork, and proxies cannot fix prohibited reuse.

## Verification And Release

Keep production-subpath checks. Use the smallest behavior-scoped development check; relevant integrated checks for shared rendering/storage changes and milestones. Build success does not certify fidelity, data integrity, or permissions.

- [ ] Extend focused model checks for composition/ratios/text/transforms, commands/IDs, clean storage initialization, future direct-style override precedence and validated boundaries. Existing typography/spacing/reset/media-boundary checks remain in place.
- [ ] Owned/licensed known-pixel square/portrait/landscape fixtures, pan/zoom/rotation/flip/transparency, long/Unicode/RTL text, custom fonts, preview/export agreement.
- [ ] Next, add image-provider search/import/provenance/export/failure flows on desktop/mobile. Extend other browser flows for guest autosave/reset, provider login/settings restoration/media exclusion/account isolation, crop Apply/Cancel, uploaded-font reload, layout templates, client-side archives, workers, and gateway routes as features land. Keep the existing direct typography, fitted-canvas, internal-scroll and local-media checks; migrate obsolete removed-UI workflows rather than reintroducing their controls.
- [ ] Failure tests for storage quota/corrupt files/fonts/missing media, provider 429/timeouts/stale searches/CORS, archive limits.
- [ ] Keyboard/touch alternatives, desktop/mobile overflow/screenshots, accessible crop/progress/focus, reduced motion/high contrast across supported browsers.
- [ ] Mock provider CI traffic; tiny dated real-service smoke tests at integration/release checkpoints, never bulk crawls.

Public release requires reliable single-grid initialization, guest autosave/reset, crop/export fidelity, reviewed assets and policy/real-origin gates for advertised catalogs. Account features require secure provider sessions, ownership and verified exclusion of image binaries from server requests/storage. Sign-in remains optional; public settings presets are supported, password accounts are excluded, and image cloud storage/sync is out of scope.

## Reference And Sources

The unsigned live interface at https://www.anime.com/grid/new showed fixed sizes, square/portrait switching, naming/custom text/shuffle/download, show/character search, shows/movies/characters/top 10/anime taste/alignment/month/MBTI templates, community/Post controls. Gridz instead uses flexible edges. Exact portrait ratio/provider/authenticated posting/output were not verified. Reuse workflow ideas, not artwork/branding/source/proprietary templates.

- AniList: https://docs.anilist.co/
- Jikan: https://docs.api.jikan.moe/
- MediaWiki CORS: https://www.mediawiki.org/wiki/API:Cross-site_requests
- Open Library covers: https://openlibrary.org/dev/docs/api/covers
- TMDB auth: https://developer.themoviedb.org/docs/authentication-application
- IGDB: https://api-docs.igdb.com/
- Unsplash: https://unsplash.com/documentation
- Scryfall: https://scryfall.com/docs/api

Planning research is not integration certification. Other candidates were not independently checked in this pass; recheck current terms/deployed-origin requests before implementation.
