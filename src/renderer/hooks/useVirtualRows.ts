import type { RefObject } from 'react'
import { useEffect, useMemo, useState } from 'react'

interface UseVirtualRowsOptions {
  containerRef: RefObject<HTMLElement | null>
  count: number
  rowHeight: number
  overscan?: number
  enabled?: boolean
}

interface VirtualRowsResult {
  startIndex: number
  endIndex: number
  paddingTop: number
  paddingBottom: number
}

export function useVirtualRows({
  containerRef,
  count,
  rowHeight,
  overscan = 8,
  enabled = true,
}: UseVirtualRowsOptions): VirtualRowsResult {
  const [viewport, setViewport] = useState({ scrollTop: 0, height: 0 })

  useEffect(() => {
    const element = containerRef.current
    if (!element || !enabled) return

    let frame = 0
    const measure = () => {
      frame = 0
      setViewport({
        scrollTop: element.scrollTop,
        height: element.clientHeight,
      })
    }

    const scheduleMeasure = () => {
      if (frame !== 0) return
      frame = window.requestAnimationFrame(measure)
    }

    measure()
    element.addEventListener('scroll', scheduleMeasure, { passive: true })

    const resizeObserver = typeof ResizeObserver !== 'undefined'
      ? new ResizeObserver(scheduleMeasure)
      : null
    resizeObserver?.observe(element)
    window.addEventListener('resize', scheduleMeasure)

    return () => {
      if (frame !== 0) {
        window.cancelAnimationFrame(frame)
      }
      element.removeEventListener('scroll', scheduleMeasure)
      resizeObserver?.disconnect()
      window.removeEventListener('resize', scheduleMeasure)
    }
  }, [containerRef, enabled])

  return useMemo(() => {
    if (!enabled || count === 0) {
      return {
        startIndex: 0,
        endIndex: count,
        paddingTop: 0,
        paddingBottom: 0,
      }
    }

    const visibleCount = Math.max(1, Math.ceil(viewport.height / rowHeight))
    const startIndex = Math.max(0, Math.floor(viewport.scrollTop / rowHeight) - overscan)
    const endIndex = Math.min(count, startIndex + visibleCount + overscan * 2)

    return {
      startIndex,
      endIndex,
      paddingTop: startIndex * rowHeight,
      paddingBottom: Math.max(0, (count - endIndex) * rowHeight),
    }
  }, [count, enabled, overscan, rowHeight, viewport.height, viewport.scrollTop])
}
