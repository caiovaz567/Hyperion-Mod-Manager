import React from 'react'
import { Tooltip } from './Tooltip'

type ClassValue = string | false | null | undefined

export function cx(...values: ClassValue[]): string {
  return values.filter(Boolean).join(' ')
}

type HyperionButtonVariant = 'primary' | 'toolbar' | 'danger' | 'ghost' | 'cyan'
type HyperionButtonSize = 'md' | 'sm' | 'icon'

interface HyperionButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: HyperionButtonVariant
  size?: HyperionButtonSize
  icon?: string
  iconClassName?: string
}

const buttonBaseClass =
  'inline-flex shrink-0 items-center justify-center whitespace-nowrap rounded-sm border-[0.5px] brand-font font-bold uppercase tracking-widest transition-colors disabled:cursor-not-allowed disabled:opacity-45'

const buttonSizeClass: Record<HyperionButtonSize, string> = {
  md: 'h-10 gap-2 px-4 text-[10px]',
  sm: 'h-10 gap-1.5 px-4 text-[9px]',
  icon: 'h-10 w-10 gap-0 px-0 text-[10px]',
}

const buttonVariantClass: Record<HyperionButtonVariant, string> = {
  primary:
    'border-transparent bg-[#fcee09] text-[#050505] shadow-[0_0_20px_rgba(252,238,9,0.15)] hover:bg-white disabled:bg-[#1c1b07] disabled:text-[#6b6830] disabled:hover:bg-[#1c1b07]',
  toolbar:
    'group border-[#fcee09]/50 bg-[#0a0a0a] text-[#cccccc] hover:bg-[#fcee09] hover:text-[#050505] [&_.material-symbols-outlined]:!text-[#fcee09] [&_.material-symbols-outlined]:transition-colors hover:[&_.material-symbols-outlined]:!text-[#050505] disabled:border-[#303030] disabled:bg-[#131313] disabled:text-[#666666] disabled:hover:bg-[#131313] disabled:hover:text-[#666666]',
  danger:
    'border-[#5b1818] bg-[#160707] text-[#f18d8d] hover:border-[#f87171] hover:bg-[#2a0909] hover:text-[#ffe1e1] disabled:border-[#3a1010] disabled:bg-[#0d0404] disabled:text-[#7c4a4a] disabled:hover:border-[#3a1010] disabled:hover:bg-[#0d0404] disabled:hover:text-[#7c4a4a]',
  ghost:
    'border-[#242424] bg-[#0b0b0b] text-[#8a8a8a] hover:border-[#5d5d5d] hover:text-white disabled:border-[#1a1a1a] disabled:bg-[#0a0a0a] disabled:text-[#555555]',
  cyan:
    'border-[#4fd8ff]/30 bg-[#081118] text-[#4fd8ff] hover:border-[#4fd8ff] hover:bg-[#0c1a24] hover:text-white disabled:border-[#1b333b] disabled:bg-[#071014] disabled:text-[#426b76]',
}

export const HyperionButton = React.forwardRef<HTMLButtonElement, HyperionButtonProps>(
  ({ variant = 'toolbar', size = 'md', icon, iconClassName, className, children, type = 'button', ...props }, ref) => (
    <button
      ref={ref}
      type={type}
      className={cx(buttonBaseClass, buttonSizeClass[size], buttonVariantClass[variant], className)}
      {...props}
    >
      {icon ? (
        <span className={cx('material-symbols-outlined text-[16px]', iconClassName)} aria-hidden="true">
          {icon}
        </span>
      ) : null}
      {children}
    </button>
  )
)

HyperionButton.displayName = 'HyperionButton'

interface HyperionIconButtonProps extends Omit<HyperionButtonProps, 'children' | 'size' | 'icon'> {
  icon: string
  label: string
  tooltip?: string
}

export const HyperionIconButton: React.FC<HyperionIconButtonProps> = ({
  icon,
  label,
  tooltip,
  variant = 'toolbar',
  iconClassName,
  ...props
}) => {
  const button = (
    <HyperionButton
      {...props}
      variant={variant}
      size="icon"
      icon={icon}
      iconClassName={cx('text-[18px]', iconClassName)}
      aria-label={label}
    />
  )

  return tooltip ? <Tooltip content={tooltip}>{button}</Tooltip> : button
}

interface HyperionSearchFieldProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type'> {
  wrapperClassName?: string
  inputClassName?: string
}

export const HyperionSearchField: React.FC<HyperionSearchFieldProps> = ({
  wrapperClassName,
  inputClassName,
  className,
  ...props
}) => (
  <div className={cx('group relative min-w-[300px] flex-1 max-w-[460px]', wrapperClassName)}>
    <span className="material-symbols-outlined pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[18px] text-[#6a6a6a] transition-colors group-hover:text-[#e8e8e8] group-focus-within:text-[#fcee09]">
      search
    </span>
    <input
      {...props}
      type="text"
      className={cx(
        'h-10 w-full rounded-sm border-[0.5px] border-[#fcee09]/50 bg-[#0a0a0a] py-1.5 pl-10 pr-4 text-sm text-[#e5e2e1] placeholder-[#6f6f6f] transition-all hover:border-[#fcee09]/70 hover:text-[#e8e8e8] focus:border-[#fcee09]/65 focus:outline-none focus:shadow-[0_0_14px_rgba(252,238,9,0.08)]',
        inputClassName,
        className
      )}
    />
  </div>
)

interface HyperionPanelProps extends React.HTMLAttributes<HTMLDivElement> {
  tone?: 'base' | 'elevated'
}

export const HyperionPanel = React.forwardRef<HTMLDivElement, HyperionPanelProps>(
  ({ tone = 'base', className, ...props }, ref) => (
    <div
      ref={ref}
      className={cx(
        'rounded-sm border-[0.5px] border-[#1a1a1a] shadow-[0_6px_18px_rgba(0,0,0,0.24)]',
        tone === 'base' ? 'bg-[#050505]' : 'bg-[#070707]',
        className
      )}
      {...props}
    />
  )
)

HyperionPanel.displayName = 'HyperionPanel'

type HyperionBadgeTone = 'accent' | 'neutral' | 'success' | 'warning' | 'danger' | 'cyan'

interface HyperionBadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  tone?: HyperionBadgeTone
}

const badgeToneClass: Record<HyperionBadgeTone, string> = {
  accent: 'border-[#2d2a10] bg-[#090804] text-[#fcee09]',
  neutral: 'border-[#2a2a2a] bg-[#111111] text-[#8a8a8a]',
  success: 'border-[#1d3d2e] bg-[#091410] text-[#34d399]',
  warning: 'border-[#7e6d12] bg-[#0d0b00] text-[#fcee09]',
  danger: 'border-[#5a2020] bg-[rgba(248,113,113,0.1)] text-[#f87171]',
  cyan: 'border-[#1e3a5f] bg-[#071524] text-[#60a5fa]',
}

export const HyperionBadge: React.FC<HyperionBadgeProps> = ({ tone = 'neutral', className, ...props }) => (
  <span
    className={cx(
      'inline-flex h-6 items-center rounded-sm border-[0.5px] px-2.5 text-[10px] brand-font font-bold uppercase tracking-[0.16em]',
      badgeToneClass[tone],
      className
    )}
    {...props}
  />
)

interface HyperionSortHeaderProps<TSortKey extends string> {
  columnKey: TSortKey
  label: string
  sortKey: TSortKey | null
  sortDirection: 'asc' | 'desc'
  onSort: (key: TSortKey) => void
  ariaLabel: string
  className?: string
  innerClassName?: string
}

export function HyperionSortHeader<TSortKey extends string>({
  columnKey,
  label,
  sortKey,
  sortDirection,
  onSort,
  ariaLabel,
  className,
  innerClassName,
}: HyperionSortHeaderProps<TSortKey>) {
  const active = sortKey === columnKey
  const directionLabel = sortDirection === 'asc' ? 'ascending' : 'descending'

  return (
    <button
      type="button"
      onClick={() => onSort(columnKey)}
      aria-sort={active ? directionLabel : 'none'}
      aria-label={`${ariaLabel}${active ? `, currently ${directionLabel}` : ''}`}
      className={cx('flex h-8 w-full items-center text-left', className)}
    >
      <div className={cx('flex min-w-0 items-center gap-2', innerClassName)}>
        <span className={cx(
          'text-sm uppercase tracking-widest brand-font font-bold',
          active ? 'text-[#fcee09]' : 'text-[#9d9d9d] hover:text-[#fcee09]'
        )}>
          {label}
        </span>
        <span
          className={cx(
            'material-symbols-outlined text-[8px] leading-none',
            active ? 'text-[#fcee09]' : 'text-[#727272]'
          )}
          aria-hidden="true"
        >
          {active ? (sortDirection === 'asc' ? 'arrow_upward' : 'arrow_downward') : 'unfold_more'}
        </span>
      </div>
    </button>
  )
}
