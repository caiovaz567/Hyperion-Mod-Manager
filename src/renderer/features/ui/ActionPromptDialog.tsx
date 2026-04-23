import React from 'react'

interface ActionPromptDialogProps {
  accentColor: string
  accentGlow: string
  title: string
  description: string
  detailLabel?: string
  detailValue?: string
  icon: string
  primaryLabel: string
  secondaryLabel?: string
  cancelLabel?: string
  primaryTextColor?: string
  onPrimary: () => void
  onSecondary?: () => void
  onCancel: () => void
  submitting?: boolean
  detailContent?: React.ReactNode
  maxWidthClassName?: string
}

export const ActionPromptDialog: React.FC<ActionPromptDialogProps> = ({
  accentColor,
  accentGlow,
  title,
  description,
  detailLabel,
  detailValue,
  icon,
  primaryLabel,
  secondaryLabel,
  cancelLabel = 'Cancel',
  primaryTextColor = '#050505',
  onPrimary,
  onSecondary,
  onCancel,
  submitting = false,
  detailContent,
  maxWidthClassName,
}) => {
  return (
    <div
      data-action-prompt="true"
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/80 px-3 backdrop-blur-sm sm:px-4"
      onClick={(event) => {
        event.stopPropagation()
        onCancel()
      }}
    >
      <div
        className={`relative w-full ${maxWidthClassName ?? 'max-w-md'} border-[0.5px] border-[#222] bg-[#050505] p-5 shadow-[0_20px_50px_rgba(0,0,0,0.8)] sm:p-8 max-h-[min(92vh,760px)] overflow-y-auto hyperion-scrollbar`}
        onClick={(event) => event.stopPropagation()}
      >
        <div
          className="absolute top-0 left-0 w-full h-[2px]"
          style={{ background: accentColor, boxShadow: `0 0 10px ${accentGlow}` }}
        />

        <div className="mb-5 flex items-start gap-3 sm:mb-6 sm:items-center" style={{ color: accentColor }}>
          <span className="material-symbols-outlined text-2xl">{icon}</span>
          <h2 className="brand-font text-lg font-bold tracking-tighter uppercase sm:text-xl">{title}</h2>
        </div>

        <p className="text-[#9a9a9a] text-sm leading-relaxed mb-3">{description}</p>
        {(detailContent || (detailLabel && detailValue)) && (
          <div className="mb-6 overflow-hidden rounded-sm border-[0.5px] border-[#2a2a2a] bg-[#0b0b0b] shadow-[inset_0_1px_0_rgba(255,255,255,0.03)] sm:mb-8">
            <div
              className="h-px w-full"
              style={{ background: accentColor, boxShadow: `0 0 10px ${accentGlow}` }}
            />
            {detailContent ?? (
              <div className="px-4 py-3">
                <div className="text-sm text-[#9a9a9a] font-mono">
                  {detailLabel}
                </div>
                <div
                  className="mt-2 break-words text-sm font-semibold tracking-[0.01em] text-white"
                  title={detailValue}
                >
                  {detailValue}
                </div>
              </div>
            )}
          </div>
        )}

        <div className="flex flex-col gap-3">
          <button
            onClick={onPrimary}
            disabled={submitting}
            className="w-full font-bold py-3 text-xs tracking-widest uppercase transition-all rounded-sm disabled:opacity-60 hover:brightness-110 hover:shadow-[0_0_16px_rgba(255,255,255,0.08)]"
            style={{
              background: accentColor,
              color: primaryTextColor,
              boxShadow: `0 0 15px ${accentGlow}`,
            }}
          >
            {primaryLabel}
          </button>
          {secondaryLabel && onSecondary && (
            <button
              onClick={onSecondary}
              disabled={submitting}
              className="w-full bg-[#0a0a0a] border-[0.5px] border-[#7a7a7a] text-white font-bold py-3 text-xs tracking-widest uppercase rounded-sm disabled:opacity-60 hover:border-[#9a9a9a] hover:bg-[#111] hover:shadow-[0_0_12px_rgba(255,255,255,0.05)] transition-all"
              style={{ '--hover-color': accentColor } as React.CSSProperties}
            >
              {secondaryLabel}
            </button>
          )}
          <button
            onClick={onCancel}
            disabled={submitting}
            className="w-full border-[0.5px] border-transparent text-[#8a8a8a] hover:text-white hover:border-[#222] hover:bg-[#0a0a0a] py-2 text-[10px] font-bold tracking-widest uppercase transition-all mt-2 disabled:opacity-60 rounded-sm"
          >
            {cancelLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
