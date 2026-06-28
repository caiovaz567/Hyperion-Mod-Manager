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
  'inline-flex shrink-0 items-center justify-center whitespace-nowrap rounded-sm border-0 brand-font font-bold uppercase tracking-widest transition-colors disabled:cursor-not-allowed disabled:opacity-45'

const buttonSizeClass: Record<HyperionButtonSize, string> = {
  md: 'h-10 gap-2 px-4 text-[10px]',
  sm: 'h-10 gap-1.5 px-4 text-[9px]',
  icon: 'h-10 w-10 gap-0 px-0 text-[10px]',
}

const buttonVariantClass: Record<HyperionButtonVariant, string> = {
  primary:
    'bg-[#fcee09] text-[#050505] shadow-[0_0_20px_rgba(252,238,9,0.15)] hover:bg-white disabled:bg-[#1c1b07] disabled:text-[#6b6830] disabled:shadow-none disabled:hover:bg-[#1c1b07]',
  toolbar:
    'group bg-[rgba(252,238,9,0.10)] text-[#d8d19a] hover:bg-[#fcee09] hover:text-[#050505] disabled:bg-[#131313] disabled:text-[#666666] disabled:hover:bg-[#131313] disabled:hover:text-[#666666]',
  danger:
    'bg-[rgba(248,113,113,0.13)] text-[#ff9b9b] hover:bg-[#f87171] hover:text-[#190505] disabled:bg-[#0d0404] disabled:text-[#7c4a4a] disabled:hover:bg-[#0d0404] disabled:hover:text-[#7c4a4a]',
  ghost:
    'bg-[#101010] text-[#8a8a8a] hover:bg-[#1a1a1a] hover:text-white disabled:bg-[#0a0a0a] disabled:text-[#555555]',
  cyan:
    'bg-[rgba(79,216,255,0.12)] text-[#7fe6ff] hover:bg-[#4fd8ff] hover:text-[#051017] disabled:bg-[#071014] disabled:text-[#426b76]',
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
        <span
          className={cx(
            'material-symbols-outlined text-[16px] text-current transition-colors',
            iconClassName
          )}
          aria-hidden="true"
        >
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
  onClear?: () => void
}

export const HyperionSearchField: React.FC<HyperionSearchFieldProps> = ({
  wrapperClassName,
  inputClassName,
  className,
  onClear,
  ...props
}) => {
  const hasValue = Boolean(props.value)
  return (
    <div className={cx('group relative min-w-[300px] flex-1 max-w-[460px]', wrapperClassName)}>
      <span className="material-symbols-outlined pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[18px] text-[#777] transition-colors group-hover:text-[#d0d0d0] group-focus-within:text-[#fcee09]">
        search
      </span>
      <input
        {...props}
        type="text"
        className={cx(
          'h-10 w-full rounded-sm border-0 bg-[#101010] py-1.5 pl-10 text-sm text-[#e5e2e1] outline-none shadow-[inset_0_0_0_1px_rgba(255,255,255,0.06)] placeholder-[#6f6f6f] transition-[background-color,box-shadow,color] hover:bg-[#141414] hover:text-[#f0f0f0] hover:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.10)] focus:bg-[#121212] focus:shadow-[inset_0_0_0_1px_rgba(252,238,9,0.16)]',
          hasValue ? 'pr-8' : 'pr-4',
          inputClassName,
          className
        )}
      />
      {hasValue && onClear ? (
        <button
          type="button"
          onClick={onClear}
          tabIndex={-1}
          className="absolute right-2.5 top-1/2 -translate-y-1/2 flex h-5 w-5 items-center justify-center rounded-sm text-[#555] transition-colors hover:text-[#e5e2e1]"
          aria-label="Clear search"
        >
          <span className="material-symbols-outlined text-[16px] leading-none">close</span>
        </button>
      ) : null}
    </div>
  )
}

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
  accent: 'bg-[rgba(252,238,9,0.12)] text-[#fcee09]',
  neutral: 'bg-[#151515] text-[#a0a0a0]',
  success: 'bg-[rgba(52,211,153,0.13)] text-[#55e0ad]',
  warning: 'bg-[rgba(252,238,9,0.12)] text-[#fcee09]',
  danger: 'bg-[rgba(248,113,113,0.14)] text-[#ff9b9b]',
  cyan: 'bg-[rgba(79,216,255,0.13)] text-[#7fe6ff]',
}

export const HyperionBadge: React.FC<HyperionBadgeProps> = ({ tone = 'neutral', className, ...props }) => (
  <span
    className={cx(
      'inline-flex h-6 items-center rounded-sm border-0 px-2.5 text-[10px] brand-font font-bold uppercase tracking-[0.16em]',
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
          'min-w-0 truncate whitespace-nowrap text-sm uppercase tracking-widest brand-font font-bold',
          active ? 'text-[#fcee09]' : 'text-[#9d9d9d] hover:text-[#fcee09]'
        )}>
          {label}
        </span>
        <span
          className={cx(
            'material-symbols-outlined shrink-0 text-[8px] leading-none',
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
