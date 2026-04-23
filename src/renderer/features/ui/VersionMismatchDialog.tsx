import React, { useEffect, useMemo, useState } from 'react'
import { useAppStore } from '../../store/useAppStore'

type VersionRelation = 'upgrade' | 'downgrade' | 'different' | 'unknown'

function tokenizeVersion(value?: string): string[] {
  if (!value) return []
  return value
    .trim()
    .toLowerCase()
    .split(/[^a-z0-9]+/i)
    .filter(Boolean)
}

function compareVersionTokens(left?: string, right?: string): number | null {
  const leftTokens = tokenizeVersion(left)
  const rightTokens = tokenizeVersion(right)
  if (!leftTokens.length || !rightTokens.length) return null

  const length = Math.max(leftTokens.length, rightTokens.length)
  for (let index = 0; index < length; index += 1) {
    const leftToken = leftTokens[index] ?? '0'
    const rightToken = rightTokens[index] ?? '0'
    const leftNumber = Number(leftToken)
    const rightNumber = Number(rightToken)
    const bothNumeric = !Number.isNaN(leftNumber) && !Number.isNaN(rightNumber)

    if (bothNumeric) {
      if (leftNumber === rightNumber) continue
      return leftNumber < rightNumber ? -1 : 1
    }

    if (leftToken === rightToken) continue
    return leftToken.localeCompare(rightToken)
  }

  return 0
}

function getVersionRelation(existingVersion?: string, incomingVersion?: string): VersionRelation {
  const comparison = compareVersionTokens(existingVersion, incomingVersion)
  if (comparison === null) return 'unknown'
  if (comparison < 0) return 'upgrade'
  if (comparison > 0) return 'downgrade'
  return 'different'
}

function formatVersionLabel(version?: string): string {
  return version ? `v${version}` : 'Unknown'
}

function formatMatchIdentity(value?: string): string | null {
  if (!value) return null
  return value
    .split(' - ')
    .map((part) => part.trim())
    .filter(Boolean)
    .join(' / ')
}

export const VersionMismatchDialog: React.FC = () => {
  const {
    versionMismatchPrompt,
    confirmVersionMismatch,
  } = useAppStore((state) => ({
    versionMismatchPrompt: state.versionMismatchPrompt,
    confirmVersionMismatch: state.confirmVersionMismatch,
  }))

  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (!versionMismatchPrompt) {
      setSubmitting(false)
    }
  }, [versionMismatchPrompt])

  const relation = useMemo<VersionRelation>(
    () => getVersionRelation(versionMismatchPrompt?.existingVersion, versionMismatchPrompt?.incomingVersion),
    [versionMismatchPrompt?.existingVersion, versionMismatchPrompt?.incomingVersion]
  )

  if (!versionMismatchPrompt) return null

  const relationMeta = {
    upgrade: {
      badge: 'Upgrade Ready',
      summary: 'The selected archive is newer than the mod already installed.',
      tone: 'cyan' as const,
    },
    downgrade: {
      badge: 'Older Archive',
      summary: 'The selected archive is older than the mod already installed.',
      tone: 'red' as const,
    },
    different: {
      badge: 'Different Version',
      summary: 'The selected archive does not match the currently installed version.',
      tone: 'cyan' as const,
    },
    unknown: {
      badge: 'Needs Review',
      summary: 'Hyperion could not verify the version relationship with confidence.',
      tone: 'cyan' as const,
    },
  }[relation]

  const replaceMeta = relation === 'downgrade'
    ? {
        title: `Replace Current Mod With ${formatVersionLabel(versionMismatchPrompt.incomingVersion)}`,
        helper: 'Use this only if you want to roll back. The installed entry will be replaced by the older archive.',
        accent: 'red' as const,
        recommended: false,
      }
    : {
        title: `Update To ${formatVersionLabel(versionMismatchPrompt.incomingVersion)}`,
        helper: 'Use this if you want the current library entry to become the selected archive version.',
        accent: 'yellow' as const,
        recommended: relation === 'upgrade',
      }

  const copyMeta = relation === 'downgrade'
    ? {
        title: `Keep Current Version ${formatVersionLabel(versionMismatchPrompt.existingVersion)}`,
        helper: 'Recommended. Hyperion keeps the current install exactly as it is and ignores the older archive.',
        accent: 'yellow' as const,
        recommended: true,
      }
    : {
        title: `Keep Both Versions Side By Side`,
        helper: 'The current mod stays installed and the selected archive is added as a separate copy in the library.',
        accent: 'cyan' as const,
        recommended: false,
      }

  const relationBadgeStyle = relationMeta.tone === 'red'
    ? {
        borderColor: 'rgba(248,113,113,0.45)',
        background: 'rgba(248,113,113,0.08)',
        color: 'var(--status-error)',
      }
    : {
        borderColor: 'rgba(79,216,255,0.45)',
        background: 'rgba(79,216,255,0.08)',
        color: 'var(--accent-cyber-blue)',
      }
  const relationAccentColor = relation === 'downgrade'
    ? 'var(--status-error)'
    : 'var(--accent-cyber-blue)'
  const relationAccentGlow = relation === 'downgrade'
    ? '0 0 12px rgba(248,113,113,0.24)'
    : '0 0 12px rgba(79,216,255,0.24)'

  const doAction = async (action: 'replace' | 'copy' | 'skip') => {
    setSubmitting(true)
    try {
      await confirmVersionMismatch(action)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[210] flex items-center justify-center overflow-hidden bg-black/82 px-4 py-5 backdrop-blur-sm sm:px-5">
      <div className="relative mx-auto w-full max-w-[560px] overflow-hidden border-[0.5px] border-[var(--border-strong)] bg-[var(--bg-base)] px-5 py-5 shadow-[0_20px_50px_rgba(0,0,0,0.82)] sm:px-6 sm:py-6">
        <div
          className="absolute left-0 top-0 h-[2px] w-full"
          style={{
            background: relationAccentColor,
            boxShadow: relationAccentGlow,
          }}
        />

        <div className="mb-4 flex flex-col gap-3 border-b-[0.5px] border-[var(--border-default)] pb-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <div className="mb-2 flex items-center gap-3">
              <span
                className="material-symbols-outlined text-[22px]"
                style={{ color: relationAccentColor }}
              >
                difference
              </span>
              <h2
                className="brand-font text-[1.05rem] font-bold uppercase tracking-[0.06em] sm:text-[1.15rem]"
                style={{ color: 'var(--text-primary)' }}
              >
                Version Mismatch
              </h2>
            </div>
            <p className="text-sm leading-relaxed text-[var(--text-secondary)]">
              {relationMeta.summary}
            </p>
          </div>
          <span
            className="inline-flex shrink-0 items-center self-start rounded-sm border-[0.5px] px-3 py-1 text-[10px] brand-font font-bold uppercase tracking-[0.18em]"
            style={relationBadgeStyle}
          >
            {relationMeta.badge}
          </span>
        </div>

        <div className="mb-4 rounded-sm border-[0.5px] border-[var(--border-default)] bg-[linear-gradient(180deg,rgba(17,17,17,0.98),rgba(8,8,8,0.99))] px-4 py-3">
          <div className="grid gap-3 sm:grid-cols-[minmax(0,0.88fr)_minmax(0,1.12fr)]">
            <div className="min-w-0">
              <div className="ui-support-mono uppercase tracking-[0.14em] text-[var(--text-support)]">
                Current installed
              </div>
              <div className="mt-2 font-mono text-[1.45rem] font-semibold leading-none text-[var(--accent)]">
                {formatVersionLabel(versionMismatchPrompt.existingVersion)}
              </div>
              <div className="mt-2 text-sm font-medium tracking-[0.01em] text-[var(--text-primary)]">
                {versionMismatchPrompt.existingModName}
              </div>
              {versionMismatchPrompt.existingSourceFileName ? (
                <div className="mt-2 break-words text-xs leading-relaxed text-[var(--text-secondary)]">
                  Source archive: {versionMismatchPrompt.existingSourceFileName}
                </div>
              ) : null}
            </div>

            <div className="min-w-0 border-t-[0.5px] border-[var(--border-default)] pt-3 sm:border-l-[0.5px] sm:border-t-0 sm:pl-4 sm:pt-0 sm:border-l-[var(--border-default)]">
              <div className="ui-support-mono uppercase tracking-[0.14em] text-[var(--text-support)]">
                Archive selected
              </div>
              <div
                className="mt-2 font-mono text-[1.45rem] font-semibold leading-none"
                style={{ color: relationAccentColor }}
              >
                {formatVersionLabel(versionMismatchPrompt.incomingVersion)}
              </div>
              <div className="mt-2 break-words text-sm font-medium tracking-[0.01em] text-[var(--text-primary)]">
                {versionMismatchPrompt.sourceFileName ?? 'Archive currently selected in Downloads'}
              </div>
              {formatMatchIdentity(versionMismatchPrompt.matchedSourceIdentity) ? (
                <div className="mt-2 break-words text-xs leading-relaxed text-[var(--text-secondary)]">
                  Matched by file line: {formatMatchIdentity(versionMismatchPrompt.matchedSourceIdentity)}
                </div>
              ) : null}
            </div>
          </div>
        </div>

        <div className="mb-4 grid gap-3">
          {relation !== 'downgrade' ? (
            <>
              <button
                onClick={() => void doAction('replace')}
                disabled={submitting}
                className="group rounded-sm border-[0.5px] px-4 py-4 text-left transition-all duration-150 hover:-translate-y-[1px] disabled:opacity-60"
                style={{
                  borderColor: 'rgba(79,216,255,0.34)',
                  background: 'linear-gradient(180deg, rgba(79,216,255,0.08), rgba(8,8,8,0.99) 58%)',
                  boxShadow: 'inset 0 1px 0 rgba(79,216,255,0.08), 0 0 0 rgba(79,216,255,0)',
                }}
                onMouseEnter={(event) => {
                  event.currentTarget.style.borderColor = 'rgba(79,216,255,0.55)'
                  event.currentTarget.style.boxShadow = 'inset 0 1px 0 rgba(79,216,255,0.12), 0 0 18px rgba(79,216,255,0.12)'
                }}
                onMouseLeave={(event) => {
                  event.currentTarget.style.borderColor = 'rgba(79,216,255,0.34)'
                  event.currentTarget.style.boxShadow = 'inset 0 1px 0 rgba(79,216,255,0.08), 0 0 0 rgba(79,216,255,0)'
                }}
              >
                <div className="mb-2 flex items-center justify-between gap-3">
                  <div
                    className="brand-font text-[0.95rem] font-bold uppercase tracking-[0.05em]"
                    style={{ color: 'var(--accent-cyber-blue)' }}
                  >
                    {replaceMeta.title}
                  </div>
                  {replaceMeta.recommended ? (
                    <span className="rounded-sm border-[0.5px] border-[rgba(79,216,255,0.34)] bg-[rgba(79,216,255,0.08)] px-2 py-1 text-[10px] brand-font font-bold uppercase tracking-[0.16em] text-[var(--accent-cyber-blue)]">
                      Recommended
                    </span>
                  ) : null}
                </div>
                <div className="text-sm leading-relaxed text-[var(--text-secondary)]">
                  {replaceMeta.helper}
                </div>
              </button>

              <button
                onClick={() => void doAction('copy')}
                disabled={submitting}
                className="group rounded-sm border-[0.5px] px-4 py-4 text-left transition-all duration-150 hover:-translate-y-[1px] disabled:opacity-60"
                style={{
                  borderColor: 'rgba(252,238,9,0.34)',
                  background: 'linear-gradient(180deg, rgba(252,238,9,0.08), rgba(10,10,10,0.98) 58%)',
                  boxShadow: 'inset 0 1px 0 rgba(252,238,9,0.06), 0 0 0 rgba(252,238,9,0)',
                }}
                onMouseEnter={(event) => {
                  event.currentTarget.style.borderColor = 'rgba(252,238,9,0.56)'
                  event.currentTarget.style.boxShadow = 'inset 0 1px 0 rgba(252,238,9,0.1), 0 0 18px rgba(252,238,9,0.1)'
                }}
                onMouseLeave={(event) => {
                  event.currentTarget.style.borderColor = 'rgba(252,238,9,0.34)'
                  event.currentTarget.style.boxShadow = 'inset 0 1px 0 rgba(252,238,9,0.06), 0 0 0 rgba(252,238,9,0)'
                }}
              >
                <div className="mb-2 flex items-center justify-between gap-3">
                  <div
                    className="brand-font text-[0.95rem] font-bold uppercase tracking-[0.05em]"
                    style={{ color: 'var(--accent)' }}
                  >
                    {copyMeta.title}
                  </div>
                </div>
                <div className="text-sm leading-relaxed text-[var(--text-secondary)]">
                  {copyMeta.helper}
                </div>
              </button>
            </>
          ) : (
            <>
              <button
                onClick={() => void doAction('replace')}
                disabled={submitting}
                className="group rounded-sm border-[0.5px] px-4 py-4 text-left transition-all duration-150 hover:-translate-y-[1px] disabled:opacity-60"
                style={{
                  borderColor: 'rgba(248,113,113,0.38)',
                  background: 'linear-gradient(180deg, rgba(248,113,113,0.08), rgba(10,10,10,0.98) 60%)',
                  boxShadow: 'inset 0 1px 0 rgba(248,113,113,0.06), 0 0 0 rgba(248,113,113,0)',
                }}
                onMouseEnter={(event) => {
                  event.currentTarget.style.borderColor = 'rgba(248,113,113,0.58)'
                  event.currentTarget.style.boxShadow = 'inset 0 1px 0 rgba(248,113,113,0.12), 0 0 18px rgba(248,113,113,0.12)'
                }}
                onMouseLeave={(event) => {
                  event.currentTarget.style.borderColor = 'rgba(248,113,113,0.38)'
                  event.currentTarget.style.boxShadow = 'inset 0 1px 0 rgba(248,113,113,0.06), 0 0 0 rgba(248,113,113,0)'
                }}
              >
                <div className="mb-2 flex items-center justify-between gap-3">
                  <div
                    className="brand-font text-[0.95rem] font-bold uppercase tracking-[0.05em]"
                    style={{ color: 'var(--status-error)' }}
                  >
                    {replaceMeta.title}
                  </div>
                </div>
                <div className="text-sm leading-relaxed text-[var(--text-secondary)]">
                  {replaceMeta.helper}
                </div>
              </button>

              <button
                onClick={() => void doAction('skip')}
                disabled={submitting}
                className="group rounded-sm border-[0.5px] px-4 py-4 text-left transition-all duration-150 hover:-translate-y-[1px] disabled:opacity-60"
                style={{
                  borderColor: 'rgba(252,238,9,0.34)',
                  background: 'linear-gradient(180deg, rgba(252,238,9,0.08), rgba(10,10,10,0.98) 58%)',
                  boxShadow: 'inset 0 1px 0 rgba(252,238,9,0.06), 0 0 0 rgba(252,238,9,0)',
                }}
                onMouseEnter={(event) => {
                  event.currentTarget.style.borderColor = 'rgba(252,238,9,0.56)'
                  event.currentTarget.style.boxShadow = 'inset 0 1px 0 rgba(252,238,9,0.1), 0 0 18px rgba(252,238,9,0.1)'
                }}
                onMouseLeave={(event) => {
                  event.currentTarget.style.borderColor = 'rgba(252,238,9,0.34)'
                  event.currentTarget.style.boxShadow = 'inset 0 1px 0 rgba(252,238,9,0.06), 0 0 0 rgba(252,238,9,0)'
                }}
              >
                <div className="mb-2 flex items-center justify-between gap-3">
                  <div
                    className="brand-font text-[0.95rem] font-bold uppercase tracking-[0.05em]"
                    style={{ color: 'var(--accent)' }}
                  >
                    {copyMeta.title}
                  </div>
                  {copyMeta.recommended ? (
                    <span className="rounded-sm border-[0.5px] border-[rgba(252,238,9,0.34)] bg-[rgba(252,238,9,0.08)] px-2 py-1 text-[10px] brand-font font-bold uppercase tracking-[0.16em] text-[var(--accent)]">
                      Recommended
                    </span>
                  ) : null}
                </div>
                <div className="text-sm leading-relaxed text-[var(--text-secondary)]">
                  {copyMeta.helper}
                </div>
              </button>
            </>
          )}
        </div>

        {relation !== 'downgrade' ? (
          <button
            onClick={() => {
              if (submitting) return
              void doAction('skip')
            }}
            disabled={submitting}
            className="w-full rounded-sm border-[0.5px] border-[var(--border-default)] py-2 text-[10px] brand-font font-bold uppercase tracking-[0.18em] text-[var(--text-muted)] transition-colors hover:border-[var(--border-strong)] hover:text-[var(--text-primary)] disabled:opacity-60"
          >
            Not Now
          </button>
        ) : null}
      </div>
    </div>
  )
}

export default VersionMismatchDialog
