# Grids Roadmap

Updated October 31, 2026. `[x]` = implemented and checked. `[ ]` = remaining work, including partial features. Only work items have checkboxes.

Build a general-purpose, local-first image-board editor for anime, characters, films, games, books, cards, photographs, and personal collections. The core stays usable without an account, API key, paid service, or backend, and independently deployable to GitHub Pages. Cloud features need separate approval.

## Completed

- [x] React/Vite with strict TypeScript/TSX application sources, `.mjs` Node tooling, and production-subpath build/browser checks. Generated JavaScript bundles are exempt from the source-language rule.
- [x] Headless UI Dialog/Menu/Disclosure/Switch primitives; Motion animations and reduced motion; Tailwind v4 for new controls; component variants and Lucide icons. Removed the unused global Lucide bundle.
- [x] Viewport-edge modal scrolling, background lock through exit, scrollbar compensation, trigger-focus restoration, and helper cleanup. Touch dialogs focus a non-input control instead of opening the keyboard.
- [x] Neutral first launch: one empty 3x3 board, empty library, square cells, Manrope fonts. No automatic example image/module requests or comic branding inferred for new boards.
- [x] Explicit lazy Load example and legacy comic manifest. Appends boards without replacing uploads/edits; repeat loads reuse images; saved image paths stay stable. Artwork rights and original credits remain unresolved.
- [x] Multiple boards, naming/rename dialog, uploads, library placement, drag-to-swap, cell titles, fit/fill, background/gap controls, and legacy DC/Marvel palettes. Bundled fonts: Manrope, Bangers, Boogaloo, Bebas Neue.
- [x] Right-edge column and bottom-edge row controls: 1..12 in each direction, 144 visible cells, 44px named controls with tooltips/disabled limits, no grid-size presets, no controls in exports.
- [x] Stable cell IDs preserve coordinates, selection, keys, placement, clearing, and swaps. Removed cells persist by coordinate; expansion restores them; recovery swaps retain displaced content. Resize Undo preserves newer edits.
- [x] Visible board deletion with session Undo, original-position/selection restoration, adjacent-board selection, and preservation of surviving edits. Empty workspaces persist and still allow uploads/Add Board.
- [x] Heading visibility retains text/fonts/styles while removing hidden space from preview/export. Workspace names stay separate from visible headings.
- [x] Async uploads follow destination board/cell IDs. Resized-away/deleted targets do not receive misplaced images; imported media remains in the library.
- [x] Browser-local persistence and legacy normalization. Selection/dialogs/progress/session Undo stay separate from saved documents; uploads stay on-device.
- [x] PNG/JPEG/WebP downloads with real decoded-image/MIME checks. Initial canvas caps: 16 MP narrow/touch, 32 MP otherwise; 150/300 px options provide large-grid recovery.
- [x] Production-subpath regressions for upload/dragging, headings/fonts, animated controls/modal/touch focus, deletion/empty state, resize/overflow/selection, delayed uploads, export limits, neutral defaults, and examples; desktop/mobile screenshot checks.

Current limits: media is stored as data URLs in localStorage; Undo is session-only and limited to deletion/resizing. Versioned storage, general undo/redo, ratios, themes, custom font uploads, cropping, search, and project backups are unfinished. Canvas caps do not guarantee device memory safety. Pages build/workflow compatibility is checked, not a live deployment certification. The legacy `gridroom-v1` key and internal drag identifiers remain unchanged to preserve compatibility after the Grids rename.

## Development Order

**Next: finish the document/storage foundation, then shared layout/rendering.** Work through the steps below in order; completed pieces are listed above, not repeated in each phase. Resolve schema/demo-rights decisions early. Run crop, FontFace, provider, and phone-export spikes before their dependent features. Failed provider research must not block the upload-only editor. No fixed delivery dates are assumed before those spikes.

### 1. Document And Storage Foundation

- [ ] Version the schema; replace active-board indexes with IDs; add Zod boundary validation. Model workspace order/preferences, boards/layout/style/export settings, cells/captions/alt text/crops/locks, media/blob/hash/provenance/rights, fonts/permissions, themes, and templates.
- [ ] Central typed document commands/reducer; keep crop drafts and provider requests/results outside saved state. Reuse React unless a state library solves a demonstrated subscription need.
- [ ] Dexie/IndexedDB for boards/media/fonts/thumbnails; managed/revoked object URLs; localStorage only for small preferences and migration markers.
- [ ] Transactional, idempotent `gridroom-v1` migration: validate, extract image blobs, translate fonts/styles/paths, verify references, then mark success. Retain the source until success; offer backup/retry on quota/decode failure and repair missing references rather than resetting the workspace.
- [ ] Debounced transactional Saving/Saved/Save Failed status, storage usage, backup reminders, best-effort persistent-storage requests, unused-media cleanup, and recoverable trash. Browser storage is not permanent backup or synchronization.
- [ ] Revision checks and BroadcastChannel notifications against silent multi-tab overwrites.
- [ ] General undo/redo for text/layout/crops/templates/deletion/batches. Coalesce typing/slider gestures; one Apply/bulk action is one entry. Store small patches/media IDs, not repeated binaries; retain media referenced by history/trash.
- [ ] Review comic rights/credits; replace unclear examples with owned/licensed content. Keep discoverable asset-specific licenses; remove unused logos after reference checks; move test-only samples out of public builds. Migrate moved image paths without changing IDs/titles.
- [ ] Incrementally separate editor/library/domain/rendering/storage ownership. Use build-managed font imports where suitable; retain stable public URLs where needed. Do not create empty architectural scaffolding.
- [ ] ESLint, Prettier, Vitest, Testing Library, broader component variants, and remaining primitive checks below. Add Sonner with the notification layer while retaining inline actionable errors; Floating UI/TanStack Virtual only when needed.

Exit criteria: legacy edits/references and intentional empty workspaces survive; failed writes retain recoverable data; history stays bounded; existing upload/export tests remain green; distributed examples have reviewed rights.

### 2. Layout, Rendering, And Export Reliability

Depends on stable IDs/schema and storage from step 1.

- [ ] One numeric composition path for accessible DOM preview and canvas export: cell rectangles, heading/caption/footer blocks, line breaks, styles, crops, clips, and transforms.
- [ ] Independent grid layout, image-cell ratio, and final export dimensions. Changing one never silently changes the others or stretches the composition to force an outer ratio.
- [ ] Uniform board ratios: 1:1, 2:3, 3:4, 4:5, 3:2, 4:3, 16:9, 9:16, validated custom ratios. Preserve originals/focal points; mixed/spanning tiles come later.
- [ ] Independent horizontal/vertical gaps, outer padding, border width/color, corner treatment, heading/caption sizing.
- [ ] Subtitle/footer/rank/row-label/column-label/per-cell-text switches with retained settings and undo/redo; row-first/column-first numbering and optional exported numbering.
- [ ] Image/font/source-policy preflight identifying exact missing/nonexportable cells; retry/replacement or deliberate placeholder export, never silent omission.
- [ ] PNG/WebP transparency, explicit JPEG flattening, final dimensions/scale/social sizes, filename/credit controls, upscaling warnings and file-size estimates where practical.
- [ ] Bounded source decoding/concurrency and representative-device benchmarks. Canvas memory starts near four bytes/pixel before source images/intermediates/thumbnails/encoding. Add progress/cancel and resolution recovery; process boards sequentially.

Exit criteria: preview/export agrees across ratios/visibility; layout preserves placements; errors name offending cells; measured budgets support realistic phone exports, not unlimited resolution.

### 3. Appearance, Fonts, And Text

Depends on shared composition/text from step 2.

- [ ] Independent editor Light/Dark/High Contrast/System preferences and board themes. Tokenize surfaces/text/borders/focus/selection/disabled/accent states; editor theme cannot recolor exports.
- [ ] Board presets: Minimal Light, Minimal Dark, Comic, Poster Wall, Photo Contact Sheet, Custom. Swatches/live previews, named custom themes, duplication, individual resets, theme JSON import/export.
- [ ] Precedence: preset defaults -> board overrides -> cell overrides. Snapshot resolved styles against preset changes; preserve titles/crops/overrides unless explicitly reset. DC/Marvel remain optional legacy styles.
- [ ] Custom background images with fit/position/opacity under the same media safety/rights rules as cells.
- [ ] Licensed sans/serif/condensed/display/monospaced fonts; local WOFF2/WOFF/TTF/OTF uploads where FontFace decodes them; persisted blobs/metadata and unique internal family IDs.
- [ ] FontFace loading, selector samples/weights/styles/error states, and required-face readiness before text measurement/preview/export. Identify missing-font fallback decisions.
- [ ] Heading/subtitle/caption/label fonts and per-cell overrides; weight/style, size/auto-fit, line-height, alignment, letter spacing, case, color, outline, shadow.
- [ ] Captions below/above/overlay-top/overlay-bottom/hidden; multiline/long words/accented/CJK/RTL text with honest glyph/fallback limits. Accessible labels stay separate from decorative text.
- [ ] Font notices and permission-aware embedding/sharing. Google Fonts browsing is optional later; review licenses/subset sizes and prefer approved self-hosting.

Exit criteria: custom fonts survive reload/export and later project round-trip; editor/output themes stay independent; style precedence is predictable and accessible.

### 4. Image Editing, Library, And Responsive Controls

Depends on stored originals, history, and shared image transforms.

- [ ] Maintained crop library such as react-easy-crop with validated normalized coordinates. Touch/keyboard pan, zoom slider/stepper, rotation, horizontal/vertical flip, center/reset, ratio lock, guides, live target preview.
- [ ] Apply is one undoable action; Cancel changes nothing. Per-cell normalized crops/focal points/transforms preserve originals and independent crops of reused media; deterministic clamping and Keep Composition/Reset Crop on ratio changes.
- [ ] Copy/reset/apply-to-selection transforms subject to source permissions; explain disabled crop/rotation/filter/overlay actions.
- [ ] Clipboard images where supported, verified mobile photo selection, cancellable ordered batch imports with progress/per-file failures retaining successful imports.
- [ ] Real decode/type/file-size/pixel validation. Initial proposals: 20 MB/file and 40 MP, subject to benchmarks. JPEG/PNG/WebP first; AVIF decode-dependent, animation first-frame, HEIC conversion separately evaluated. Reject SVG or use vetted sanitization/rasterization; never inject uploaded markup or execute external resources.
- [ ] Hash-based deduplication; library search/rename/tags/collections/favorites/recent/used-unused views and source metadata.
- [ ] Referenced-media Cancel/Replace/Clear choices, undo and recoverable trash. Irreversible cell/media deletion needs a separate deliberate confirmation/history policy.
- [ ] HTTPS image URL imports, not arbitrary webpage scraping; explain URL/CORS/provider failures and retain upload fallback.
- [ ] Desktop compact board/undo/ratio/template/appearance/export toolbar, central board, left library, contextual Layout/Appearance/Typography/Cell inspector. Library views: Uploads/Search/Collections/Examples; domain filters belong in Search.
- [ ] Mobile board-first experience with deliberately opened library/inspector sheets, no input autofocus. Headless UI Listbox/Combobox/TabGroup/sheets where applicable; shared Motion/reduced motion; feature-scoped Tailwind migration.
- [ ] Full keyboard/touch move/swap/selection alternatives to dragging. Named Lucide tools, swatches, segmented modes, switches/numeric controls, accessible progress/focus/contrast, 44px touch targets. If localized, single plural-aware count messages using Chatter's i18next/ICU approach.

Exit criteria: independent crops survive reload/undo and match exported pixels; originals remain unchanged; batch failures recover; keyboard/touch editing and mobile sheets work.

### 5. Initial Catalog Search

Depends on compatibility checks and media/rights/crop/export foundations. Target: three validated catalogs across at least two domains, alongside uploads/examples.

- [ ] Spike AniList/Jikan and actual image CDNs from the deployment origin; choose the more reliable anime provider. Add Wikimedia Commons and one export-compatible books/art/card catalog. Replace failed candidates rather than advertise support.
- [ ] Typed registry: provider/domain/icon/capabilities/filters/configuration/availability/policy. Operations: search/details/variants/permitted preview-export resource resolution and required selection/download hooks.
- [ ] Normalize entity/image IDs, titles/alternatives, type/year, source page, thumbnails/variants/dimensions, creator/license/rights/attribution. Separate entities/images, preserve provenance, deduplicate using authoritative cross-provider IDs rather than similar titles.
- [ ] One provider/domain per search initially. Debounce/cancel stale requests/paginate/throttle/respect Retry-After/cache within policy. Combined search later uses enabled providers and bounded concurrency, never every catalog per keystroke.
- [ ] Distinct loading/empty/offline/unavailable/quota/unsupported-domain/auth states; poster/portrait/backdrop/edition/language/resolution variants; selected-cell placement/queue/fill-empty-unlocked without accidental replacement.
- [ ] Confirm permitted export readiness before placement; retain required remote representations/credits. Explain query/network-identity disclosure to providers; uploads stay local.
- [ ] Dated real-origin compatibility reports: search/pagination, actual Pages-origin image loading, untainted canvas export, attribution/transform/storage rules, 429/timeout/bad-response/missing-image recovery, permitted offline/cache behavior.

Exit criteria: no protected credentials in static assets; every shipped provider clears policy/real-origin/export checks; failures cannot damage boards or disable the offline upload-only core. API access is not permission to reuse images; proxies do not override terms.

### 6. Templates, Batch Tools, And Portable Projects

Depends on commands/history, themes, renderer, media/font permissions.

- [ ] Blank/top 9/top 10/favorites/watchlist/before-after/month/alignment/16-slot personality templates. Domain-neutral definitions include labels/layout/ratio/text/theme, optional anime/game/book/film/photo suggestions, no provider dependency.
- [ ] Preview with Keep Content/Duplicate Board/Replace Layout choices. Personal layouts/styles exclude private images by default. Right/bottom edge controls stay usable after every template: no layout lock-in.
- [ ] Multi-selection, duplicate/clear/lock cells, shuffle/sort/fill-empty, board duplication/reordering, undo and keyboard/touch alternatives.
- [ ] Memory-preflighted sequential ZIP exports using fflate instead of repeated-download prompts.
- [ ] Versioned `.grids` project archives with permitted media/fonts/thumbnails/attribution. Restricted binaries remain explicit references/portability limits; theme/template JSON excludes private media/credentials.
- [ ] Validate schema/archive paths/file counts/compressed and uncompressed sizes/pixel dimensions before workspace changes; protect against zip bombs and unsafe overwrites.
- [ ] Image clipboard export/native share where supported, attribution sheets. Required source credits are never an optional toggle.

Exit criteria: upload-only projects with custom fonts/independent crops round-trip offline in a clean browser; archives respect rights/limits; templates never trap layout or discard content accidentally.

### 7. More Providers And Optional Gateway

Requires explicit hosting/credential/terms/cost approval and step 5 adapter gates.

- [ ] Separate Cloudflare Worker or equivalent gateway only for protected credentials/incompatible browser access. Missing configuration/outages disable only affected catalogs.
- [ ] Fixed provider routes/validated IDs, approved HTTPS hosts/paths, per-hop redirect validation, private/reserved target blocking, file/type/dimension/time limits, quotas/bounded caches/kill switches, independent abuse controls. No fetch-any-URL or public unaudited CORS proxy.
- [ ] Server-side secrets/rotation; none in `VITE_*`, static assets, projects, unnecessary logs. Restrict origins without treating CORS as authentication/quota protection. Never automatically send private images to remote conversion/cropping services.
- [ ] Add films/games/photography and further open catalogs individually through the same compatibility reports.

Exit criteria: frontend remains Pages-deployable; outages degrade relevant search only; policy/credentials/costs/abuse controls are verified.

### 8. Advanced Boards And Optional Cloud Features

Depends on demand; cloud scope needs separate approval.

- [ ] True tier rows with labels/variable lengths/unranked tray, hero/spanning tiles, mixed/irregular collages without corrupting regular grids.
- [ ] Brightness/contrast/saturation/grayscale and optional local background removal, subject to source rules/performance.
- [ ] Capability-tested worker/OffscreenCanvas rendering with main-thread fallback; optional installable offline shell.
- [ ] Separately scope sharing/accounts/sync/collaboration. Pages cannot supply their storage/auth/backend; define privacy/authentication/moderation/retention/operating costs. No arbitrary public plugin execution in the first release.

## Implementation Contracts

### Frontend And Chatter Reuse

Use React/Vite, strict TypeScript, Headless UI v2, Tailwind v4, Motion (`motion/react`), class-variance-authority/clsx, Lucide, TypeScript/Playwright. Adapt supported compatible versions and owned frontend behavior from `C:/Users/draxx/Sources/Chatter/apps/web`, not its whole manifest/stylesheet/glass palette/chat offsets/authentication/TipTap/sockets/Redis/CMS/backend. Keep adaptation/license notes. Custom CSS needs a concrete rendering/typography reason.

Chatter reference paths (not Grids files):

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

Extract when needed: shared `components/ui`/`browser`; `features/editor`, `features/library`, `features/crop`; versioned `model`/commands, `storage`, shared `rendering`, `providers`, `fonts`, `themes`, `templates`, `demo`, build-managed `assets/fonts`. Public files hold stable permitted demo URLs/licenses/app-owned icons; test-only images/fonts belong in `tests/fixtures`, not public builds.

## Catalog Candidates

None is implemented/certified. Direct means worth a browser spike, not verified support. Recheck current terms, query/image-CDN CORS, export/transform/cache rights, resolution/rate limits and deployed-origin behavior. Do not show disabled buttons implying support.

| Provider | Content / access candidate | Main check |
| --- | --- | --- |
| AniList | Anime/manga/characters; direct public queries, OAuth later personal lists | API terms/limits, image export/CORS |
| Jikan | Unofficial MAL anime/manga/characters; keyless direct | Documented 3 requests/sec, 60/min; upstream outages, separate image rights |
| Wikimedia Commons | Broad open-license/public-domain media; keyless direct | API origin=*; per-file creator/license, actual image CDN |
| Open Library | Books/author photos; keyless direct | Cover hotlink guidance, no bulk crawling, export/CORS |
| Scryfall | Magic cards/art crops; keyless direct | Full cards retain artist/copyright marks, no distortion/filtering; approved crops retain artist/source context |
| PokéAPI | Pokemon metadata/sprites; keyless direct | Artwork rights, source hosts, resolution/export quality |
| The Met Collection | Museum imagery; keyless direct | Only valid open-access/downloadable imagery with rights metadata |
| NASA Image and Video Library | Space imagery; keyless direct | Asset restrictions/credits, endpoints/resolution |
| MusicBrainz + Cover Art Archive | Music metadata/cover art; direct or gateway | Two-service lookup, identification/header/limit requirements, cover rights/CDN exportability |
| TMDB | Film/TV posters/backdrops/people; managed credentials recommended | Auth, required branding/attribution, image coverage/export rights |
| IGDB | Game covers/art/screenshots/characters; gateway required | Official browser restriction, Twitch secret/token lifecycle, terms |
| RAWG | Games/screenshots; credential gateway candidate | Current access/license/quota/attribution/export rules |
| Unsplash | Photography; approved app, gateway recommended | Mandatory hotlinking/photographer and Unsplash attribution/download tracking/cache-export policy |
| Pexels | Photography; credential gateway candidate | API rules/attribution/quota/storage-export policy |
| Pixabay | Photography/illustrations; credential gateway candidate | API/cache/hotlink rules/rights/quotas |
| Europeana | Cultural collections; credential gateway candidate | Per-object rights/provider links/variable image availability |

`crossOrigin` before `src` requests permission, not CORS authorization. Visible previews may fail anonymous loading or taint canvas. Metadata licensing does not license artwork, and proxies cannot fix prohibited reuse.

## Verification And Release

Keep production-subpath checks. Use the smallest behavior-scoped development check; relevant integrated checks for shared rendering/storage changes and milestones. Build success does not certify fidelity, data integrity, or permissions.

- [ ] Unit tests for composition/ratios/text/transforms, commands/IDs/migration, theme precedence, validated boundaries.
- [ ] Owned/licensed known-pixel square/portrait/landscape fixtures, pan/zoom/rotation/flip/transparency, long/Unicode/RTL text, custom fonts, preview/export agreement.
- [ ] Extend browser flows for section switches, crop Apply/Cancel, full undo/redo, theme/font reload, templates, archives, workers, gateway URLs and clean-browser project round-trip as features land.
- [ ] Failure tests for storage quota/corrupt files/fonts/missing media/interrupted migration, provider 429/timeouts/stale searches/CORS, archive limits.
- [ ] Keyboard/touch alternatives, desktop/mobile overflow/screenshots, accessible crop/progress/focus, reduced motion/high contrast across supported browsers.
- [ ] Mock provider CI traffic; tiny dated real-service smoke tests at integration/release checkpoints, never bulk crawls.

Public release requires recoverable migration, shipped crop/export fidelity, reviewed distributed assets, and policy/real-origin gates for advertised providers. Restricted media/fonts stay explicit portability limits. Hosted services/accounts/sharing remain optional, not core prerequisites.

## Reference And Sources

The unsigned live interface at https://www.anime.com/grid/new showed fixed sizes, square/portrait switching, naming/custom text/shuffle/download, show/character search, shows/movies/characters/top 10/anime taste/alignment/month/MBTI templates, community/Post controls. Grids instead uses flexible edges. Exact portrait ratio/provider/authenticated posting/output were not verified. Reuse workflow ideas, not artwork/branding/source/proprietary templates.

- AniList: https://docs.anilist.co/
- Jikan: https://docs.api.jikan.moe/
- MediaWiki CORS: https://www.mediawiki.org/wiki/API:Cross-site_requests
- Open Library covers: https://openlibrary.org/dev/docs/api/covers
- TMDB auth: https://developer.themoviedb.org/docs/authentication-application
- IGDB: https://api-docs.igdb.com/
- Unsplash: https://unsplash.com/documentation
- Scryfall: https://scryfall.com/docs/api

Planning research is not integration certification. Other candidates were not independently checked in this pass; recheck current terms/deployed-origin requests before implementation.