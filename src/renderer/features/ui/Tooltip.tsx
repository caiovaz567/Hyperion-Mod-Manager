import React from 'react'
import { Tooltip as HeroTooltip } from '@heroui/react'

type TooltipSide = 'top' | 'bottom'

interface TooltipProps {
  content: string | React.ReactNode
  children: React.ReactNode
  side?: TooltipSide
  wrapperClassName?: string
  contentClassName?: string
  /** 'help' allows a wider, multi-paragraph body; 'micro' is the compact default. */
  variant?: 'micro' | 'help'
}

// Thin wrapper over the real HeroUI Tooltip (React Aria) keeping the legacy
// `<Tooltip content=...>` call-site API. Copy uses Inter sentence-case at a readable
// size — no brand-font uppercase micro-labels.
export const Tooltip: React.FC<TooltipProps> = ({
  content,
  children,
  side = 'top',
  wrapperClassName,
  contentClassName,
  variant = 'micro',
}) => (
  <HeroTooltip delay={350} closeDelay={0}>
    {/* cursor-default so info-only trigger wrappers never show the pointer hand; a real
        button inside still gets the pointer from the global rule. */}
    <HeroTooltip.Trigger className={wrapperClassName ?? 'inline-flex cursor-default'}>
      {children}
    </HeroTooltip.Trigger>
    <HeroTooltip.Content
      placement={side}
      className={`z-[240] whitespace-pre-line text-[12px] font-medium leading-5 ${
        variant === 'help' ? 'max-w-[420px]' : 'max-w-[320px]'
      } ${contentClassName ?? ''}`}
    >
      {content}
    </HeroTooltip.Content>
  </HeroTooltip>
)
