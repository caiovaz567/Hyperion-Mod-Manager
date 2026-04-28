import React, { useMemo, useState, useCallback, useRef, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { shallow } from 'zustand/shallow'
import { useAppStore } from '../../store/useAppStore'
import { parseFomodXml, buildInitialSelections, resolveInstallEntries, fomodImageUrl, computeVisibleSteps } from '../../utils/fomodParser'
import { IpcService } from '../../services/IpcService'
import { IPC } from '@shared/types'
import type { FomodGroup, FomodPlugin, FomodModuleConfig } from '@shared/types'

function getDefaultPluginForStep(
  config: FomodModuleConfig,
  selections: Map<string, Set<number>>,
  stepIdx: number
): FomodPlugin | null {
  const step = config.steps[stepIdx]
  if (!step) return null
  for (let gi = 0; gi < step.groups.length; gi++) {
    const group = step.groups[gi]
    const key = `${stepIdx}:${gi}`
    const sel = selections.get(key) ?? new Set<number>()
    const isAll = group.type === 'SelectAll' || group.type === 'SelectAllAndMore'
    for (let pi = 0; pi < group.plugins.length; pi++) {
      const plugin = group.plugins[pi]
      const checked = isAll || plugin.typeDescriptor === 'Required' || sel.has(pi)
      if (checked && plugin.image) return plugin
    }
  }
  return null
}

// ─── Image loader ─────────────────────────────────────────────────────────────
// Loads a local filesystem image via IPC as a base64 data URL, bypassing any
// browser scheme restrictions. Results are cached in memory for the session.

const _fomodImageCache = new Map<string, string>()

const FomodImage: React.FC<{ filePath: string; className?: string }> = ({ filePath, className }) => {
  const [src, setSrc] = useState<string>(() => _fomodImageCache.get(filePath) ?? '')

  useEffect(() => {
    const cached = _fomodImageCache.get(filePath)
    if (cached !== undefined) {
      if (cached) setSrc(cached)
      else console.debug('FomodImage: cached miss for', filePath)
      return
    }
    let cancelled = false
    IpcService.invoke<string>(IPC.FOMOD_READ_IMAGE, filePath)
      .then((dataUrl) => {
        if (cancelled) return
        const url = dataUrl || ''
        _fomodImageCache.set(filePath, url)
        if (url) setSrc(url)
        else console.debug('FomodImage: file not found on disk →', filePath)
      })
      .catch((err) => {
        if (cancelled) return
        _fomodImageCache.set(filePath, '')
        console.debug('FomodImage: IPC error for', filePath, err)
      })
    return () => { cancelled = true }
  }, [filePath])

  if (!src) return null
  return <img src={src} alt="" className={className} />
}


// ─── Subcomponents ────────────────────────────────────────────────────────────

interface PluginRowProps {
  plugin: FomodPlugin
  checked: boolean
  disabled: boolean
  inputType: 'radio' | 'checkbox'
  onToggle: () => void
  onHover: () => void
}

const PluginRow: React.FC<PluginRowProps> = ({
  plugin,
  checked,
  disabled,
  inputType,
  onToggle,
  onHover,
}) => {
  const isNotUsable = plugin.typeDescriptor === 'NotUsable'
  const isRequired = plugin.typeDescriptor === 'Required'
  const effectiveDisabled = disabled || isNotUsable || isRequired

  return (
    <label
      className={`flex items-center gap-3 rounded-sm px-3.5 py-2.5 cursor-pointer transition-colors select-none
        ${effectiveDisabled ? 'opacity-40 cursor-not-allowed' : 'hover:bg-white/[0.04]'}
        ${checked ? 'bg-white/[0.05]' : ''}`}
      onMouseEnter={onHover}
      onClick={(e) => {
        if (effectiveDisabled) { e.preventDefault(); return }
        onToggle()
      }}
    >
      {/* Control */}
      <span className="shrink-0">
        {inputType === 'radio' ? (
          <span
            className={`flex h-4 w-4 items-center justify-center rounded-full border transition-colors
              ${checked ? 'border-[#fcee09]' : 'border-[#444]'}`}
          >
            {checked && <span className="h-2 w-2 rounded-full bg-[#fcee09]" />}
          </span>
        ) : (
          <span
            className={`flex h-4 w-4 items-center justify-center rounded-sm border transition-colors
              ${checked ? 'border-[#fcee09] bg-[#fcee09]' : 'border-[#444]'}`}
          >
            {checked && (
              <span className="material-symbols-outlined text-[11px] text-black font-bold leading-none">check</span>
            )}
          </span>
        )}
      </span>

      {/* Name */}
      <div className={`min-w-0 flex-1 text-base font-medium leading-snug truncate ${checked ? 'text-[#f2f2f2]' : 'text-[#b0b0b0]'}`}>
        {plugin.name}
      </div>

      {isRequired && (
        <span className="shrink-0 text-[10px] font-bold tracking-widest uppercase text-[#fcee09]/70">required</span>
      )}
    </label>
  )
}

interface GroupSectionProps {
  group: FomodGroup
  groupKey: string
  selections: Map<string, Set<number>>
  onSelect: (groupKey: string, pluginIdx: number) => void
  onHoverPlugin: (plugin: FomodPlugin | null) => void
}

const GroupSection: React.FC<GroupSectionProps> = ({
  group,
  groupKey,
  selections,
  onSelect,
  onHoverPlugin,
}) => {
  const selected = selections.get(groupKey) ?? new Set<number>()
  const isAll = group.type === 'SelectAll' || group.type === 'SelectAllAndMore'
  const isCheckbox = group.type === 'SelectAny' || isAll

  return (
    <div className="mb-4">
      <div className="mb-1.5 flex items-center gap-2 px-1">
        <span className="text-[10px] font-bold tracking-widest uppercase text-[#5a5a5a]">{group.name}</span>
        {isAll && (
          <span className="text-[9px] font-bold tracking-widest uppercase text-[#444]">all selected</span>
        )}
      </div>
      <div className="overflow-hidden rounded-sm border border-[#1e1e1e] bg-[#080808]">
        {group.plugins.map((plugin, idx) => {
          const isAllChecked = isAll || plugin.typeDescriptor === 'Required'
          const checked = isAllChecked ? true : selected.has(idx)
          return (
            <PluginRow
              key={idx}
              plugin={plugin}
              checked={checked}
              disabled={isAll}
              inputType={isCheckbox ? 'checkbox' : 'radio'}
              onToggle={() => onSelect(groupKey, idx)}
              onHover={() => onHoverPlugin(plugin)}
            />
          )
        })}
      </div>
    </div>
  )
}

// ─── Preview Panel ─────────────────────────────────────────────────────────────

interface PreviewPanelProps {
  plugin: FomodPlugin | null
  extractRoot: string
  onOpenLightbox: (path: string) => void
}

const PreviewPanel: React.FC<PreviewPanelProps> = ({ plugin, extractRoot, onOpenLightbox }) => {
  const imagePath = plugin?.image ? fomodImageUrl(extractRoot, plugin.image) : null

  return (
    <div className="w-[420px] shrink-0 flex flex-col gap-3 border-l border-[#1a1a1a] pl-6 min-h-0 overflow-hidden">
      <div className="text-[10px] font-bold tracking-widest uppercase text-[#5a5a5a] shrink-0">Preview</div>

      <div className="flex-1 min-h-0 overflow-y-auto hyperion-scrollbar flex flex-col gap-3 pr-1">
        {imagePath ? (
          <div
            className="overflow-hidden rounded-sm border border-[#1e1e1e] cursor-zoom-in"
            title="Click to expand"
            onClick={() => onOpenLightbox(imagePath)}
          >
            <FomodImage filePath={imagePath} className="block w-full h-auto" />
          </div>
        ) : null}

        {plugin && (
          <>
            <div className="text-sm font-semibold text-[#e0e0e0] border-b border-[#1a1a1a] pb-2 leading-snug shrink-0">
              {plugin.name}
            </div>
            {plugin.description && (
              <div className="text-sm leading-relaxed text-[#9a9a9a] whitespace-pre-line">
                {plugin.description}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}

// ─── Main Dialog ──────────────────────────────────────────────────────────────

export const FomodInstallerDialog: React.FC = () => {
  const { fomodPrompt, fomodInstall, dismissFomodPrompt, clearFomodPrompt, setActiveView } = useAppStore((s) => ({
    fomodPrompt: s.fomodPrompt,
    fomodInstall: s.fomodInstall,
    dismissFomodPrompt: s.dismissFomodPrompt,
    clearFomodPrompt: s.clearFomodPrompt,
    setActiveView: (s as unknown as { setActiveView?: (v: string) => void }).setActiveView,
  }), shallow)

  const config = useMemo(() => {
    if (!fomodPrompt) return null
    try {
      const parsed = parseFomodXml(fomodPrompt.xml)
      console.debug('FomodInstallerDialog: parsed FOMOD config', { moduleName: parsed.moduleName, steps: parsed.steps.length })
      return parsed
    } catch (err) {
      console.error('FomodInstallerDialog: parseFomodXml failed', err)
      return null
    }
  }, [fomodPrompt])

  const [currentStep, setCurrentStep] = useState(0)
  const [selections, setSelections] = useState<Map<string, Set<number>>>(new Map)
  const [hoveredPlugin, setHoveredPlugin] = useState<FomodPlugin | null>(null)
  const [lastHoveredPlugin, setLastHoveredPlugin] = useState<FomodPlugin | null>(null)
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null)

  const prevTempDirRef = useRef<string | undefined>(undefined)

  useEffect(() => {
    if (fomodPrompt?.tempDir !== prevTempDirRef.current) {
      prevTempDirRef.current = fomodPrompt?.tempDir
      setCurrentStep(0)
      const initialSelections = config ? buildInitialSelections(config) : new Map()
      setSelections(initialSelections)
      setHoveredPlugin(null)
      setLightboxIndex(null)

      // Pre-populate preview with the first selected plugin that has an image
      let defaultPlugin: FomodPlugin | null = null
      if (config?.steps[0]) {
        const step0 = config.steps[0]
        outer: for (let gi = 0; gi < step0.groups.length; gi++) {
          const group = step0.groups[gi]
          const key = `0:${gi}`
          const sel = initialSelections.get(key) ?? new Set<number>()
          const isAll = group.type === 'SelectAll' || group.type === 'SelectAllAndMore'
          for (let pi = 0; pi < group.plugins.length; pi++) {
            const plugin = group.plugins[pi]
            const checked = isAll || plugin.typeDescriptor === 'Required' || sel.has(pi)
            if (checked && plugin.image) { defaultPlugin = plugin; break outer }
          }
        }
      }
      setLastHoveredPlugin(defaultPlugin)
    }
  }, [fomodPrompt?.tempDir, config])

  // Selection handler (useCallback keeps identity stable)
  const handleSelect = useCallback((groupKey: string, pluginIdx: number) => {
    setSelections((prev) => {
      const next = new Map(prev)
      const [siStr, giStr] = groupKey.split(':')
      const si = parseInt(siStr, 10)
      const gi = parseInt(giStr, 10)
      const group = config?.steps[si]?.groups[gi]
      if (!group) return prev

      const current = new Set(next.get(groupKey) ?? [])
      const plugin = group.plugins[pluginIdx]
      if (!plugin || plugin.typeDescriptor === 'NotUsable' || plugin.typeDescriptor === 'Required') return prev

      if (group.type === 'SelectExactlyOne' || group.type === 'SelectAtMostOne') {
        if (current.has(pluginIdx) && group.type === 'SelectAtMostOne') {
          current.delete(pluginIdx)
        } else {
          current.clear()
          current.add(pluginIdx)
        }
      } else {
        if (current.has(pluginIdx)) current.delete(pluginIdx)
        else current.add(pluginIdx)
      }

      next.set(groupKey, current)
      return next
    })
  }, [config])

  const handleHoverPlugin = useCallback((p: FomodPlugin | null) => {
    setHoveredPlugin(p)
    if (p) setLastHoveredPlugin(p)
  }, [])

  // Install handler — close dialog immediately and let install run in background
  const handleInstall = useCallback(() => {
    if (!config || !fomodPrompt) return
    const entries = resolveInstallEntries(config, selections)
    const request = {
      tempDir: fomodPrompt.tempDir,
      extractRoot: fomodPrompt.extractRoot,
      originalFilePath: fomodPrompt.originalFilePath,
      installEntries: entries,
      needsExtraction: fomodPrompt.needsExtraction,
      ...(fomodPrompt.request as object),
    }
    setActiveView?.('downloads')
    dismissFomodPrompt()
    fomodInstall(request).catch((err) => {
      console.error('FomodInstallerDialog: fomodInstall failed', err)
    })
  }, [config, selections, fomodInstall, dismissFomodPrompt, setActiveView, fomodPrompt])

  // Recomputes whenever selections change — gates which steps are navigable
  const visibleSteps = useMemo(
    () => (config ? computeVisibleSteps(config, selections) : []),
    [config, selections]
  )

  // If the current step becomes invisible (e.g. user switches "Custom" → "Install All"
  // and is already past step 0), snap back to the last visible step.
  useEffect(() => {
    if (visibleSteps.length > 0 && !visibleSteps.includes(currentStep)) {
      setCurrentStep(visibleSteps[visibleSteps.length - 1])
    }
  }, [visibleSteps, currentStep])

  // All plugins with images in the current step — used for lightbox navigation
  const lightboxEntries = useMemo(() => {
    if (!config || !fomodPrompt) return []
    const rawStep = config.steps[currentStep]
    if (!rawStep) return []
    const entries: Array<{ plugin: FomodPlugin; filePath: string }> = []
    for (const group of rawStep.groups) {
      for (const plugin of group.plugins) {
        if (plugin.image) entries.push({ plugin, filePath: fomodImageUrl(fomodPrompt.extractRoot, plugin.image) })
      }
    }
    return entries
  }, [config, currentStep, fomodPrompt])

  const handleOpenLightbox = useCallback((filePath: string) => {
    const idx = lightboxEntries.findIndex((e) => e.filePath === filePath)
    setLightboxIndex(idx >= 0 ? idx : null)
  }, [lightboxEntries])

  useEffect(() => {
    if (lightboxIndex === null) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setLightboxIndex(null)
      else if (e.key === 'ArrowLeft' && lightboxIndex > 0) setLightboxIndex(lightboxIndex - 1)
      else if (e.key === 'ArrowRight' && lightboxIndex < lightboxEntries.length - 1) setLightboxIndex(lightboxIndex + 1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [lightboxIndex, lightboxEntries.length])

  if (!fomodPrompt || !config) return null

  const totalSteps = visibleSteps.length
  const hasSteps = totalSteps > 0
  const currentVisiblePos = visibleSteps.indexOf(currentStep)
  const safePos = currentVisiblePos >= 0 ? currentVisiblePos : 0
  const step = config.steps[currentStep] ?? null
  const isLastStep = !hasSteps || safePos === totalSteps - 1
  const isFirstStep = safePos === 0
  const progressPct = hasSteps ? ((safePos + 1) / totalSteps) * 100 : 100
  const hasPreviewImages = Boolean(step && step.groups.some((group) => group.plugins.some((plugin) => !!plugin.image)))
  // Show the module banner only when there's no per-plugin preview panel
  const showModuleBanner = Boolean(config.moduleImage && safePos === 0 && !hasPreviewImages)

  // Validation: SelectExactlyOne must have exactly one selected
  const stepValid = !step || step.groups.every((group, gi) => {
    if (group.type !== 'SelectExactlyOne') return true
    const key = `${currentStep}:${gi}`
    const sel = selections.get(key) ?? new Set()
    // Required plugins auto-satisfy
    const hasRequired = group.plugins.some((p) => p.typeDescriptor === 'Required')
    return hasRequired || sel.size === 1
  })

  const dialog = createPortal(
    <div
      className="fixed inset-0 z-[300] flex items-center justify-center bg-black/80 px-4 backdrop-blur-sm"
      onClick={clearFomodPrompt}
    >
        <div
        className="relative flex flex-col bg-[#050505] border-[0.5px] border-[#1e1e1e] shadow-[0_24px_64px_rgba(0,0,0,0.85)]"
        style={{
          width: hasPreviewImages ? 'min(1180px, calc(100vw - 32px))' : 'min(860px, calc(100vw - 32px))',
          height: 'min(82vh, 840px)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Top accent bar */}
        <div className="absolute top-0 left-0 w-full h-[2px] bg-[#fcee09] shadow-[0_0_10px_rgba(252,238,9,0.5)]" />

        {/* Step progress bar */}
        {hasSteps && (
          <div className="absolute top-[2px] left-0 h-[2px] bg-[#fcee09]/30 transition-all duration-300"
            style={{ width: `${progressPct}%` }} />
        )}

        {/* Header */}
        <div className="flex items-center justify-between gap-4 px-6 pt-5 pb-4 border-b border-[#131313]">
          <div className="flex items-center gap-3 min-w-0">
            <span className="material-symbols-outlined text-xl text-[#fcee09]">install_desktop</span>
            <div className="min-w-0">
              <div className="text-[10px] brand-font font-bold tracking-widest uppercase text-[#fcee09]">FOMOD Installer</div>
              <div className="text-sm font-semibold text-[#e0e0e0] truncate mt-0.5">{config.moduleName}</div>
            </div>
          </div>
          {hasSteps && (
            <div className="shrink-0 font-mono text-xs text-[#7a7a7a]">Step {safePos + 1} / {totalSteps}</div>
          )}
        </div>

        {/* Module image banner (only when there are no plugin previews on step 1) */}
        {showModuleBanner && (
          <div className="px-6 pt-4 flex justify-center">
            <FomodImage
              filePath={fomodImageUrl(fomodPrompt.extractRoot, config.moduleImage!)}
              className="block max-w-full h-auto max-h-[220px] rounded-sm border border-[#1e1e1e]"
            />
          </div>
        )}

        {/* Step name */}
        {step && (
          <div className="px-6 pt-4 pb-2">
            <div className="text-[16px] font-semibold text-[#d0d0d0]">{step.name}</div>
          </div>
        )}


        {/* Content */}
        <div className="flex flex-1 min-h-0 overflow-hidden px-6 pb-4 pt-2 gap-6">
          {/* Groups */}
          <div className="flex-1 min-w-0 overflow-y-auto hyperion-scrollbar pr-1"
            onMouseLeave={() => setHoveredPlugin(null)}>
            {step ? (
              step.groups.map((group, gi) => (
                <GroupSection
                  key={gi}
                  group={group}
                  groupKey={`${currentStep}:${gi}`}
                  selections={selections}
                  onSelect={handleSelect}
                    onHoverPlugin={handleHoverPlugin}
                />
              ))
            ) : (
              <div className="flex flex-col items-center justify-center py-8 text-[#4a4a4a]">
                <span className="material-symbols-outlined text-3xl mb-2">check_circle</span>
                <span className="text-sm">No options to configure</span>
              </div>
            )}
          </div>

          {/* Preview panel — shown only when any plugin in this step has an image */}
          {hasPreviewImages && (
            <PreviewPanel
              plugin={hoveredPlugin ?? lastHoveredPlugin}
              extractRoot={fomodPrompt.extractRoot}
              onOpenLightbox={handleOpenLightbox}
            />
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-[#131313] px-6 py-4">
          <button
            onClick={clearFomodPrompt}
            className="border-[0.5px] border-[#2a2a2a] px-5 py-2.5 text-sm font-medium text-[#9a9a9a] hover:border-[#444] hover:text-[#e0e0e0] transition-colors rounded-sm"
          >
            Cancel
          </button>

          <div className="flex items-center gap-3">
            {hasSteps && !isFirstStep && (
              <button
                onClick={() => {
                  const prevIdx = visibleSteps[safePos - 1]
                  if (prevIdx !== undefined) { setCurrentStep(prevIdx); setHoveredPlugin(null); setLastHoveredPlugin(getDefaultPluginForStep(config, selections, prevIdx)); setLightboxIndex(null) }
                }}
                className="flex items-center gap-2 border-[0.5px] border-[#2a2a2a] bg-[#0a0a0a] px-5 py-2.5 text-xs font-bold tracking-widest uppercase text-[#9a9a9a] hover:border-[#444] hover:text-white transition-colors rounded-sm"
              >
                <span className="material-symbols-outlined text-base">arrow_back</span>
                Back
              </button>
            )}

            {!isLastStep ? (
              <button
                onClick={() => {
                  const nextIdx = visibleSteps[safePos + 1]
                  if (nextIdx !== undefined) { setCurrentStep(nextIdx); setHoveredPlugin(null); setLastHoveredPlugin(getDefaultPluginForStep(config, selections, nextIdx)); setLightboxIndex(null) }
                }}
                disabled={!stepValid}
                className="flex items-center gap-2 bg-[#fcee09] px-6 py-2.5 text-xs font-bold tracking-widest uppercase text-black hover:brightness-110 transition-all disabled:opacity-40 rounded-sm shadow-[0_0_12px_rgba(252,238,9,0.3)]"
              >
                Next
                <span className="material-symbols-outlined text-base">arrow_forward</span>
              </button>
            ) : (
              <button
                onClick={handleInstall}
                disabled={!stepValid}
                className="flex items-center gap-2 bg-[#fcee09] px-6 py-2.5 text-xs font-bold tracking-widest uppercase text-black hover:brightness-110 transition-all disabled:opacity-40 rounded-sm shadow-[0_0_12px_rgba(252,238,9,0.3)]"
              >
                <span className="material-symbols-outlined text-base">download</span>
                Install
              </button>
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body
  )

  return (
    <>
      {dialog}
      {lightboxIndex !== null && lightboxEntries[lightboxIndex] && createPortal(
        <div
          className="fixed inset-0 z-[400] flex flex-col items-center justify-center bg-black/95"
          onClick={() => setLightboxIndex(null)}
        >
          <div
            className="flex items-center justify-center gap-5"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Prev arrow */}
            <button
              className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-white/10 text-white transition-all ${lightboxIndex > 0 ? 'hover:bg-white/20 cursor-pointer' : 'opacity-0 pointer-events-none'}`}
              onClick={() => lightboxIndex > 0 && setLightboxIndex(lightboxIndex - 1)}
            >
              <span className="material-symbols-outlined text-2xl">arrow_back</span>
            </button>

            {/* Image */}
            <div className="relative">
              <FomodImage
                filePath={lightboxEntries[lightboxIndex].filePath}
                className="block max-h-[78vh] max-w-[72vw] object-contain rounded-sm"
              />
              <button
                className="absolute top-3 right-3 flex h-8 w-8 items-center justify-center rounded-sm bg-black/60 text-white hover:bg-black/90 transition-colors"
                onClick={() => setLightboxIndex(null)}
              >
                <span className="material-symbols-outlined text-lg">close</span>
              </button>
            </div>

            {/* Next arrow */}
            <button
              className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-white/10 text-white transition-all ${lightboxIndex < lightboxEntries.length - 1 ? 'hover:bg-white/20 cursor-pointer' : 'opacity-0 pointer-events-none'}`}
              onClick={() => lightboxIndex < lightboxEntries.length - 1 && setLightboxIndex(lightboxIndex + 1)}
            >
              <span className="material-symbols-outlined text-2xl">arrow_forward</span>
            </button>
          </div>

          {/* Plugin name + position indicator */}
          <div
            className="mt-4 text-center"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="text-sm font-semibold text-white/80">{lightboxEntries[lightboxIndex].plugin.name}</div>
            {lightboxEntries.length > 1 && (
              <div className="mt-1 font-mono text-xs text-white/35">{lightboxIndex + 1} / {lightboxEntries.length}</div>
            )}
          </div>
        </div>,
        document.body
      )}
    </>
  )
}
