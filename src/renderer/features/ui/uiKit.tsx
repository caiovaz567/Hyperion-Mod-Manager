import React from 'react'
import { translate } from '../../i18n/translate'
import { Icon } from './Icon'

/**
 * Shared controls for first-run and settings surfaces.
 *
 * Keep these close to Hyperion's operational chrome: dark panels, thin borders,
 * squared edges, compact type, and yellow as a signal color.
 */

/* -- Buttons -- */
// HeroUI-style button surfaces (rounded, Inter, sentence-case, accent-aware foreground).
// Kept as class strings so the many Settings/Welcome call sites stay unchanged; they read
// the same live accent/surface tokens as the real HeroUI <Button> components.
export const uiButton = {
  primary:
    'group inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-lg border-0 bg-[var(--accent)] px-5 text-[13px] font-semibold leading-none text-[var(--accent-foreground)] transition-colors hover:bg-[var(--accent-hover)] disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-[var(--accent)]',
  secondary:
    'inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-lg border-0 bg-[var(--surface-secondary)] px-4 text-[13px] font-medium leading-none text-[var(--text-secondary)] transition-colors hover:bg-[color-mix(in_srgb,var(--surface-secondary),white_7%)] hover:text-[var(--text-primary)] disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-[var(--surface-secondary)]',
  accentOutline:
    'group inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-lg border-0 bg-[rgb(var(--accent-rgb)/0.12)] px-4 text-[13px] font-semibold leading-none text-[var(--accent)] transition-colors hover:bg-[var(--accent)] hover:text-[var(--accent-foreground)] disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-[rgb(var(--accent-rgb)/0.12)] disabled:hover:text-[var(--accent)]',
  ghost:
    'group inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-lg border-0 bg-transparent px-3 text-[13px] font-medium leading-none text-[var(--text-muted)] transition-colors hover:bg-[var(--surface)] hover:text-[var(--text-primary)] disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent',
} as const

/* -- Underline tabs -- */
// THE one shared tab pattern across the app (Settings, App Logs, Mod Details), matching
// HeroUI's own docs navigation: icon + sentence-case label, muted when inactive, active tab
// in primary text with a rounded accent underline sitting on the divider line.
export interface UnderlineTabItem<T extends string> {
  id: T
  label: string
  icon?: string
  count?: number | string
}

export const UnderlineTabs = <T extends string,>({
  items,
  activeId,
  onChange,
  ariaLabel = 'Sections',
  className = '',
  withBorder = true,
}: {
  items: Array<UnderlineTabItem<T>>
  activeId: T
  onChange: (id: T) => void
  ariaLabel?: string
  className?: string
  /** Draw the divider line under the rail (turn off when the parent row already has one). */
  withBorder?: boolean
}) => (
  <div
    role="tablist"
    aria-label={ariaLabel}
    className={`flex items-center gap-1 ${withBorder ? 'border-b border-[var(--border)]' : ''} ${className}`}
  >
    {items.map((item) => {
      const active = activeId === item.id
      return (
        <button
          key={item.id}
          type="button"
          role="tab"
          aria-selected={active}
          onClick={() => onChange(item.id)}
          className={`relative -mb-px inline-flex items-center gap-2 px-3.5 py-2.5 text-[13.5px] font-medium transition-colors after:absolute after:inset-x-2 after:bottom-0 after:h-[2px] after:rounded-full after:transition-colors ${
            active
              ? 'text-[var(--text-primary)] after:bg-[var(--accent)]'
              : 'text-[var(--text-muted)] after:bg-transparent hover:text-[var(--text-primary)]'
          }`}
        >
          {item.icon ? <Icon name={item.icon} className="text-[17px] leading-none" aria-hidden="true" /> : null}
          <span>{item.label}</span>
          {item.count !== undefined ? (
            <span
              className={`inline-flex h-5 min-w-5 items-center justify-center rounded-md px-1.5 text-[11px] font-semibold tabular-nums ${
                active ? 'bg-[rgb(var(--accent-rgb)/0.16)] text-[var(--accent)]' : 'bg-[var(--surface)] text-[var(--text-muted)]'
              }`}
            >
              {item.count}
            </span>
          ) : null}
        </button>
      )
    })}
  </div>
)

/* -- Segmented tabs (secondary level) -- */
// The sub-level companion to UnderlineTabs: when a screen already has an underline rail
// (e.g. Mod Details), any tabs *inside* the active section use this compact HeroUI-style
// segmented pill instead, so two underline rails never stack on top of each other.
export const SegmentedTabs = <T extends string,>({
  items,
  activeId,
  onChange,
  ariaLabel = 'Filter',
  className = '',
}: {
  items: Array<UnderlineTabItem<T>>
  activeId: T
  onChange: (id: T) => void
  ariaLabel?: string
  className?: string
}) => (
  <div
    role="tablist"
    aria-label={ariaLabel}
    className={`inline-flex items-center gap-0.5 self-start rounded-lg bg-[var(--surface)] p-0.5 ${className}`}
  >
    {items.map((item) => {
      const active = activeId === item.id
      return (
        <button
          key={item.id}
          type="button"
          role="tab"
          aria-selected={active}
          onClick={() => onChange(item.id)}
          className={`inline-flex items-center gap-2 rounded-md px-3.5 py-1.5 text-[13px] font-medium transition-colors ${
            active
              ? 'bg-[var(--surface-secondary)] text-[var(--text-primary)]'
              : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
          }`}
        >
          {item.icon ? <Icon name={item.icon} className="text-[16px] leading-none" aria-hidden="true" /> : null}
          <span>{item.label}</span>
          {item.count !== undefined ? (
            <span
              className={`inline-flex h-5 min-w-5 items-center justify-center rounded-md px-1.5 text-[11px] font-semibold tabular-nums ${
                active ? 'bg-[rgb(var(--accent-rgb)/0.16)] text-[var(--accent)]' : 'bg-[var(--surface-secondary)] text-[var(--text-muted)]'
              }`}
            >
              {item.count}
            </span>
          ) : null}
        </button>
      )
    })}
  </div>
)

/* -- Icon tile -- */
export const IconTile: React.FC<{ icon: string; size?: 'sm' | 'md' }> = ({ icon, size = 'md' }) => {
  const isMd = size === 'md'
  return (
    <div
      className={`flex flex-shrink-0 items-center justify-center rounded-xl border-0 bg-[rgb(var(--accent-rgb)/0.12)] ${
        isMd ? 'h-10 w-10' : 'h-8 w-8'
      }`}
    >
      <Icon name={icon} className="text-[var(--accent)]" style={{ fontSize: isMd ? 21 : 17 }} />
    </div>
  )
}

/* -- Setting card -- */
// One HeroUI-style card per setting: header row (icon tile + title/description, with the
// compact control or status readout on the right), and any richer content below, aligned
// under the title. Cards stack vertically on the darker page background so they lift
// without borders competing for attention — no side-by-side explanation column.
export const SettingCard: React.FC<{
  icon: string
  title: string
  description?: string
  headerRight?: React.ReactNode
  className?: string
  style?: React.CSSProperties
  children?: React.ReactNode
}> = ({ icon, title, description, headerRight, className = '', style, children }) => (
  <section
    className={`rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5 ${className}`}
    style={style}
  >
    <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3 sm:flex-nowrap">
      <div className="flex min-w-0 items-start gap-3.5">
        <IconTile icon={icon} />
        <div className="min-w-0 pt-0.5 text-left">
          <h3 className="text-[1rem] font-semibold tracking-[-0.01em] text-[var(--text-primary)]">{title}</h3>
          {description ? <p className="mt-1 max-w-[560px] text-[13.5px] leading-6 text-[var(--text-support)]">{description}</p> : null}
        </div>
      </div>
      {headerRight ? <div className="flex shrink-0 items-center pt-1">{headerRight}</div> : null}
    </div>
    {children ? <div className="mt-4 sm:pl-[54px]">{children}</div> : null}
  </section>
)

/* -- Status readout -- */
export type StatusTone = 'good' | 'warn' | 'info' | 'error' | 'neutral'

const readoutTone: Record<StatusTone, string> = {
  good: 'bg-[rgba(52,211,153,0.13)] text-[var(--status-success-text)]',
  warn: 'bg-[rgba(252,238,9,0.12)] text-[var(--status-warning-text)]',
  info: 'bg-[rgba(96,165,250,0.13)] text-[var(--status-info-text)]',
  error: 'bg-[rgba(248,113,113,0.14)] text-[var(--status-error-text)]',
  neutral: 'bg-[var(--surface-secondary)] text-[var(--text-secondary)]',
}

export const StatusReadout: React.FC<{ tone: StatusTone; label: string; pulse?: boolean }> = ({
  tone,
  label,
  pulse,
}) => {
  const t = readoutTone[tone]
  return (
    <span
      className={`inline-flex h-7 items-center rounded-md border-0 px-2.5 text-[10px] brand-font font-bold uppercase leading-none tracking-[0.16em] ${t} ${pulse ? 'animate-pulse' : ''}`}
    >
      {label}
    </span>
  )
}

/* -- Path display box -- */
export const PathBox: React.FC<{ value: string; placeholder: string; emphasize?: boolean }> = ({
  value,
  placeholder,
  emphasize = false,
}) => (
  <div
    className={`allow-text-selection flex min-h-10 min-w-0 items-center rounded-lg border-0 px-4 py-3 font-mono text-[13px] leading-[1.35] text-[var(--text-primary-alt)] ${
      emphasize ? 'bg-[rgb(var(--accent-rgb)/0.06)] shadow-[inset_0_0_0_1px_var(--accent-dim)]' : 'bg-[var(--surface-secondary)]'
    }`}
  >
    <div className="break-all">{value || <span className="text-[var(--text-muted)]">{placeholder}</span>}</div>
  </div>
)

/* -- Inline validation row -- */
export const ValidationRow: React.FC<{
  state: 'valid' | 'invalid' | 'info' | 'empty'
  validText?: string
  invalidText?: string
  infoText?: string
  emptyText?: string
}> = ({ state, validText, invalidText, infoText, emptyText }) => {
  const emptyLabel = emptyText ?? translate('common.noFolderSelected')
  if (state === 'valid') {
    return (
      <div className="mt-3 flex items-start gap-2 text-[13px] leading-5">
        <Icon name="check_circle" className="mt-[1px] text-[#34d399]" style={{ fontSize: 17 }} />
        <span className="text-[var(--status-success-text)]">{validText}</span>
      </div>
    )
  }
  if (state === 'invalid') {
    return (
      <div className="mt-3 flex items-start gap-2 text-[13px] leading-5">
        <Icon name="error" className="mt-[1px] text-[var(--status-warning-text)]" style={{ fontSize: 17 }} />
        <span className="text-[var(--status-warning-text)]">{invalidText}</span>
      </div>
    )
  }
  if (state === 'info') {
    return (
      <div className="mt-3 flex items-start gap-2 text-[13px] leading-5">
        <Icon name="info" className="mt-[1px] text-[var(--text-muted)]" style={{ fontSize: 17 }} />
        <span className="text-[var(--text-support)]">{infoText}</span>
      </div>
    )
  }
  return (
    <div className="mt-3 flex items-start gap-2 text-[13px] leading-5">
      <Icon name="radio_button_unchecked" className="mt-[1px] text-[var(--text-muted)]" style={{ fontSize: 17 }} />
      <span className="text-[var(--text-muted)]">{emptyLabel}</span>
    </div>
  )
}
