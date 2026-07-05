import React, { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Button } from '@heroui/react'
import { useAppStore } from '../../store/useAppStore'
import { HyperionModal, HyperionModalHeader } from './HyperionPrimitives'
import { useTranslation } from '../../i18n/I18nContext'
import { Icon } from './Icon'

// Shown when installing a Nexus file whose mod page already has a different file
// installed (e.g. the optional patch alongside the main file). The user names
// the new library entry: type freely, or pick from a suggestions dropdown (the
// file name, the archive filename, the mod page title). Confirming re-installs
// with that name.
export const InstallNameDialog: React.FC = () => {
  const { t } = useTranslation()
  const {
    nameChoicePrompt,
    clearNameChoicePrompt,
    installMod,
    scanMods,
    enableMod,
    addToast,
  } = useAppStore()
  const [name, setName] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [open, setOpen] = useState(false)
  // The dropdown is a portaled popover (fixed-positioned under the field) so it
  // never resizes the modal or gets clipped by the modal's overflow-hidden.
  const [rect, setRect] = useState<{ left: number; top: number; width: number } | null>(null)
  const fieldRef = useRef<HTMLDivElement>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)

  // Distinct suggestions: file name, cleaned archive name, mod page title -
  // deduped, in that priority order.
  const suggestions = useMemo(() => {
    if (!nameChoicePrompt) return []
    const seen = new Set<string>()
    const out: string[] = []
    for (const candidate of [nameChoicePrompt.fileName, nameChoicePrompt.archiveName, nameChoicePrompt.pageName]) {
      const value = candidate?.trim()
      if (!value || seen.has(value.toLowerCase())) continue
      seen.add(value.toLowerCase())
      out.push(value)
    }
    return out
  }, [nameChoicePrompt])

  // Re-seed the input each time a prompt opens - prefer the first suggestion that
  // is DISTINCT from the sibling already installed (so it never defaults to a
  // name identical to the existing entry when an old record only had the page title).
  useEffect(() => {
    if (!nameChoicePrompt) return
    const sibling = nameChoicePrompt.existingSiblingName.trim().toLowerCase()
    const distinct = suggestions.find((value) => value.trim().toLowerCase() !== sibling)
    setName(distinct ?? nameChoicePrompt.fileName)
    setSubmitting(false)
    setOpen(false)
  }, [nameChoicePrompt, suggestions])

  // Close the popover on outside click (accounting for the portaled dropdown).
  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node
      if (fieldRef.current?.contains(target) || dropdownRef.current?.contains(target)) return
      setOpen(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    return () => document.removeEventListener('mousedown', onPointerDown)
  }, [open])

  if (!nameChoicePrompt) return null

  const trimmed = name.trim()
  const hasSuggestions = suggestions.length > 0

  const toggleDropdown = () => {
    setOpen((prev) => {
      const next = !prev
      if (next && fieldRef.current) {
        const r = fieldRef.current.getBoundingClientRect()
        setRect({ left: r.left, top: r.bottom + 6, width: r.width })
      }
      return next
    })
  }

  const handleConfirm = async () => {
    if (!trimmed || submitting) return
    setSubmitting(true)
    const prompt = nameChoicePrompt
    clearNameChoicePrompt()
    try {
      const result = await installMod(prompt.filePath, { ...prompt.request, customName: trimmed })
      if (!result.ok || !result.data) {
        addToast(result.error ?? t('dialogs.installName.failed'), 'error')
        return
      }
      if (result.data.status === 'installed' && result.data.mod) {
        await scanMods({ refreshConflicts: false, refreshModUpdates: false })
        const enableResult = await enableMod(result.data.mod.uuid)
        await scanMods({ immediateConflicts: true, refreshModUpdates: false })
        addToast(
          enableResult.ok
            ? t('dialogs.installName.installedActivated', { name: result.data.mod.name })
            : t('dialogs.installName.installedNotActivated', { error: enableResult.error ?? '' }),
          enableResult.ok ? 'success' : 'warning',
        )
      }
      // Other statuses (conflict / duplicate - e.g. the chosen name matches an
      // existing mod) are handled by installMod's own prompt flow.
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <HyperionModal onClose={submitting ? () => {} : clearNameChoicePrompt} surfaceClassName="max-w-[520px]">
      <div className="px-6 pb-6 pt-6">
        <HyperionModalHeader icon="drive_file_rename_outline" title={t('dialogs.installName.title')} className="mb-3" />

        <p className="mb-5 text-[15px] leading-relaxed text-[var(--text-support)]">
          {t('dialogs.installName.description', { existing: nameChoicePrompt.existingSiblingName })}
        </p>

        <label className="mb-2 block text-[13px] font-medium text-[var(--text-secondary)]">
          {t('dialogs.installName.nameLabel')}
        </label>

        {/* Editable name field + a suggestions dropdown trigger (combobox-style).
            A border (not just a fill) keeps the field legible in light mode, where
            the surface tint sits too close to the modal background. */}
        <div ref={fieldRef} className="flex h-11 items-center rounded-xl border border-[var(--border-strong)] bg-[var(--surface-secondary)] transition-colors focus-within:border-[var(--accent)] focus-within:bg-[color-mix(in_srgb,var(--surface-secondary),white_7%)]">
          <input
            autoFocus
            value={name}
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                void handleConfirm()
              } else if (event.key === 'Escape' && open) {
                event.preventDefault()
                setOpen(false)
              }
            }}
            placeholder={t('dialogs.installName.placeholder')}
            className="min-w-0 flex-1 bg-transparent px-4 text-[14px] text-[var(--text-primary-alt)] placeholder:text-[var(--text-muted)] focus:outline-none"
            spellCheck={false}
          />
          {hasSuggestions && (
            <button
              type="button"
              onClick={toggleDropdown}
              aria-haspopup="listbox"
              aria-expanded={open}
              aria-label={t('dialogs.installName.suggestionsAria')}
              className="mr-1.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[var(--text-muted)] transition-colors hover:bg-[var(--surface)] hover:text-[var(--text-primary)]"
            >
              <Icon name="expand_more" className={`text-[20px] transition-transform duration-150 ${open ? 'rotate-180' : ''}`} />
            </button>
          )}
        </div>

        <div className="mt-6 flex items-center justify-end gap-2">
          <Button variant="tertiary" onPress={clearNameChoicePrompt} isDisabled={submitting}>
            {t('common.cancel')}
          </Button>
          <Button variant="primary" onPress={() => void handleConfirm()} isDisabled={submitting || !trimmed}>
            {t('dialogs.installName.install')}
          </Button>
        </div>
      </div>

      {open && hasSuggestions && rect && createPortal(
        <div
          ref={dropdownRef}
          role="listbox"
          style={{ position: 'fixed', left: rect.left, top: rect.top, width: rect.width }}
          className="z-[230] overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--overlay)] py-1.5"
        >
          <div className="px-3.5 pb-1 pt-0.5 text-[12px] font-medium uppercase tracking-[0.05em] text-[var(--text-muted)]">
            {t('dialogs.installName.suggestions')}
          </div>
          {suggestions.map((suggestion) => {
            const active = trimmed === suggestion
            return (
              <button
                key={suggestion}
                type="button"
                role="option"
                aria-selected={active}
                onClick={() => {
                  setName(suggestion)
                  setOpen(false)
                }}
                className={`mx-1 flex w-[calc(100%-8px)] items-center gap-2 rounded-md px-2.5 py-2 text-left transition-colors ${
                  active ? 'text-[var(--accent)]' : 'text-[var(--text-secondary)] hover:bg-[var(--surface-secondary)] hover:text-[var(--text-primary)]'
                }`}
              >
                <span className="flex w-4 shrink-0 items-center justify-center">
                  {active ? <Icon name="check" className="text-[15px]" /> : null}
                </span>
                <span className={`truncate text-[14px] ${active ? 'font-semibold' : 'font-medium'}`}>{suggestion}</span>
              </button>
            )
          })}
        </div>,
        document.body,
      )}
    </HyperionModal>
  )
}
