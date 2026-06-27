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
    'group inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-sm border-0 bg-[#fcee09] px-5 text-[10px] brand-font font-bold uppercase leading-none tracking-widest text-[#050505] shadow-[0_10px_22px_rgba(252,238,9,0.12)] transition-colors hover:bg-[#fff45c] active:bg-[#e7da08] disabled:cursor-not-allowed disabled:bg-[#1c1b07] disabled:text-[#6b6830] disabled:shadow-none disabled:hover:bg-[#1c1b07] [&_.material-symbols-outlined]:leading-none',
  secondary:
    'inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-sm border-0 bg-[#101010] px-4 text-[10px] brand-font font-bold uppercase leading-none tracking-widest text-[#a8a8a8] transition-colors hover:bg-[#1a1a1a] hover:text-white disabled:cursor-not-allowed disabled:bg-[#0b0b0b] disabled:text-[#555555] disabled:hover:bg-[#0b0b0b] disabled:hover:text-[#555555] [&_.material-symbols-outlined]:leading-none',
  accentOutline:
    'group inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-sm border-0 bg-[rgba(252,238,9,0.10)] px-4 text-[10px] brand-font font-bold uppercase leading-none tracking-widest text-[#d8d19a] transition-colors hover:bg-[#fcee09] hover:text-[#050505] disabled:cursor-not-allowed disabled:bg-[#131313] disabled:text-[#666666] disabled:hover:bg-[#131313] disabled:hover:text-[#666666] [&_.material-symbols-outlined]:text-current [&_.material-symbols-outlined]:leading-none [&_.material-symbols-outlined]:transition-colors',
  ghost:
    'group inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-sm border-0 bg-transparent px-3 text-[10px] brand-font font-bold uppercase leading-none tracking-widest text-[#777777] transition-colors hover:bg-[#101010] hover:text-white disabled:cursor-not-allowed disabled:text-[#4d4d4d] disabled:hover:bg-transparent [&_.material-symbols-outlined]:leading-none',
} as const

/* -- Icon tile -- */
export const IconTile: React.FC<{ icon: string; size?: 'sm' | 'md' }> = ({ icon, size = 'md' }) => {
  const isMd = size === 'md'
  return (
    <div
      className={`flex flex-shrink-0 items-center justify-center rounded-sm border-0 bg-[rgba(252,238,9,0.10)] ${
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
    className={`relative rounded-sm border-[0.5px] border-[#1a1a1a] bg-[#070707] px-5 py-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.03),0_6px_18px_rgba(0,0,0,0.24)] ${className}`}
    style={style}
  >
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
  good: 'bg-[rgba(52,211,153,0.13)] text-[#55e0ad]',
  warn: 'bg-[rgba(252,238,9,0.12)] text-[#fcee09]',
  info: 'bg-[rgba(96,165,250,0.13)] text-[#8dbdff]',
  error: 'bg-[rgba(248,113,113,0.14)] text-[#ff9b9b]',
  neutral: 'bg-[#151515] text-[#a0a0a0]',
}

export const StatusReadout: React.FC<{ tone: StatusTone; label: string; pulse?: boolean }> = ({
  tone,
  label,
  pulse,
}) => {
  const t = readoutTone[tone]
  return (
    <span
      className={`inline-flex h-7 items-center rounded-sm border-0 px-2.5 text-[10px] brand-font font-bold uppercase leading-none tracking-[0.16em] ${t} ${pulse ? 'animate-pulse' : ''}`}
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
    className={`allow-text-selection flex min-h-10 min-w-0 items-center rounded-sm border-[0.5px] px-4 py-3 font-mono text-[13px] leading-[1.35] text-[#e5e2e1] ${
      emphasize ? 'border-[#242424] bg-[#100f08]' : 'border-[#1a1a1a] bg-[#0a0a0a]'
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
