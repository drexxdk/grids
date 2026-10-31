# Grids Roadmap

Updated October 31, 2026. `[x]` = implemented and checked. `[ ]` = remaining work, including partial features. Only work items have checkboxes.

Build a general-purpose, single-grid editor for anime, characters, films, games, books, cards, photographs, and personal collections. Guests can use it without an account, API key, paid service, or backend. Optional accounts save user settings in a database; images always remain on the client. The static frontend can stay on GitHub Pages, but authentication/database access needs a separately hosted backend.

This is a new project with no users or real data. Prototype schemas, storage keys, and demo saves can be replaced or reset during development. Do not build legacy migrations, compatibility layers, or backup/recovery flows for prototype data.

## Agreed Direction

- One working grid, not a multi-board workspace. No board tabs, Add Board, duplication/reordering, or multi-board export.
- Guests automatically save settings to localStorage and have a visible Reset to Defaults command. Clearing locally stored images is a separate deliberate action.
- Prioritize Google, Discord, and Facebook sign-in using Chatter's login/session patterns. Signed-in users can save and reload their editor settings from their user record.
- Store only validated settings in the account database, not uploaded images, thumbnails, data URLs, file paths, or image placements/references. Image and uploaded-font files remain client-only; a different browser/device restores settings, not those files.
- Local username/password accounts are a lower-priority follow-up, after provider sign-in and settings persistence work reliably.

The single-grid model, guest autosave/reset, and selectable examples are implemented. Provider sign-in and database settings remain planned; the current app is browser-only.

Current limits: image blobs and the local grid snapshot use IndexedDB; localStorage holds a settings-only cache. Uploaded-font/thumbnail storage and multi-tab conflicts remain pending. Saves are debounced; browser usage, user-requested persistence, and recoverable unused-image trash are available, but persistence is not permanent backup. Undo is session-only and limited to resizing. Provider sign-in/database settings, general undo/redo, ratios, themes, custom font uploads, cropping, search, and project archives are unfinished. Canvas caps do not guarantee device memory safety. Pages build/workflow compatibility is checked, not a live deployment certification. Prototype storage is not a compatibility requirement.

## Development Order

**Next: finish the remaining guest-storage foundation, then provider sign-in and user settings, then layout/rendering.** Work through the steps below in order; local accounts follow provider login, not the other way around. Resolve demo-rights/hosting decisions early. Run crop, FontFace, catalog, and phone-export spikes before their dependent features. Failed sign-in or catalog services must not block the guest upload-only editor. No fixed delivery dates are assumed before those spikes.

### 1. Single Grid And Guest Storage

- [x] Replace the multi-board workspace with one grid and persisted export preferences; remove board navigation/add/delete/duplicate/reorder and Export All controls. Retain stable cell IDs and separate session UI state.
- [x] Start with a clean versioned schema/storage key, defaults, and strict Zod boundary validation. Ignore obsolete or invalid prototype saves; no multi-board selection, migration, or backup UI.
- [x] Convert examples into selectable single-grid presets, not append-only board packs. Applying an example requires deliberate replacement confirmation and retains library images; Cancel changes nothing.
- [x] Guest autosave with a settings-only localStorage cache and IndexedDB grid/media storage; visible Reset to Defaults and failed-save feedback. Reset retains local images/captions/placements. Saving/Saved/Save failed report real completion; unavailable storage leaves session editing/export usable. Account records do not exist yet.
- [x] Define separate layout/style configuration and local cell content/media contracts; strict settings-only extraction/application excludes media and image references. Shared schemas validate local documents and settings; reset uses the same application path. Future account APIs must accept this allowlist, never the full local document.
- [x] Central typed document commands/React reducer for current mutations, with ID-based live targets, immutable updates, atomic batch imports, media-preserving replacement, and replay-stable resize/reset commands. Session UI and pending async work stay outside saved state; future crop drafts/provider requests must follow this boundary. No additional state library.
- [x] Fresh Dexie/IndexedDB storage for client-only image blobs and coherent grid snapshots, separate from account-settings payloads. Serialized transactional saves, validated restoration, managed/revoked object URLs, preset identity/deduplication, rollback/retry, and missing-image overwrite protection. localStorage stores only settings; no prototype migration.
- [ ] Extend client-only binary storage to uploaded fonts and generated thumbnails alongside those features; manage their object URLs and keep files out of account settings. Bundled fonts remain static assets for now.
- [x] Debounced Saving/Saved/Save Failed status: coalesce edits for 300 ms, flush on page hide, retain unsaved-navigation guards, and retry failed saves on subsequent edits. Background flush is best-effort, not a guarantee against abrupt termination.
- [x] Mobile-accessible local-storage dialog: stored-image count/bytes, browser-origin usage/quota, and persistence status. Request persistent storage only on deliberate clicks; denied/unsupported/error states never imply a grant. Browser storage is not permanent backup or synchronization.
- [x] Unused-image cleanup and recoverable trash: protect visible/removed-cell references, persist trash across reloads, restore original IDs/files, and require separate confirmation before transactional blob deletion. Failed purges retain stored data/URLs until retry commits. Extend reference protection alongside future general undo history and new media types.
- [ ] Revision checks and BroadcastChannel notifications against silent multi-tab overwrites.
- [ ] General undo/redo for text/layout/crops/templates/reset/cell deletion/batches. Coalesce typing/slider gestures; one Apply/bulk action is one entry. Store small patches/media IDs, not repeated binaries; retain media referenced by history/trash.
- [ ] Review comic rights/credits; replace unclear examples with owned/licensed content. Keep discoverable asset-specific licenses; remove unused logos after reference checks; move test-only samples out of public builds. Update examples/tests directly when asset paths change; no legacy path migration.
- [ ] Incrementally separate editor/library/domain/rendering/storage ownership. Use build-managed font imports where suitable; retain stable public URLs where needed. Do not create empty architectural scaffolding.
- [ ] ESLint, Prettier, Vitest, Testing Library, broader component variants, and remaining primitive checks below. Add Sonner with the notification layer while retaining inline actionable errors; Floating UI/TanStack Virtual only when needed.

Exit criteria: one usable grid with no board manager, initialized from the new schema; guest autosave/reset works across reloads without accidental media deletion; failed saves are reported; history stays bounded; distributed examples have reviewed rights. Replace obsolete multi-board tests with single-grid/default/reset coverage while retaining image-placement/export checks.

### 2. Provider Sign-In And User Settings

Depends on the single-grid/settings boundary from step 1. This is settings persistence, not image hosting or cloud project storage.

- [ ] Inspect/adapt Chatter's provider-login UI, session lifecycle, and safe account-linking behavior. Implement Google, Discord, and Facebook before local accounts; evaluate provider configuration/app-review requirements and registered callback origins.
- [ ] Choose a separately deployed authentication API and user/settings database. Keep provider secrets server-side; define the Pages/custom-domain/API origin, session/cookie/CORS/CSRF policy, and supported-browser behavior before shipping. A static Pages build cannot implement login/database writes alone.
- [ ] Secure provider callbacks with the flow's state/PKCE/nonce protections, validated tokens/provider identity, minimal scopes, and secure session/logout handling. Use stable provider subject IDs; do not auto-link accounts solely by an unverified matching email. Linking providers requires explicit authenticated confirmation.
- [ ] Save an allowlisted, versioned settings record owned by the authenticated user: grid dimensions/ratio, layout, theme/colors, typography choices, visibility, export defaults, and editor preferences. Enforce ownership and validation server-side; never upload the full local document or accept image/font binaries, data URLs, thumbnails, image URLs/file paths/placements, or other media payloads.
- [ ] Restore settings on return with real Saving/Saved/Save Failed feedback and revision/conflict protection. On sign-in, offer Keep Guest Settings/Load Account Settings rather than silently replacing either copy. Handle missing local images/fonts with local reselection/fallback, never server upload.
- [ ] Keep guest and per-user local caches isolated. Logout/account switching must not leak another user's settings or overwrite the guest draft; provider/backend failure leaves guest editing/local autosave available.
- [ ] Test all three provider flows, callback/session failures, linking/logout/account switching, settings ownership, guest-to-account choices, and restoration in a clean browser. Assert that account requests/database records contain no client media or image references.

Exit criteria: Google/Discord/Facebook sign-in and user-owned settings persistence work; another device restores configuration with no promise of image/font synchronization; guest editing/reset stays independent. Backend/database deployment needs an explicit hosting/security decision before implementation.

### 3. Layout, Rendering, And Export Reliability

Depends on stable IDs/schema and client storage from step 1; rendering itself does not require sign-in.

- [ ] One numeric composition path for accessible DOM preview and canvas export: cell rectangles, heading/caption/footer blocks, line breaks, styles, crops, clips, and transforms.
- [ ] Independent grid layout, image-cell ratio, and final export dimensions. Changing one never silently changes the others or stretches the composition to force an outer ratio.
- [ ] Uniform board ratios: 1:1, 2:3, 3:4, 4:5, 3:2, 4:3, 16:9, 9:16, validated custom ratios. Preserve originals/focal points; mixed/spanning tiles come later.
- [ ] Independent horizontal/vertical gaps, outer padding, border width/color, corner treatment, heading/caption sizing.
- [ ] Subtitle/footer/rank/row-label/column-label/per-cell-text switches with retained settings and undo/redo; row-first/column-first numbering and optional exported numbering.
- [ ] Image/font/source-policy preflight identifying exact missing/nonexportable cells; retry/replacement or deliberate placeholder export, never silent omission.
- [ ] PNG/WebP transparency, explicit JPEG flattening, final dimensions/scale/social sizes, filename/credit controls, upscaling warnings and file-size estimates where practical.
- [ ] Bounded source decoding/concurrency and representative-device benchmarks. Canvas memory starts near four bytes/pixel before source images/intermediates/thumbnails/encoding. Add progress/cancel and resolution recovery for the current grid.

Exit criteria: preview/export agrees across ratios/visibility; layout preserves placements; errors name offending cells; measured budgets support realistic phone exports, not unlimited resolution.

### 4. Appearance, Fonts, And Text

Depends on shared composition/text from step 3. Account persistence stores style/font choices only; uploaded font files stay local.

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

### 5. Image Editing, Library, And Responsive Controls

Depends on stored originals, history, and shared image transforms.

- [ ] Maintained crop library such as react-easy-crop with validated normalized coordinates. Touch/keyboard pan, zoom slider/stepper, rotation, horizontal/vertical flip, center/reset, ratio lock, guides, live target preview.
- [ ] Apply is one undoable action; Cancel changes nothing. Per-cell normalized crops/focal points/transforms preserve originals and independent crops of reused media; deterministic clamping and Keep Composition/Reset Crop on ratio changes.
- [ ] Copy/reset/apply-to-selection transforms subject to source permissions; explain disabled crop/rotation/filter/overlay actions.
- [ ] Clipboard images where supported, verified mobile photo selection, cancellable ordered batch imports with progress/per-file failures retaining successful imports.
- [ ] Real decode/type/file-size/pixel validation. Initial proposals: 20 MB/file and 40 MP, subject to benchmarks. JPEG/PNG/WebP first; AVIF decode-dependent, animation first-frame, HEIC conversion separately evaluated. Reject SVG or use vetted sanitization/rasterization; never inject uploaded markup or execute external resources.
- [ ] Hash-based deduplication; library search/rename/tags/collections/favorites/recent/used-unused views and source metadata.
- [ ] Referenced-media Cancel/Replace/Clear choices, undo and recoverable trash. Irreversible cell/media deletion needs a separate deliberate confirmation/history policy.
- [ ] HTTPS image URL imports, not arbitrary webpage scraping; explain URL/CORS/provider failures and retain upload fallback.
- [ ] Desktop compact single-grid/undo/reset/ratio/template/appearance/export toolbar with account/settings access, central grid, left library, contextual Layout/Appearance/Typography/Cell inspector. No board tabs/manager. Library views: Uploads/Search/Collections/Examples; domain filters belong in Search.
- [ ] Mobile board-first experience with deliberately opened library/inspector sheets, no input autofocus. Headless UI Listbox/Combobox/TabGroup/sheets where applicable; shared Motion/reduced motion; feature-scoped Tailwind migration.
- [ ] Full keyboard/touch move/swap/selection alternatives to dragging. Named Lucide tools, swatches, segmented modes, switches/numeric controls, accessible progress/focus/contrast, 44px touch targets. If localized, single plural-aware count messages using Chatter's i18next/ICU approach.

Exit criteria: independent crops survive reload/undo and match exported pixels; originals remain unchanged; batch failures recover; keyboard/touch editing and mobile sheets work.

### 6. Initial Catalog Search

Depends on compatibility checks and media/rights/crop/export foundations. Target: three validated catalogs across at least two domains, alongside uploads/examples.

- [ ] Spike AniList/Jikan and actual image CDNs from the deployment origin; choose the more reliable anime provider. Add Wikimedia Commons and one export-compatible books/art/card catalog. Replace failed candidates rather than advertise support.
- [ ] Typed registry: provider/domain/icon/capabilities/filters/configuration/availability/policy. Operations: search/details/variants/permitted preview-export resource resolution and required selection/download hooks.
- [ ] Normalize entity/image IDs, titles/alternatives, type/year, source page, thumbnails/variants/dimensions, creator/license/rights/attribution. Separate entities/images, preserve provenance, deduplicate using authoritative cross-provider IDs rather than similar titles.
- [ ] One provider/domain per search initially. Debounce/cancel stale requests/paginate/throttle/respect Retry-After/cache within policy. Combined search later uses enabled providers and bounded concurrency, never every catalog per keystroke.
- [ ] Distinct loading/empty/offline/unavailable/quota/unsupported-domain/auth states; poster/portrait/backdrop/edition/language/resolution variants; selected-cell placement/queue/fill-empty-unlocked without accidental replacement.
- [ ] Confirm permitted export readiness before placement; retain required remote representations/credits. Explain query/network-identity disclosure to providers; uploads stay local.
- [ ] Dated real-origin compatibility reports: search/pagination, actual Pages-origin image loading, untainted canvas export, attribution/transform/storage rules, 429/timeout/bad-response/missing-image recovery, permitted offline/cache behavior.

Exit criteria: no protected credentials in static assets; every shipped provider clears policy/real-origin/export checks; failures cannot damage boards or disable the offline upload-only core. API access is not permission to reuse images; proxies do not override terms.

### 7. Templates, Batch Tools, And Portable Projects

Depends on commands/history, themes, renderer, media/font permissions.

- [ ] Blank/top 9/top 10/favorites/watchlist/before-after/month/alignment/16-slot personality templates. Domain-neutral definitions include labels/layout/ratio/text/theme, optional anime/game/book/film/photo suggestions, no provider dependency.
- [ ] Preview with Keep Content/Replace Layout choices for the current grid. Personal layouts/styles exclude private images by default. Right/bottom edge controls stay usable after every template: no layout lock-in or board duplication.
- [ ] Multi-selection, duplicate/clear/lock cells, shuffle/sort/fill-empty, undo and keyboard/touch alternatives within one grid.
- [ ] Optional memory-preflighted client-side ZIP bundles of the current grid/output/attribution using fflate, not multi-board batch export.
- [ ] Versioned single-grid `.grids` archives with permitted media/fonts/thumbnails/attribution, generated/imported entirely client-side and never uploaded by account-settings sync. Restricted binaries remain explicit references/portability limits; theme/template JSON excludes private media/credentials.
- [ ] Validate schema/archive paths/file counts/compressed and uncompressed sizes/pixel dimensions before workspace changes; protect against zip bombs and unsafe overwrites.
- [ ] Image clipboard export/native share where supported, attribution sheets. Required source credits are never an optional toggle.

Exit criteria: upload-only projects with custom fonts/independent crops round-trip offline in a clean browser; archives respect rights/limits; templates never trap layout or discard content accidentally.

### 8. More Catalogs And Optional Gateway

Requires explicit hosting/credential/terms/cost approval and step 6 catalog gates. This is separate from the account-settings API.

- [ ] Separate Cloudflare Worker or equivalent metadata gateway only for protected credentials/incompatible browser access. Missing configuration/outages disable only affected catalogs. Fetch/decode catalog images on the client from permitted source CDNs; do not add server-side image upload/storage/cache or promise support for sources requiring an image proxy.
- [ ] Fixed provider routes/validated IDs, approved HTTPS hosts/paths, per-hop redirect validation, private/reserved target blocking, file/type/dimension/time limits, quotas/bounded caches/kill switches, independent abuse controls. No fetch-any-URL or public unaudited CORS proxy.
- [ ] Server-side secrets/rotation; none in `VITE_*`, static assets, projects, unnecessary logs. Restrict origins without treating CORS as authentication/quota protection. Never automatically send private images to remote conversion/cropping services.
- [ ] Add films/games/photography and further open catalogs individually through the same compatibility reports.

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

Use React/Vite, strict TypeScript, Headless UI v2, Tailwind v4, Motion (`motion/react`), class-variance-authority/clsx, Lucide, TypeScript/Playwright. Adapt supported compatible versions and owned UI behavior from `C:/Users/draxx/Sources/Chatter/apps/web`; inspect its provider-auth/session/account-linking implementation when step 2 begins. Do not copy the whole manifest/stylesheet/glass palette/chat offsets/TipTap/sockets/Redis/CMS/chat backend. Reuse relevant security patterns without making the editor depend on Chatter's chat stack. Keep adaptation/license notes. Custom CSS needs a concrete rendering/typography reason.

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

- [ ] Unit tests for composition/ratios/text/transforms, commands/IDs, clean storage initialization, theme precedence, validated boundaries.
- [ ] Owned/licensed known-pixel square/portrait/landscape fixtures, pan/zoom/rotation/flip/transparency, long/Unicode/RTL text, custom fonts, preview/export agreement.
- [ ] Extend browser flows for single-grid defaults, guest autosave/reset, provider login/settings restoration/media exclusion/account isolation, section switches, crop Apply/Cancel, full undo/redo, theme/font reload, templates, client-side archives, workers, and gateway URLs as features land.
- [ ] Failure tests for storage quota/corrupt files/fonts/missing media, provider 429/timeouts/stale searches/CORS, archive limits.
- [ ] Keyboard/touch alternatives, desktop/mobile overflow/screenshots, accessible crop/progress/focus, reduced motion/high contrast across supported browsers.
- [ ] Mock provider CI traffic; tiny dated real-service smoke tests at integration/release checkpoints, never bulk crawls.

Public release requires reliable single-grid initialization, guest autosave/reset, shipped crop/export fidelity, reviewed assets, and policy/real-origin gates for advertised catalogs. Account features additionally require secure provider sessions, user-owned settings, and verified exclusion of client media from server requests/storage. Restricted media/fonts stay explicit portability limits. Sign-in is optional for guests; local accounts and settings-only sharing are later work, and image cloud storage/sync is out of scope.

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
