import React, { useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

type TooltipSide = 'top' | 'bottom'

interface TooltipProps {
  content: string
  children: React.ReactNode
  side?: TooltipSide
  wrapperClassName?: string
  contentClassName?: string
}

export const Tooltip: React.FC<TooltipProps> = ({
  content,
  children,
  side = 'top',
  wrapperClassName,
  contentClassName,
}) => {
  const anchorRef = useRef<HTMLSpanElement>(null)
  const tooltipRef = useRef<HTMLDivElement>(null)
  const [visible, setVisible] = useState(false)
  const [position, setPosition] = useState({ left: 0, top: 0 })

  useLayoutEffect(() => {
    if (!visible || !anchorRef.current || !tooltipRef.current) return

    const anchorRect = anchorRef.current.getBoundingClientRect()
    const tooltipRect = tooltipRef.current.getBoundingClientRect()
    const gap = 8
    const viewportPadding = 8

    let left = anchorRect.left + (anchorRect.width / 2) - (tooltipRect.width / 2)
    let top = side === 'top'
      ? anchorRect.top - tooltipRect.height - gap
      : anchorRect.bottom + gap

    if (left < viewportPadding) left = viewportPadding
    if (left + tooltipRect.width > window.innerWidth - viewportPadding) {
      left = window.innerWidth - tooltipRect.width - viewportPadding
    }

    if (top < viewportPadding) {
      top = anchorRect.bottom + gap
    }

    if (top + tooltipRect.height > window.innerHeight - viewportPadding) {
      top = Math.max(viewportPadding, anchorRect.top - tooltipRect.height - gap)
    }

    setPosition({ left, top })
  }, [side, visible])

  return (
    <>
      <span
        ref={anchorRef}
        className={wrapperClassName ?? 'inline-flex'}
        onMouseEnter={() => setVisible(true)}
        onMouseLeave={() => setVisible(false)}
        onFocus={() => setVisible(true)}
        onBlur={() => setVisible(false)}
      >
        {children}
      </span>
      {visible && typeof document !== 'undefined' && createPortal(
        <div
          ref={tooltipRef}
          className={`pointer-events-none fixed z-[220] overflow-hidden rounded-sm border-[0.5px] border-[#2b2b2b] bg-[#111111] px-2.5 py-1.5 text-[9px] brand-font font-bold uppercase tracking-[0.16em] text-[#d3d3d3] shadow-[0_10px_24px_rgba(0,0,0,0.42)] ${contentClassName ?? ''}`}
          style={{ left: position.left, top: position.top }}
          role="tooltip"
        >
          <span className="absolute inset-x-0 top-0 h-px bg-[#fcee09]/45" />
          {content}
        </div>,
        document.body
      )}
    </>
  )
}
