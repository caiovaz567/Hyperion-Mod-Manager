import React, { useLayoutEffect, useRef } from 'react'
import { createPortal } from 'react-dom'

interface SeparatorNameDialogProps {
  title: string
  description: string
  value: string
  submitLabel: string
  inputLabel?: string
  placeholder?: string
  selectOnOpen?: boolean
  onChange: (value: string) => void
  onSubmit: () => void
  onCancel: () => void
  submitting?: boolean
}

export const SeparatorNameDialog: React.FC<SeparatorNameDialogProps> = ({
  title,
  description,
  value,
  submitLabel,
  inputLabel = 'Separator Name',
  placeholder,
  selectOnOpen = false,
  onChange,
  onSubmit,
  onCancel,
  submitting = false,
}) => {
  const inputRef = useRef<HTMLInputElement>(null)

  useLayoutEffect(() => {
    const focusInput = () => {
      inputRef.current?.focus({ preventScroll: true })
      if (selectOnOpen) {
        inputRef.current?.select()
      } else {
        const length = inputRef.current?.value.length ?? 0
        inputRef.current?.setSelectionRange(length, length)
      }
    }

    focusInput()
    const rafOne = window.requestAnimationFrame(() => focusInput())
    const rafTwo = window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => focusInput())
    })
    const id = window.setTimeout(() => {
      focusInput()
    }, 120)

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCancel()
      if (event.key === 'Enter') {
        event.preventDefault()
        onSubmit()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.cancelAnimationFrame(rafOne)
      window.cancelAnimationFrame(rafTwo)
      window.clearTimeout(id)
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [onCancel, onSubmit, selectOnOpen])

  return createPortal(
    <div
      data-action-prompt="true"
      className="fixed inset-0 z-[210] flex items-center justify-center bg-black/80 px-4 backdrop-blur-sm"
      onClick={(event) => {
        event.stopPropagation()
        onCancel()
      }}
    >
      <div
        className="relative w-full max-w-[480px] overflow-hidden border-[0.5px] border-[#222] bg-[#050505] shadow-[0_20px_50px_rgba(0,0,0,0.8)]"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="absolute left-0 top-0 h-[2px] w-full bg-[#fcee09] shadow-[0_0_12px_rgba(252,238,9,0.35)]" />

        <div className="px-6 pb-6 pt-5">
          <div className="mb-4 flex items-center gap-3 text-[#fcee09]">
            <span className="material-symbols-outlined text-[20px]">label</span>
            <h2 className="brand-font text-[1.05rem] font-bold uppercase tracking-[0.08em] text-white">
              {title}
            </h2>
          </div>

          <p className="mb-4 text-sm leading-relaxed text-[#a2a2a2]">
            {description}
          </p>

          <div className="overflow-hidden rounded-sm border-[0.5px] border-[#1f1f1f] bg-[#0a0a0a]">
            <div className="border-b-[0.5px] border-[#171717] px-4 py-2 text-[11px] brand-font font-bold uppercase tracking-[0.16em] text-[#7f7f7f]">
              {inputLabel}
            </div>
            <div className="px-4 py-4">
              <input
                ref={inputRef}
                autoFocus
                value={value}
                onChange={(event) => onChange(event.target.value)}
                placeholder={placeholder}
                className="h-11 w-full border-[0.5px] border-[#2d2d2d] bg-[#050505] px-4 text-sm font-medium tracking-[0.01em] text-white transition-colors focus:border-[#fcee09]/60 focus:outline-none focus:shadow-[0_0_14px_rgba(252,238,9,0.1)]"
              />
            </div>
          </div>

          <div className="mt-5 flex items-center justify-end gap-3">
            <button
              onClick={onCancel}
              disabled={submitting}
              className="h-10 rounded-sm border-[0.5px] border-[#2a2a2a] bg-[#0a0a0a] px-4 text-[11px] brand-font font-bold uppercase tracking-[0.16em] text-[#9a9a9a] transition-colors hover:border-[#4c4c4c] hover:text-white disabled:opacity-60"
            >
              Cancel
            </button>
            <button
              onClick={onSubmit}
              disabled={submitting}
              className="h-10 rounded-sm bg-[#fcee09] px-5 text-[11px] brand-font font-bold uppercase tracking-[0.16em] text-[#050505] transition-colors hover:bg-white disabled:opacity-60"
            >
              {submitLabel}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  )
}
