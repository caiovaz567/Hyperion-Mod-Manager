import React from 'react'

/**
 * Shared controls for first-run and settings surfaces.
 *
 * Keep these close to Hyperion's operational chrome: dark panels, thin borders,
 * squared edges, compact type, and yellow as a signal color.
 */

/* -- Buttons -- */
export const uiButton = {
  primary:
    'group inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-sm border-[0.5px] border-transparent bg-[#fcee09] px-5 text-[10px] brand-font font-bold uppercase tracking-widest text-[#050505] shadow-[0_0_20px_rgba(252,238,9,0.14)] transition-colors hover:bg-white active:bg-[#e7da08] disabled:cursor-not-allowed disabled:bg-[#1c1b07] disabled:text-[#6b6830] disabled:shadow-none disabled:hover:bg-[#1c1b07]',
  secondary:
    'inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-sm border-[0.5px] border-[#242424] bg-[#0a0a0a] px-4 text-[10px] brand-font font-bold uppercase tracking-widest text-[#9a9a9a] transition-colors hover:border-[#5d5d5d] hover:text-white disabled:cursor-not-allowed disabled:border-[#1a1a1a] disabled:text-[#555555] disabled:hover:border-[#1a1a1a] disabled:hover:text-[#555555]',
  accentOutline:
    'group inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-sm border-[0.5px] border-[#fcee09]/50 bg-[#0a0a0a] px-4 text-[10px] brand-font font-bold uppercase tracking-widest text-[#cccccc] transition-colors hover:bg-[#fcee09] hover:text-[#050505] [&_.material-symbols-outlined]:!text-[#fcee09] hover:[&_.material-symbols-outlined]:!text-[#050505] disabled:cursor-not-allowed disabled:border-[#303030] disabled:text-[#666666] disabled:hover:bg-[#0a0a0a] disabled:hover:text-[#666666]',
  ghost:
    'group inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-sm border-[0.5px] border-transparent bg-transparent px-3 text-[10px] brand-font font-bold uppercase tracking-widest text-[#777777] transition-colors hover:border-[#2a2a2a] hover:bg-[#0a0a0a] hover:text-white disabled:cursor-not-allowed disabled:text-[#4d4d4d] disabled:hover:border-transparent disabled:hover:bg-transparent',
} as const

/* -- Icon tile -- */
export const IconTile: React.FC<{ icon: string; size?: 'sm' | 'md' }> = ({ icon, size = 'md' }) => {
  const isMd = size === 'md'
  return (
    <div
      className={`flex flex-shrink-0 items-center justify-center rounded-sm border-[0.5px] border-[#3d3708] bg-[#090804] ${
        isMd ? 'h-10 w-10' : 'h-8 w-8'
      }`}
    >
      <span className="material-symbols-outlined text-[#fcee09]" style={{ fontSize: isMd ? 21 : 17 }}>
        {icon}
      </span>
    </div>
  )
}

/* -- Setting card -- */
export const SettingCard: React.FC<{
  icon: string
  title: string
  description?: string
  headerRight?: React.ReactNode
  className?: string
  style?: React.CSSProperties
  children: React.ReactNode
}> = ({ icon, title, description, headerRight, className = '', style, children }) => (
  <div
    className={`relative overflow-hidden rounded-sm border-[0.5px] border-[#1a1a1a] bg-[#070707] px-5 py-5 shadow-[0_6px_18px_rgba(0,0,0,0.24)] ${className}`}
    style={style}
  >
    <span className="absolute inset-x-0 top-0 h-px bg-[#fcee09]/35" />
    <div className="flex items-start gap-3">
      <IconTile icon={icon} size="sm" />
      <div className="min-w-0 flex-1 text-left">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="brand-font text-[0.95rem] font-bold uppercase tracking-[0.12em] text-white">{title}</h3>
          {headerRight ? <div className="shrink-0">{headerRight}</div> : null}
        </div>
        {description ? <p className="mt-2 text-[14px] leading-[1.55] text-[#b8b8b8]">{description}</p> : null}
      </div>
    </div>
    <div className="mt-4">{children}</div>
  </div>
)

/* -- Status readout -- */
export type StatusTone = 'good' | 'warn' | 'info' | 'error' | 'neutral'

const readoutTone: Record<StatusTone, string> = {
  good: 'border-[#1d3d2e] bg-[#07100c] text-[#34d399]',
  warn: 'border-[#5e5514] bg-[#100f06] text-[#fcee09]',
  info: 'border-[#1e3a5f] bg-[#07101a] text-[#60a5fa]',
  error: 'border-[#5a2020] bg-[#140707] text-[#f87171]',
  neutral: 'border-[#2a2a2a] bg-[#090909] text-[#a0a0a0]',
}

export const StatusReadout: React.FC<{ tone: StatusTone; label: string; pulse?: boolean }> = ({
  tone,
  label,
  pulse,
}) => {
  const t = readoutTone[tone]
  return (
    <span
      className={`inline-flex h-7 items-center rounded-sm border-[0.5px] px-2.5 text-[10px] brand-font font-bold uppercase leading-none tracking-[0.16em] ${t} ${pulse ? 'animate-pulse' : ''}`}
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
    className={`allow-text-selection flex min-h-10 min-w-0 items-center rounded-sm border-[0.5px] bg-[#0a0a0a] px-4 py-3 font-mono text-[13px] leading-[1.35] text-[#e5e2e1] ${
      emphasize ? 'border-[#6a5a10]' : 'border-[#1a1a1a]'
    }`}
  >
    <div className="break-all">{value || <span className="text-[#6b6b6b]">{placeholder}</span>}</div>
  </div>
)

/* -- Inline validation row -- */
export const ValidationRow: React.FC<{
  state: 'valid' | 'invalid' | 'info' | 'empty'
  validText?: string
  invalidText?: string
  infoText?: string
  emptyText?: string
}> = ({ state, validText, invalidText, infoText, emptyText = 'No folder selected yet' }) => {
  if (state === 'valid') {
    return (
      <div className="mt-3 flex items-start gap-2 text-[13px] leading-5">
        <span className="material-symbols-outlined mt-[1px] text-[#34d399]" style={{ fontSize: 17 }}>
          check_circle
        </span>
        <span className="text-[#7fd6ad]">{validText}</span>
      </div>
    )
  }
  if (state === 'invalid') {
    return (
      <div className="mt-3 flex items-start gap-2 text-[13px] leading-5">
        <span className="material-symbols-outlined mt-[1px] text-[#fcee09]" style={{ fontSize: 17 }}>
          error
        </span>
        <span className="text-[#d8ca7b]">{invalidText}</span>
      </div>
    )
  }
  if (state === 'info') {
    return (
      <div className="mt-3 flex items-start gap-2 text-[13px] leading-5">
        <span className="material-symbols-outlined mt-[1px] text-[#7a7a7a]" style={{ fontSize: 17 }}>
          info
        </span>
        <span className="text-[#9a9a9a]">{infoText}</span>
      </div>
    )
  }
  return (
    <div className="mt-3 flex items-start gap-2 text-[13px] leading-5">
      <span className="material-symbols-outlined mt-[1px] text-[#5f5f5f]" style={{ fontSize: 17 }}>
        radio_button_unchecked
      </span>
      <span className="text-[#777777]">{emptyText}</span>
    </div>
  )
}
