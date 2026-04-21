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

Alignment rules:
- Nav icons, Settings icon, and Launch Game icon must share a consistent visual axis
- Launch Game must remain centered while collapsed
- Expanded content should reveal to the right of the icon without shifting the icon backward first

## 4. Screen Design

### Splash

- Minimal loading screen handled in main-process resources
- Hyperion identity only, no faux terminal, no bracket ornaments
- Progress remains understated and accent-led

### Welcome / first setup

- Shown when required paths are missing or invalid
- Header and sidebar stay hidden until setup is complete, then the full shell appears
- Onboarding is a dedicated first-run workspace focused on game path, managed library path, and optional downloads intake path
- Game path carries explicit validation emphasis because it gates launch and deployment safety checks
- Clear primary CTA and minimal distractions
- Show the current Hyperion version here as a subdued detail so first-run/setup states still expose build context even before the main shell appears
- On large displays, the full setup surface should remain centered in the viewport and scale to a moderately wider layout instead of staying as a narrow top-anchored column

### Library

- Main working surface for installed mods
- Dense table/list layout with active state clarity over ornament
- Detail panel appears when a mod is selected
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

### Downloads

- Separate screen sourced from configured downloads directory
- Header includes refresh and open-folder actions
- Summary strip shows configured path, file count, and zip-ready count
- Download rows prioritize file name, format, modified date, install/reinstall action, and delete action
- Download ordering should remain stable across navigation and library changes; Nexus archives should keep the chronology of when the user initiated each download request, not the order in which transfers happen to finish or related mods get installed/removed
- Nexus downloads must remain in Downloads with a persistent `NEW` badge until a successful install clears that state; finishing a download must not auto-install the mod
- When Nexus metadata is available, Downloads should surface the resolved file version so multiple staged versions are distinguishable before install
- Install/extract progress launched from Downloads should reuse the same active-row language as live downloads instead of falling back to a tiny button-only state
- Archive extraction is its own phase and should use a distinct cool accent from the default download/install yellow, while later install/finalization can return to the product accent
- When extracting from `.zip`, `.rar`, or `.7z`, show the current internal archive entry when available so the user can see what is being unpacked in real time
- If the user confirms `Replace` or `Install as Copy` from a duplicate-install prompt, dismiss the confirmation immediately and hand off to the shared install progress UI instead of keeping the dialog visible during extraction/install
- Downloads rows should support a right-click menu with reveal-in-Explorer, copy-path, install/reinstall, pause/resume/cancel, delete, and refresh-style utilities that match the row state
- In Downloads row context menus, `Install` or `Reinstall` should appear before file utilities such as reveal-in-Explorer or copy-path
- Revealing a download in Explorer should select the exact file the user clicked, not just open the parent folder
- If a Nexus archive already exists in Downloads, use the shared confirmation dialog instead of a toast-only rejection and preview the renamed duplicate archive before the user confirms
- If the same Nexus archive is already downloading, reuse that same duplicate-download confirmation dialog instead of blocking the request; make it clear that one transfer is already in progress and preview the next duplicate name
- Repeated `Download Again` requests for the same Nexus file should serialize behind the first request and still end in the shared duplicate-download confirmation flow; do not fall back to a warning snackbar/toast just because the first request is still spinning up
- If multiple Nexus versions of the same mod are downloaded, allow every archive to finish downloading and defer the decision to install time with a clear version-comparison prompt
- Archive installs must preserve real game-root folders such as `engine`, `r6`, `bin`, `archive`, and `red4ext`; never flatten those directories away during extraction, because their contents must deploy back into the game root with those prefixes intact
- The version-comparison prompt should use the cyber blue accent treatment and fit common desktop heights without introducing an internal scrollbar
- Downgrade states such as `Older Archive` should escalate with the error red token instead of blending into neutral or blue status chrome
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
- The hero area should summarize current readiness at a glance: Game Path, Mod Library, Downloads, and Nexus state
- Core directories section should mirror the Welcome screen visual system: unified dark card, path blocks in monospace, compact status badges, and the same primary/secondary button treatment
- Settings navigation should feel like an integrated extension panel: section tabs connected to the content surface rather than floating above it
- Settings should use a calmer, narrower reading width than Library/Downloads; avoid stretching form decisions across the full desktop when the content is fundamentally linear
- Tabs in Settings should read as a compact segmented strip, not as giant stacked menu blocks
- Settings section guides and accent lines should stay on the product yellow; do not switch section-guide color by tab context
- Inside each section, prefer a small number of large decision cards over many nested bordered boxes competing for attention
- In Settings, controls and follow-up actions should stay left-aligned within their card instead of jumping to the far right edge
- Avoid vague top-level status labels such as `Ready`; if status chrome is present, it should communicate a concrete state like `Valid Path`, `Configured`, `Connected`, or a version number
- Tiny overtracked labels in Settings should be avoided; section eyebrow text and helper labels must keep readable contrast and a stronger 13px+ presence
- Avoid nested scrolling inside Settings content when the main app surface already handles vertical scroll
- Support copy in Settings should use the shared readable small-text baseline instead of compressed microtype
- `Paths` should remain the primary section and emphasize consequence-aware states such as launch blocked or installs blocked when required targets are invalid
- Nexus subscription tone is semantic across the app: `Premium` uses the warm amber/gold treatment, while `Free` uses the cool info-blue treatment
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
