# HYPERION - Design Specification

## 1. Product Direction

Hyperion is a desktop mod manager for Cyberpunk 2077 with a dark, intentional, information-dense interface.
The visual tone is refined industrial: near-black surfaces, disciplined borders, precise yellow accent, minimal but meaningful glow.

Primary goals:
- Fast orientation for installed mods and downloads
- High readability under dense data
- Strong hierarchy without noisy sci-fi decoration
- UI that feels deliberate, not generic or over-stylized

## 2. Foundation

### Core palette

```css
--bg-base: #0A0A0A;
--bg-surface: #111111;
--bg-elevated: #161616;
--bg-subtle: #1C1C1C;
--border-default: rgba(255,255,255,0.06);
--border-strong: rgba(255,255,255,0.12);
--text-primary: #F2F2F2;
--text-secondary: rgba(242,242,242,0.55);
--text-muted: rgba(242,242,242,0.28);
--accent: #FCEE09;
--accent-hover: #FFF22A;
--accent-dim: rgba(252,238,9,0.12);
--accent-cyber-blue: #4FD8FF;
--status-success: #34D399;
--status-warning: #FCEE09;
--status-error: #f87272;
--status-info: #60A5FA;
```

Accessibility:
- All visible text must meet at least WCAG AA contrast against its immediate background
- Use $4.5:1$ for normal text and $3:1$ for large text
- Helper/support copy must not drop below the Downloads timestamp baseline: `text-sm` / roughly 14px with the same readable gray value used by download dates (`#9A9A9A` or stronger)
- This minimum applies especially to Settings, dialogs, logs, and explanatory copy; avoid 9-12px body text on dark surfaces unless the text is purely badge chrome
- **Micro-label hard floor — MUST follow everywhere**: never use uppercase tracking labels below 11px for anything the user needs to read (section headers, group labels, field captions, status tags inside content areas). 11px is the absolute minimum for any label that carries meaning; below that is chrome-only territory (icon badges, decorative corner chips). Labels like `INFORMATION:`, `INSTALL OPTIONS`, `PREVIEW` inside dialogs must be ≥ 11px with AA contrast. When a label feels unreadable the fix is always larger text or higher contrast — never accept a tight space as a reason to shrink below the floor

### Typography

- Syne: logo, high-level titles, uppercase emphasis
- DM Sans: primary UI font for labels, panels, forms, lists, dialogs, helper copy, buttons, and readable support text
- Oxanium may remain available only where a shipped screen already depends on it as a screen-title accent; do not spread it casually through routine UI
- Monospace is reserved for clearly technical values only, such as code-like payload inspection or highly technical diagnostics
- Do not use monospace for small helper copy, explanatory paragraphs, or secondary UI descriptions; those should use DM Sans instead
- Small support text should prefer the same visual token used by download dates: readable 14px sizing, restrained gray, and AA contrast at minimum
- Dates and timestamps should follow the user's Windows-style local format in UI surfaces: `DD/MM/YYYY HH:mm:ss` (example: `19/04/2026 15:47:08`)

### Motion

- Motion is short and purposeful
- Sidebar width change: 300ms max
- Standard fades/translates: 150-250ms
- No pulsing, flickering, or sweeping highlight animations

## 3. App Shell

### Window shell

- Frameless Electron window
- Custom header with drag region across the top bar
- Main renderer stays hidden until splash handoff is complete
- Initial desktop window size should scale from the primary display work area instead of a single fixed size; 1080p, 1440p, and 4K should all open into a comfortably large workspace
- Background uses a subtle static atmospheric field from App.tsx and globals.css
- Avoid animated parallax star layers in the main shell; keep the background understated and low-cost to render

### Header

- Height: 56px
- Left side: Hyperion mark + wordmark
- A subtle app version marker should live in the shell header so the current build is visible from any page without opening Settings
- Right side: library utility buttons, single-step updater CTA, app logs button, native window controls
- The terminal icon in the header opens App Logs; it is not an in-app terminal session

### Sidebar

Current implementation state:
- Collapsed width: 80px
- Expanded width: 256px on hover
- Top account block is hidden while collapsed and revealed on hover
- Top account block should reflect real Nexus connection state when available: account name plus `Premium Connected` / `Free Connected`
- When Nexus is not configured, the block should fall back to a neutral `Nexus Account / Not Connected` treatment instead of faux online-system language

Navigation order:
1. Mod Library
2. Downloads
3. Settings
4. Launch Game CTA at the bottom

Sidebar behavior:
- Active item gets yellow text, subtle dark background, and a 2px left accent bar
- Inactive items use muted gray and brighten on hover
- Labels fade in only in expanded state
- Launch Game is icon-only while collapsed and reveals text on sidebar hover
- Launch Game motion must remain stable: no backward jitter before moving forward

Launch Game states:
- **Ready**: primary yellow button (`bg-[#fcee09] text-[#050505]`), `play_arrow` icon, label `LAUNCH GAME`
- **Disabled** (path not set): muted dark button, `cursor-not-allowed`
- **In Game**: secondary success-tinted button (`bg-[#0c1410] border-[0.5px] border-[#34D399]/30 text-[#34D399]`), `sports_esports` icon, label `IN GAME`, `cursor-default` (not clickable)
- When In Game, a second **Close Game** destructive button appears below, same `py-3` height, `power_settings_new` icon, label `CLOSE GAME`, uses error-red tone (`text-[#f87272]`, dark bg, `/20` → `/40` border on hover)
- Game running state is polled every 5 seconds via `IPC.GAME_RUNNING` (`tasklist`); `IPC.KILL_GAME` (`taskkill /F`) handles force close
- Mod installation is blocked while the game is running (toast: `Close Cyberpunk 2077 before installing mods`)

Alignment rules:
- Nav icons, Settings icon, and Launch Game icon must share a consistent visual axis
- Launch Game must remain centered while collapsed
- Expanded content should reveal to the right of the icon without shifting the icon backward first
- Both Launch Game and Close Game buttons must share identical height (`py-3`) so they read as a consistent pair

## 4. Screen Design

### Splash

- Minimal loading screen handled in main-process resources
- Hyperion identity only, no faux terminal, no bracket ornaments
- Progress remains understated and accent-led

### Welcome / first setup

- Shown when required paths are missing or invalid
- Header and sidebar stay hidden until setup is complete, then the full shell appears
- Onboarding has two phases: a **welcome screen** first, then a **3-step setup wizard** (`Game` -> `Mod library` -> `Downloads`), each step focused on a single path
- The whole surface is centered in the viewport on a narrow-to-moderate column (welcome ~560px, steps ~600px); it never anchors as a tall top-left column
- Voice is plain and human: sentence-case headings phrased as questions ("Where is Cyberpunk 2077 installed?"), friendly one-line descriptions, and no dense uppercase micro-labels or technical jargon. Avoid the badge-heavy "dashboard" look (no `REQUIRED`/`OPTIONAL`/`TARGET INVALID` chips, no `FIRST RUN` ribbon, no mono `01/02/03` boxes)
- Show the current Hyperion version as a subdued detail so first-run/setup states still expose build context before the main shell appears

Welcome screen:
- Centered: the Hyperion brand mark (the shared yellow rounded square + dark inner square + `HYPERION` wordmark, reused from the header), a large sentence-case headline ("Let's set up your workspace"), and a short reassuring subtitle that the setup is quick and one-time
- A preview list of the three things to configure — each row is a numbered circle, an accent icon, the label, and a plain one-line description; the Downloads row carries a quiet `Optional` tag
- A single primary `Get started` CTA advances into the wizard; elements stagger in with `.fade-up` (small `animationDelay` increments)

Setup wizard:
- Top: the small brand mark plus a `Step X of N` counter, then a step progress rail of **rounded numbered circles** connected by a fill bar — active circle is filled yellow with a soft ring, completed circles show a check on a green ring (and the connector fills green), future circles stay dim. Clicking a completed circle navigates back to it
- Each step is one rounded card: an accent icon tile, the question heading, a plain description, a `Selected folder` path box, an inline validation row, and two folder actions (`Detect automatically`/`Use suggested` as a neutral button + `Choose folder` as the accent-outline button)
- Validation is communicated inline, not via badges: green `check_circle` + positive copy when valid, yellow `error` + plain explanation when invalid, a muted `radio_button_unchecked` when empty, and a neutral `info` line on the optional Downloads step
- Step transitions use `.slide-in-right` when advancing and `.slide-in-left` when going back, keyed by step index so the animation replays every change; the valid-state validation row replays a `.scale-in` pop
- Footer holds a ghost `Back` button (returns to the welcome screen from step 1) plus either `Continue` (non-final steps, gated on that step's path validating, with a tooltip explaining why it's disabled) or `Finish setup` (final step, with a loading-spinner state while applying)
- All buttons share a hover lift (`-translate-y-px`) plus glow/border feedback and a press scale-down (`active:scale-[0.98]`) for tactile feedback; controls use soft `rounded-md`/`rounded-lg` corners rather than the squared industrial chrome used elsewhere, to keep onboarding approachable

### Library

- Main working surface for installed mods
- Dense table/list layout with active state clarity over ornament
- Mod details opens as a centered modal overlay over the library instead of navigating to a separate screen
- MUST: the mod details modal stays visually centered, uses a lower-height squared silhouette, and all controls/panels/badges/inputs inside it use rectangular corners with no pill or soft-card rounding
- MUST: the mod details modal is tabbed; `Files` is the primary inspection tab and `Details` holds secondary metadata, notes, conflicts, source context, and operational actions
- MUST: file inspection inside mod details uses a dense squared tree view of game-relative deployment targets; do not reduce this surface to a flat filename dump when indexed paths are available
- MUST: the `Files` tree starts collapsed by default, and expanding folders must never resize or recenter the modal; the modal frame stays fixed to the current app window and uses internal scroll regions instead
- MUST: file-tree operations live in a right-click context menu instead of a crowded toolbar; folder expansion supports double click, and exact-location reveal lives in that same context surface
- MUST: create/rename prompts launched from the mod-details file tree reuse the same compact squared input-modal language as separator creation, with an empty focused input for new file/folder actions
- The mod details modal may scale wider than before to prioritize the `Files` workspace, but it must remain centered and sized from the current app window rather than from tree depth/content
- Visual emphasis goes to name, status, type, actions, and activation state
- Mod search belongs to the library surface itself, not the global header, so filtering stays contextual to `Managed Mods`
- The mod search field should share the same dark squared chrome, border language, and vertical rhythm as adjacent library action buttons instead of reading like a different widget family
- Library status filtering should live in the screen itself, below the selection guidance, not in the global header
- Use local segmented controls for `All`, `Enabled`, and `Disabled`; `All` may use the cyber blue accent while activation-oriented controls should reuse the same squared button language as Browse and other path actions
- Enable/disable-all control should read as a compact rectangular command block, not a toggle switch and not a rounded pill
- Table sorting should be available from `Mod Name`, `Type`, and `Installed`
- Sort icons should stay visually secondary and sit tight to the label without affecting the left alignment of the header text
- Bulk actions should appear only when multiple mods are selected
- Sort affordance should keep the entire header cell clickable, left align the label, and show only one active sorted column at a time
- When the local status filter is `Enabled` or `Disabled`, the enable/disable-all control should be visibly disabled and explain that state through the shared tooltip treatment
- Separators are first-class library rows in `Custom Order`, not a separate grouping mode layered on top of the list
- While a column sort is active, flatten the library into a pure sorted mod list and hide separators entirely; the third click must return to `Custom Order` with separators restored in their saved positions
- Mods inside a separator should shift the entire row inward as a grouped sub-block; do not move only the left active bar
- Grouped mods should use the regular left accent position with a cyan accent instead of introducing a second cyan guide line beside the row
- Separators should support moving selected mods into the block through direct drag/drop and explicit library actions
- Separator headers should align left like a real section marker, use readable label sizing, and avoid compressed microtype
- Separator helper copy should stay hidden until an actual drag is in progress; do not keep `Drag mods here` permanently visible on the row
- Separators should be collapsible so large grouped sections can fold away without losing their custom-order placement
- Expanding a separator should use a subtle motion cue; use one chevron affordance only and avoid stacking multiple right-pointing icons in the same header
- Manual drag reorder in `Custom Order` should work both on separators and on individual mod rows; dropping before or after a mod row must be a valid target, not just dropping onto the separator header
- Moving a mod into a separator should update the visible custom order immediately and should never require reselection or a refresh for the row to appear in its new block
- The persistent `Custom Order` guidance should stay lightweight inside the title/toolbar chrome; do not spend a full-width helper row on it. When dragging, the table header itself should become the compact `Top Level` drop target
- Selecting a separator should support range/additive selection with the existing `Shift` and `Ctrl/Cmd` patterns, and dragging a selected separator should move its whole block with child mods intact
- Creating or renaming a separator should use a compact confirmation/input modal instead of forcing inline rename on the row itself
- The `Create Separator` modal should open with the text cursor already active in the input so the user can type immediately without clicking first
- In `Custom Order`, the library should explain how to group mods: drag onto a separator, use the separator context action, or use the bulk `Move to Separator` command
- `Add Separator` belongs beside the local filter controls, while destructive library actions stay near the primary `Install Mod` CTA on the far end of the toolbar
- Right-clicking empty library space should expose `Create Separator Here` so the user can insert a separator at that exact point in custom order
- Right-clicking any library row should include a `Create Separator` action, and empty-library context menus should also offer `Refresh` and other lightweight utilities such as separator expand/collapse
- In row context menus, `Reinstall` should stay near the top of the action stack instead of being buried below secondary utilities
- Right-clicking a separator should offer a single toggle that expands or collapses every separator in the library, using the current collapsed state to decide the label
- Reinstalling as copy should insert the new mod immediately after the source mod's current `#` position; if that insertion point is right before the next separator, the separator must shift down so the copy stays in the same context as the source
- Normal mod installations should always place the new mod at the end of the library list
- For deploy-path conflicts between enabled mods, Hyperion follows Mod Organizer style priority: the mod with the higher `#` order (lower in the library) wins on shared game-target paths
- Changing enable state or reordering enabled mods must immediately rebuild the active deployment stack so the on-disk game state always reflects current library priority

### Conflict Detection

Two conflict kinds are tracked:
- **overwrite** — two or more enabled mods deploy to the same game-relative file path; the higher-order mod wins
- **archive-resource** — two or more `.archive` files contain an internal resource with the same FNV1a hash, meaning they likely override the same in-game asset regardless of file path

Conflict indicators on mod rows:
- A single `warning` Material Symbol icon replaces the old numeric `+N / -N` badges
- Color encodes urgency: green = this mod only wins, red = this mod only loses, yellow = both win and lose
- Tooltip format: `Wins N file(s) - Loses N file(s) - Click to inspect conflicts.`
- Clicking the icon opens the mod detail modal directly on the Conflicts tab

Conflict inspector inside the mod detail modal:
- **Loss section** renders on top, **Win section** on bottom
- Sections with zero entries auto-collapse when the modal opens; sections with entries default to expanded
- The outcome lives in the section header and count chip; individual rows should avoid repeating long explanatory labels such as "this mod wins this resource"
- Each conflict row is a compact two-column comparison: resource/path first, then the other mod and load-order position
- For `archive-resource` conflicts, keep archive details inline below the path: hash, this archive, and the other archive in a compact "This / Other" pair. Do not render a second nested Archive Pair card.
- Section tone colors carry the meaning (green in Win, red in Loss); row chips should be small and restrained rather than competing with the path text
- The modal itself is wider than the Files tab default: `min(1480px, calc(100vw - 48px))` so long mod names remain readable without forcing a viewport-level horizontal scrollbar inside the padded overlay

Conflict dialogs (OverwriteConflictDialog, ConflictInspectorDialog):
- Both dialogs also show the archive hash hint line for `archive-resource` rows, using the same `Unresolved archive hash` / `Archive hash` label pattern
- All conflict and action dialogs render via `createPortal(_, document.body)` to stay above the sidebar stacking context at all viewport sizes

### Mod Updates (Nexus)

- Installed mods that originated from Nexus are checked for newer versions during startup, beginning while the splash screen is still visible. The startup check uses a full per-mod pass so all installed Nexus mods get a reliable status without the user pressing `Check Updates`, but it only gets a short grace window on the splash; slow Nexus responses continue non-blocking after the Library opens.
- Later automatic library refreshes (install/reinstall/delete) may use the cheaper `updated.json?period=1m` path to avoid repeatedly hitting `files.json` for every mod. Manual checks also use the full per-mod pass so older available updates are not missed. Update detection is scoped to the installed file's own lineage, not the mod page's latest MAIN release: it follows the Nexus `file_updates` chain (`old_file_id` → `new_file_id`) from the installed file, then matches by identical file name + newer upload/version when the chain is unlinked, and only falls back to latest-MAIN numeric comparison when no file id was recorded. This prevents an installed OPTIONAL file (e.g. a LUT pack) from being flagged as updatable to an unrelated MAIN file on the same page.
- Nexus request logs should summarize large `files.json` responses (count + small sample) instead of rendering the full file list; the app may still need the complete response internally for manual update checks.
- When a newer version is available, the mod row renders its installed version in red (`#f87171`) in the Version column with an inline cyber-blue `upgrade` button beside it. Tooltip format: `Installed: X - Latest: Y - New version on Nexus. Click to update.`
- Clicking the upgrade button is adaptive to the Nexus account: Premium resolves the download directly, stays on the Library view, then replaces and re-enables the mod in place when the archive finishes. Free opens the mod's Nexus files page so the user triggers the `nxm://` flow.
- A manual `Check Updates` control in the Library toolbar (cyan, with spinner + `Updates (N)` count) forces an immediate full re-check and toasts the result; the background checks stay silent.

### FOMOD Installer

- When a mod archive contains `fomod/ModuleConfig.xml`, the install flow pauses and opens the FOMOD Installer wizard instead of proceeding automatically. During the initial archive analysis phase (`detecting` state, before the wizard opens), a centered blocking overlay matching the install overlay style is shown with title "PREPARING INSTALLER", a description, progress bar, and current file — but without the "interface locked" warning since no write operations are happening yet.
- Modal: `min(860px, calc(100vw - 32px))` wide, `calc(100vh - 48px)` max height; rendered via `createPortal(_, document.body)`.
- Yellow `2px` accent bar across the top; a secondary progress bar in the same yellow (30% opacity) tracks step completion.
- Header row: `install_desktop` icon + "FOMOD INSTALLER" label (yellow, 10px uppercase) + mod name + step counter (`Step N / N`, right-aligned, monospace).
- Optional module image banner shown on the first step only when `<moduleImage>` is defined, using `object-contain` with full-slot scaling (no decorative background fill) and roughly `180-240px` visible height so landscape art stays readable.
- Step name displayed as a 16px semibold heading below the banner.
- Content area is scrollable; when the current step has plugin images, the dialog expands wider and a right-side **preview panel** (about `420px` wide) appears with a larger image slot that uses full-size `object-contain` rendering and no added background behind the art.
- Groups render as labeled sections with a dark bordered card (`#080808` surface). Group label is 10px uppercase muted.
- `SelectExactlyOne` / `SelectAtMostOne` → custom radio controls (yellow fill dot); `SelectAny` / `SelectAll` → custom checkboxes (yellow fill with check icon).
- `Required` plugins are always checked and show a small "required" badge; `NotUsable` plugins are greyed out and cannot be toggled.
- Footer: left = Cancel (secondary button with `border-[0.5px]` border, `text-sm` font, `rounded-sm`, muted text that brightens on hover — same language as Back); right = Back chevron button + Next / Install primary yellow button.
- Install button is disabled until all `SelectExactlyOne` groups have exactly one selection.
- On the last step, "Next" becomes "Install" with a `download` icon.
- All corners are squared (`rounded-sm`). No pill shapes.

### Downloads

- Separate screen sourced from configured downloads directory
- Header includes a contextual search field plus refresh and open-folder actions
- The Downloads search field should reuse the same squared chrome, yellow border rhythm, and hover/focus treatment as the Managed Mods search instead of introducing a second search style
- Downloads toolbar buttons should reuse the same bordered action language as Managed Mods so both screens read as one product system
- Downloads should behave like a real sortable table: `Archive Name`, `Status`, `Version`, `Size`, and `Downloaded` must support the same `asc -> desc -> default` sort cycle used in Managed Mods
- Downloads should remember the user's last search and sort state between visits/restarts instead of resetting to the default table every time
- `Status` in Downloads is an operational column (`Downloading`, `Paused`, `Installed`, `Downloaded`, `Error`, etc.); temporary attention markers such as `NEW` remain badges on the archive name rather than becoming status values
- Because the table now has a dedicated `Status` column, Downloads action controls should stay compact and icon-driven with clear tooltips; do not repeat textual state labels like `Installed` inside the `Actions` column
- Status badges in Downloads should stay visually stable while hovering the row; the row hover may brighten the line, but the badge itself should not morph into another semantic state
- Summary strip shows configured path, file count, and zip-ready count
- Download rows prioritize file name, format, modified date, install/reinstall action, and delete action
- Download ordering should remain stable across navigation and library changes; Nexus archives should keep the chronology of when the user initiated each download request, not the order in which transfers happen to finish or related mods get installed/removed
- Nexus downloads should enter Downloads with a `NEW` badge; clicking the archive row itself acknowledges it and clears the marker, and successful install/reinstall also clears it.
- The sidebar Downloads item shows active transfer attention while downloads are running, then falls back to a compact `NEW` marker only while unacknowledged downloads remain.
- Library-initiated mod updates are the exception: their download is treated as update work, shown as active download attention in the sidebar, and should auto-install/replace the source mod without navigating to Downloads or leaving a persistent `NEW` download marker.
- When Nexus metadata is available, Downloads should surface the resolved file version so multiple staged versions are distinguishable before install
- Install/extract progress launched from Downloads should reuse the same active-row language as live downloads instead of falling back to a tiny button-only state
- Archive extraction is its own phase and should use a distinct cool accent from the default download/install yellow, while later install/finalization can return to the product accent
- When extracting from `.zip`, `.rar`, or `.7z`, show the current internal archive entry when available so the user can see what is being unpacked in real time
- If the user confirms `Replace` or `Install as Copy` from a duplicate-install prompt, dismiss the confirmation immediately and hand off to the shared install progress UI instead of keeping the dialog visible during extraction/install
- Downloads rows should support a right-click menu with reveal-in-Explorer, install/reinstall, pause/resume/cancel, delete, and refresh-style utilities that match the row state
- In Downloads row context menus, `Install` or `Reinstall` should appear before file utilities such as reveal-in-Explorer
- Revealing a download in Explorer should select the exact file the user clicked, not just open the parent folder
- If a Nexus archive already exists in Downloads, use the shared confirmation dialog instead of a toast-only rejection and preview the renamed duplicate archive before the user confirms
- If the same Nexus archive is already downloading, reuse that same duplicate-download confirmation dialog instead of blocking the request; make it clear that one transfer is already in progress and preview the next duplicate name
- Repeated `Download Again` requests for the same Nexus file should serialize behind the first request and still end in the shared duplicate-download confirmation flow; do not fall back to a warning snackbar/toast just because the first request is still spinning up
- If multiple Nexus versions of the same mod are downloaded, allow every archive to finish downloading and defer the decision to install time with a clear version-comparison prompt
- Loose-file overlaps should not be framed as a hard install error; use an overwrite preview that explains which shared game paths the incoming mod will win or lose based on its current library position
- Archive installs must preserve real game-root folders such as `engine`, `r6`, `bin`, `archive`, and `red4ext`; never flatten those directories away during extraction, because their contents must deploy back into the game root with those prefixes intact
- The version-comparison prompt should use the cyber blue accent treatment and fit common desktop heights without introducing an internal scrollbar
- The version-mismatch prompt stays minimal: a header with a short one-line summary and a small relation badge (`Newer`/`Older`/`Different`/`Review`), one compact `installed → selected` version row (no source-archive or matched-identity clutter), then a uniform set of choices
- Both upgrade and downgrade expose three outcomes with the same layout: the recommended/safe outcome as the top card, an always-available `Add to Library` card (installs the selected archive as a separate copy so both versions stay), and the secondary/risky action as an understated footer button. Upgrade → top card `Update to vX` (replace, cyan, recommended) + footer `Not now` (skip); downgrade → top card `Keep vX` (skip, yellow, recommended) + footer `Replace with older vX` (replace, red text)
- Phrase the keep-both option by its action (`Add to Library`), not by describing the result; avoid verbose labels like `Keep Both Versions Side By Side`
- Downgrade states should escalate with the error red token instead of blending into neutral or blue status chrome
- Version mismatch decisions should be explicit per install attempt; do not show a remember-this-choice checkbox in the prompt
- While an archive is actively downloading or paused, its active progress row should own that slot in Downloads; do not render a second local-file row for the same archive path until the transfer leaves the active state
- Paused downloads should switch from the default yellow transfer language to a cooler accent, show a `Paused` badge, and swap the primary row control from `Pause` to `Resume`
- Pause and resume should flip the row state immediately on click, use compact icon buttons in the actions column, and never let stale progress events from an earlier transfer attempt fight with the current row state

### Settings

- Accessible as a full content view, not merely a hidden modal afterthought
- Used for game path, library path, downloads path, Nexus connection, library maintenance, and app-level utilities
- Should feel operational and clear, not decorative
- Settings should be organized into three explicit sections only: `Paths`, `Nexus`, and `Updates`
- Do not keep a generic `Workspace` section or placeholder future-module scaffold in the primary UX
- Settings must keep Hyperion's operational chrome: squared small-radius panels, 0.5px borders, dark surfaces, uppercase `brand-font` section names, and yellow as signal rather than decoration
- `src/renderer/features/ui/uiKit.tsx` may provide shared helpers for Settings and Welcome, but Settings should not inherit a soft onboarding or SaaS-style card language from first-run flows
- Cards use the compact `SettingCard` pattern: squared dark surface, thin yellow top rail, small icon tile, uppercase heading, and one readable line of support copy
- State is shown two ways: an inline `ValidationRow` under the relevant control for the human, consequence-aware message, and an optional squared `StatusReadout` in the card header for at-a-glance status
- Validation copy must be consequence-aware (e.g. `Cyberpunk 2077 found. Launch and deployment validation are ready.` / invalid copy that names what stays blocked) while the surrounding chrome stays compact and operational
- Header status readouts must communicate only the concrete state value: `CONNECTED`, `PREMIUM`, `READY TO INSTALL`, or `v0.14.0`; avoid split prefix/value badges such as `NEXUS / CONNECTED` and avoid decorative side bars inside the badge
- Path values render in the shared monospace `PathBox`; buttons use the shared kit set with Hyperion button proportions, squared chrome, and no hover lift or press-scale theatrics
- Tabs read as a compact segmented strip with icon + uppercase label per tab; the active tab is a restrained dark/yellow segment, not a solid pill
- Settings should use a calmer reading width (~960px) than Library/Downloads; avoid stretching linear form decisions across the full desktop
- Inside each section, prefer a small number of large decision cards over many nested bordered boxes competing for attention
- Card content and follow-up actions stay within the card; the leading action sits left, the folder/primary action may sit at the row end on wide layouts
- Cards enter with a light staggered `fade-up`; rely on the main app surface for vertical scroll (no nested scroll regions inside Settings content)
- Support copy in Settings should use the shared readable small-text baseline instead of compressed microtype
- `Paths` is the primary section and must surface consequence (launch blocked / installs blocked) in the invalid validation copy when required targets are missing
- Nexus subscription tone is semantic across the app: `Premium` uses the warm amber/gold readout tone, while `Free` uses the cool info-blue readout tone
- The Account card in Settings > Nexus shows a two-card side-by-side tier comparison (`NexusTierComparison` in `SettingsDialog.tsx`): one card per tier, each listing 3 bullets describing how that tier behaves inside Hyperion. The active tier's card gets a colored border and icon accent (blue for Free, amber for Premium); the inactive tier is rendered in muted grey. When the user is not connected, both cards render in neutral grey with no highlight
- The sidebar should always expose a compact Nexus identity marker (avatar or initials) even when the rail is collapsed; expanding the rail may reveal the full name and subscription label
- Sidebar avatars/identity markers should use the same squared border language as other Hyperion controls and buttons; avoid soft pill or circular treatments that break the shell rhythm
- In the expanded sidebar account block, stack the content clearly as `name -> subscription badge -> connection state` so the subscription tag does not drift between labels
- Nexus settings should describe the manual download-to-install flow clearly; do not expose a global Nexus auto-install toggle in the primary UX
- Nexus API validation should happen automatically after the key changes; avoid a dedicated `Test Connection` button as a primary interaction
- When Nexus validation succeeds, show real account identity details such as display name, premium/free state, and user id/email rather than generic placeholder text
- Keep library maintenance tools in the main library workflow instead of duplicating them inside Settings
- The third Settings section should focus on Hyperion application updates only; diagnostics and app logs remain available from the shell header

### App Logs

- App Logs is a global overlay opened from the header terminal icon
- It should group diagnostics into clear tabs rather than separate scattered dialogs
- Use at least two tabs: `General` for app/runtime events and `Requests` for Nexus API traffic
- Log rows should stay single-line and compact in the collapsed state
- Expanding a row reveals structured content below the same row instead of opening a second screen
- Request payloads and structured log details should use a collapsible tree viewer similar to a JSON formatter
- The payload/detail viewer should feel like an inspector preview: dark code-like surface, collapsible rows, inline summaries for arrays/objects, and clear color separation between keys and value types
- Even when using syntax-style differentiation, App Logs should stay inside the Hyperion palette: primary text for keys, accent yellow for string emphasis, status/info colors for typed values, and restrained gray for structure chrome
- Payload actions such as copy should live in the same header row as the payload block they affect
- Secret-bearing payload fields should stay masked by default; if reveal is offered, it must be an explicit local toggle in the inspector and copy actions should respect the current masked/revealed state
- Sensitive tokens embedded in logged URLs or endpoints should be masked before they reach the viewer; URL surfaces should never expose raw credentials by default
- Request rows should prioritize `method`, `endpoint`, `status code`, and API response time; avoid extra diagnostic chrome unless it clearly helps
- Long request URLs should be read primarily in the expanded inspector content, not via cramped hover tooltips over collapsed rows
- Hover and selected states in App Logs should be clearly visible through stronger surface change and a distinct active border
- The top-right destructive action in App Logs clears the full log store; the tab strip may expose a second destructive icon aligned to the far right that clears only the currently selected tab and names that scope in its tooltip
- The tab strip, counters, and right-side actions in App Logs should align to the exact same inner content width as the log table below; left and right empty space should feel symmetrical with no extra right drift
- Tab buttons and tab-scoped action icons in App Logs should share the same visual height and sit on a single centered horizontal axis
- On large desktop windows, App Logs should expand into a wider workspace instead of staying as a narrow centered card; keep a modest viewport margin, but use the available horizontal space for inspection tasks
- Clear and close actions in App Logs should use icon buttons consistent with the header/window-control language
- Any support copy, labels, counters, and tree text inside logs must follow the shared readable small-text baseline and AA contrast rule

## 5. Components

### Buttons

- MUST: operational UI surfaces default to squared rectangular corners; rounded pills, soft capsules, and curved card chrome are not allowed unless a shipped screen explicitly requires them and the exception is documented
- Any shared `uiKit` controls used inside Settings must follow the squared Hyperion chrome; onboarding may be softer only where the first-run flow explicitly needs it.

Primary:
- Yellow background
- Black text
- Hover can brighten slightly to white/yellow edge without becoming glossy

Secondary:
- Very dark background or transparent dark surface
- Fine border and muted text
- Hover strengthens border/text contrast

Destructive:
- Error-tinted text or border
- Subtle red emphasis only on hover

Tooltips:
- Use a shared Hyperion tooltip component instead of browser-native `title` tooltips
- Tooltip treatment should stay compact: dark surface, fine border, uppercase micro-label, restrained shadow
- Disabled controls that need explanation should expose that explanation through the same shared tooltip component

### Toasts

- Compact stacked notifications
- Clear severity via border/accent, not giant badges
- Short text, no gimmick labels

### Lists and panels

- Thin separators
- Dense but readable row heights
- Hover states must increase clarity, not add noise

## 6. Updater UX

- Update availability appears in the header as a single compact CTA
- The self-update check is kicked off in the main process during the splash so the CTA is present the moment the window opens, rather than appearing a few seconds after the renderer finishes booting
- One click on Install update starts download immediately; no separate popover or second confirmation step
- Download progress is rendered inside the button itself
- After download finishes, the app installs and relaunches automatically
- States: available, downloading, installing, error
- Error state currently surfaces as simple text in header when no update is available
- Release channel depends on GitHub provider artifacts produced by electron-builder

Release expectations:
- package.json version is the installer/app version
- GitHub release tags should match vX.Y.Z
- Auto-update expects published release metadata such as latest.yml

## 7. Design Workflow For Future Changes

- Use this file as the canonical design reference before editing renderer UI
- For major visual rethinks or new screens, prototype direction in Google Stitch first, then implement in code
- If a UI change lands in code, update this document in the same task
- Prefer documenting actual shipped behavior over aspirational mockups

## 8. Current File Map

- App shell: src/renderer/App.tsx
- Header: src/renderer/features/ui/Header.tsx
- Sidebar: src/renderer/features/ui/Sidebar.tsx
- Welcome: src/renderer/features/ui/WelcomeScreen.tsx
- Library: src/renderer/features/library/*
- Downloads: src/renderer/features/downloads/DownloadsPane.tsx
- Settings: src/renderer/features/ui/SettingsDialog.tsx
- Toasts: src/renderer/features/ui/ToastContainer.tsx
- Main-process splash: src/main/resources/splash.html
- Theme tokens: src/renderer/styles/globals.css
