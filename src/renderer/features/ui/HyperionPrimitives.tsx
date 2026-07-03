import React from 'react'
import { createPortal } from 'react-dom'
import { Button, Chip, Input, Switch } from '@heroui/react'
import { Tooltip } from './Tooltip'
import { translate } from '../../i18n/translate'
import { Icon } from './Icon'

type ClassValue = string | false | null | undefined

export function cx(...values: ClassValue[]): string {
  return values.filter(Boolean).join(' ')
}

// Hyperion's semantic button variants, mapped onto HeroUI v3's real <Button> variants.
// Keeping these names means every existing call site (variant="toolbar"|"cyan"|…) keeps
// working while now rendering a genuine HeroUI (React Aria) button underneath.
type HyperionButtonVariant = 'primary' | 'toolbar' | 'danger' | 'ghost' | 'cyan'
type HyperionButtonSize = 'md' | 'sm' | 'icon'

type HeroButtonVariant = 'primary' | 'secondary' | 'tertiary' | 'outline' | 'ghost' | 'danger' | 'danger-soft'

const heroVariantMap: Record<HyperionButtonVariant, HeroButtonVariant> = {
  primary: 'primary',      // solid accent (blue) — main CTA
  toolbar: 'secondary',    // clearly-defined neutral surface (HeroUI-style), not a faint one
  cyan: 'secondary',       // legacy "cyan" now folds into the neutral surface action
  danger: 'danger-soft',   // red-tinted destructive
  ghost: 'ghost',
}

const heroSizeMap: Record<HyperionButtonSize, 'sm' | 'md' | 'lg'> = {
  md: 'md',
  sm: 'sm',
  icon: 'md',
}

interface HyperionButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: HyperionButtonVariant
  size?: HyperionButtonSize
  icon?: string
  iconClassName?: string
}

export const HyperionButton = React.forwardRef<HTMLButtonElement, HyperionButtonProps>(
  ({ variant = 'toolbar', size = 'md', icon, iconClassName, className, children, type = 'button', disabled, onClick, ...props }, ref) => (
    <Button
      ref={ref}
      type={type}
      variant={heroVariantMap[variant]}
      size={heroSizeMap[size]}
      isIconOnly={size === 'icon'}
      isDisabled={disabled}
      // HeroUI/React Aria buttons fire on "press" (pointer + keyboard). Existing call sites
      // pass onClick and almost always ignore the event, so we bridge it to onPress.
      onPress={onClick ? (() => (onClick as unknown as () => void)()) : undefined}
      // Pin md/icon buttons to 40px so they always match the h-10 search fields beside them
      // (HeroUI's default md height renders shorter and made toolbars look uneven).
      className={cx('font-semibold', size === 'md' && 'h-10', size === 'icon' && 'h-10 w-10', className)}
      {...(props as Record<string, never>)}
    >
      {icon ? (
        <Icon name={icon} className={cx('text-[18px] text-current', iconClassName)} />
      ) : null}
      {children}
    </Button>
  )
)

HyperionButton.displayName = 'HyperionButton'

// HeroUI v3's <Switch> is compositional (Root > Content > Control > Thumb). This wrapper
// encapsulates that boilerplate into the small icon-only toggle Hyperion uses in rows,
// settings, etc. Controlled via isSelected/onChange (onChange gives the new boolean).
interface HyperionSwitchProps {
  isSelected?: boolean
  onChange?: (selected: boolean) => void
  size?: 'sm' | 'md' | 'lg'
  isDisabled?: boolean
  className?: string
  'aria-label'?: string
}

export const HyperionSwitch: React.FC<HyperionSwitchProps> = ({ size = 'md', className, ...props }) => (
  <Switch size={size} className={className} {...props}>
    <Switch.Content>
      <Switch.Control>
        <Switch.Thumb />
      </Switch.Control>
    </Switch.Content>
  </Switch>
)

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

export const HyperionSearchField = React.forwardRef<HTMLInputElement, HyperionSearchFieldProps>(({
  wrapperClassName,
  inputClassName,
  className,
  onClear,
  ...props
}, ref) => {
  const hasValue = Boolean(props.value)
  return (
    <div className={cx('group relative', wrapperClassName ?? 'min-w-[300px] flex-1 max-w-[460px]')}>
      <Icon name="search" className="pointer-events-none absolute left-3 top-1/2 z-10 -translate-y-1/2 text-[18px] text-[var(--muted,#777)] transition-colors group-focus-within:text-[var(--accent)]" />
      <Input
        {...props}
        ref={ref}
        type="text"
        className={cx('h-10 w-full pl-10', hasValue ? 'pr-9' : 'pr-4', inputClassName, className)}
      />
      {hasValue && onClear ? (
        <button
          type="button"
          onClick={onClear}
          tabIndex={-1}
          className="absolute right-2.5 top-1/2 z-10 -translate-y-1/2 flex h-5 w-5 items-center justify-center rounded-full text-[var(--muted,#777)] transition-colors hover:text-[var(--foreground,#f0f0f0)]"
          aria-label={translate('common.clearSearch')}
        >
          <Icon name="close" className="text-[16px] leading-none" />
        </button>
      ) : null}
    </div>
  )
})

HyperionSearchField.displayName = 'HyperionSearchField'

interface HyperionPanelProps extends React.HTMLAttributes<HTMLDivElement> {
  tone?: 'base' | 'elevated'
}

export const HyperionPanel = React.forwardRef<HTMLDivElement, HyperionPanelProps>(
  ({ tone = 'base', className, ...props }, ref) => (
    <div
      ref={ref}
      className={cx(
        // Elevated card floating on the app canvas — HeroUI tokens so it follows
        // light/dark mode instead of a fixed charcoal. No drop shadow: the border +
        // surface contrast carry the elevation.
        'rounded-2xl border border-[var(--border)]',
        tone === 'base' ? 'bg-[var(--overlay)]' : 'bg-[var(--background)]',
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
  size?: 'sm' | 'md' | 'lg'
}

// Hyperion badge tones mapped onto HeroUI v3's real <Chip> (soft variant). HeroUI has no
// "cyan" chip color, so the legacy cyan tone folds into the accent color.
const badgeChipColor: Record<HyperionBadgeTone, 'accent' | 'default' | 'success' | 'warning' | 'danger'> = {
  accent: 'accent',
  neutral: 'default',
  success: 'success',
  warning: 'warning',
  danger: 'danger',
  cyan: 'accent',
}

// Purely informational tag — soft pill, never button-like. Default size is md so info
// chips stay comfortably readable (sm reads too small next to 13-14px body text).
export const HyperionBadge: React.FC<HyperionBadgeProps> = ({ tone = 'neutral', size = 'md', className, children, ...props }) => (
  <Chip
    color={badgeChipColor[tone]}
    variant="soft"
    size={size}
    className={cx('cursor-default font-semibold uppercase tracking-[0.08em]', className)}
    {...(props as Record<string, never>)}
  >
    {children}
  </Chip>
)

// Shared HeroUI-styled modal shell. Renders a dark surface (bg-[var(--background)], darker than
// the --surface cards inside so they lift off it without borders), soft border, big rounding,
// while keeping the proven portal + backdrop-mousedown + Escape dismissal behavior the dialogs relied
// on. Individual dialogs still own their inner content, focus management, and Enter handling.
interface HyperionModalProps {
  onClose: () => void
  children: React.ReactNode
  /** Sizing + any extra classes applied to the dialog surface. */
  surfaceClassName?: string
  /** Backdrop click / Escape close (default true). */
  dismissable?: boolean
  /** Stacking z-index utility class (default z-[210]). */
  zIndexClassName?: string
  'aria-label'?: string
  'aria-labelledby'?: string
}

export const HyperionModal: React.FC<HyperionModalProps> = ({
  onClose,
  children,
  surfaceClassName,
  dismissable = true,
  zIndexClassName = 'z-[210]',
  ...aria
}) => {
  const backdropMouseDownRef = React.useRef(false)

  React.useEffect(() => {
    if (!dismissable) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, dismissable])

  return createPortal(
    <div
      data-action-prompt="true"
      className={cx(
        'fixed inset-0 flex items-center justify-center bg-black/70 px-4 backdrop-blur-sm animate-[fade-in_0.15s_ease-out]',
        zIndexClassName
      )}
      onMouseDown={(event) => {
        backdropMouseDownRef.current = event.target === event.currentTarget
      }}
      onClick={(event) => {
        event.stopPropagation()
        if (dismissable && backdropMouseDownRef.current) onClose()
        backdropMouseDownRef.current = false
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        {...aria}
        className={cx(
          // Dark modal shell (--background is darker than --surface, so inner --surface/
          // --surface-secondary cards lift off it cleanly without needing borders).
          'relative w-full overflow-hidden rounded-2xl border border-[var(--border-strong)] bg-[var(--background)] text-[var(--text-primary)]',
          surfaceClassName
        )}
        onClick={(event) => event.stopPropagation()}
      >
        {children}
      </div>
    </div>,
    document.body
  )
}

// Compact header row used across dialogs: an accent icon chip + title. Keeps the softer,
// non-industrial HeroUI voice (sentence-cased title, no heavy uppercase tracking).
interface HyperionModalHeaderProps {
  icon: string
  title: string
  className?: string
}

export const HyperionModalHeader: React.FC<HyperionModalHeaderProps> = ({ icon, title, className }) => (
  <div className={cx('flex items-center gap-3', className)}>
    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[rgb(var(--accent-rgb)/0.14)] text-[var(--accent)]">
      <Icon name={icon} className="text-[20px]" />
    </span>
    <h2 className="text-[1.05rem] font-semibold tracking-[-0.01em] text-[var(--text-primary)]">{title}</h2>
  </div>
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
          'min-w-0 truncate whitespace-nowrap text-[11px] uppercase tracking-[0.07em] font-medium',
          active ? 'text-[var(--accent)]' : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
        )}>
          {label}
        </span>
        <Icon
          name={active ? (sortDirection === 'asc' ? 'arrow_upward' : 'arrow_downward') : 'unfold_more'}
          className={cx(
            'shrink-0 text-[13px] leading-none',
            active ? 'text-[var(--accent)]' : 'text-[var(--text-muted)]'
          )}
        />
      </div>
    </button>
  )
}
