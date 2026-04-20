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

  const relationCopy = {
    upgrade: {
      label: 'Upgrade Ready',
      description: 'This archive is newer than the version currently installed.',
      helper: 'Replace to update now, or install as copy to keep both versions available.',
    },
    downgrade: {
      label: 'Older Archive',
      description: 'This archive looks older than the version already installed.',
      helper: 'Replace only if you want a rollback, or install as copy to compare both versions safely.',
    },
    different: {
      label: 'Different Version',
      description: 'The selected archive does not match the installed version.',
      helper: 'Choose whether to replace the current install or keep both variants side by side.',
    },
    unknown: {
      label: 'Needs Review',
      description: 'Hyperion could not verify one of the versions with confidence.',
      helper: 'Review the selected archive before replacing the installed mod.',
    },
  }[relation]

  const relationBadgeStyle = relation === 'downgrade'
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
      <div className="relative w-full max-w-[680px] overflow-hidden border-[0.5px] border-[var(--border-strong)] bg-[var(--bg-base)] px-5 py-5 shadow-[0_20px_50px_rgba(0,0,0,0.82)] sm:px-6 sm:py-6">
        <div
          className="absolute left-0 top-0 h-[2px] w-full"
          style={{
            background: 'var(--accent-cyber-blue)',
            boxShadow: '0 0 12px rgba(79,216,255,0.28)',
          }}
        />

        <div className="mb-4 flex flex-col gap-3 border-b-[0.5px] border-[var(--border-default)] pb-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <div className="mb-2 flex items-center gap-3">
              <span
                className="material-symbols-outlined text-[22px]"
                style={{ color: 'var(--accent-cyber-blue)' }}
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
              {relationCopy.description}{' '}
              <span style={{ color: 'var(--text-support)' }}>{relationCopy.helper}</span>
            </p>
          </div>
          <span
            className="inline-flex shrink-0 items-center self-start rounded-sm border-[0.5px] px-3 py-1 text-[10px] brand-font font-bold uppercase tracking-[0.18em]"
            style={relationBadgeStyle}
          >
            {relationCopy.label}
          </span>
        </div>

        <div className="mb-4 rounded-sm border-[0.5px] border-[var(--border-default)] bg-[linear-gradient(180deg,rgba(17,17,17,0.98),rgba(8,8,8,0.99))] px-4 py-3">
          <div className="grid gap-3 sm:grid-cols-[minmax(0,0.88fr)_minmax(0,1.12fr)]">
            <div className="min-w-0">
              <div className="ui-support-mono uppercase tracking-[0.14em] text-[var(--text-support)]">
                Nexus mod
              </div>
              <div className="brand-font mt-1 text-[1.05rem] font-bold uppercase tracking-[0.06em] text-[var(--text-primary)]">
                {versionMismatchPrompt.existingModName}
              </div>
            </div>

            <div className="min-w-0 border-t-[0.5px] border-[var(--border-default)] pt-3 sm:border-l-[0.5px] sm:border-t-0 sm:pl-4 sm:pt-0 sm:border-l-[var(--border-default)]">
              <div className="ui-support-mono uppercase tracking-[0.14em] text-[var(--text-support)]">
                Selected archive
              </div>
              <div className="mt-2 break-words text-sm font-medium tracking-[0.01em] text-[var(--text-primary)]">
                {versionMismatchPrompt.sourceFileName ?? 'Archive currently selected in Downloads'}
              </div>
            </div>
          </div>
        </div>

        <div className="mb-4 grid gap-3 sm:grid-cols-2">
          <div
            className="rounded-sm border-[0.5px] px-4 py-3"
            style={{
              borderColor: 'rgba(252,238,9,0.28)',
              background: 'linear-gradient(180deg, rgba(252,238,9,0.08), rgba(10,10,10,0.98) 52%)',
            }}
          >
            <div className="ui-support-mono uppercase tracking-[0.14em] text-[var(--text-support)]">
              Installed now
            </div>
            <div
              className="mt-2 font-mono text-[1.3rem] font-semibold leading-none"
              style={{ color: 'var(--accent)' }}
            >
              {formatVersionLabel(versionMismatchPrompt.existingVersion)}
            </div>
            <div className="ui-support-mono mt-2 text-[var(--text-support)]">
              Replace updates the current library entry for this Nexus mod.
            </div>
          </div>

          <div
            className="rounded-sm border-[0.5px] px-4 py-3 shadow-[inset_0_1px_0_rgba(79,216,255,0.08)]"
            style={{
              borderColor: 'rgba(79,216,255,0.34)',
              background: 'linear-gradient(180deg, rgba(79,216,255,0.08), rgba(8,8,8,0.99) 56%)',
            }}
          >
            <div className="ui-support-mono uppercase tracking-[0.14em] text-[var(--text-support)]">
              Archive selected
            </div>
            <div
              className="mt-2 font-mono text-[1.3rem] font-semibold leading-none"
              style={{ color: 'var(--accent-cyber-blue)' }}
            >
              {formatVersionLabel(versionMismatchPrompt.incomingVersion)}
            </div>
            <div className="ui-support-mono mt-2 text-[var(--text-support)]">
              Install as copy keeps both versions side by side in the library.
            </div>
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <button
            onClick={() => void doAction('replace')}
            disabled={submitting}
            className="h-10 rounded-sm px-4 text-[11px] brand-font font-bold uppercase tracking-[0.18em] transition-all hover:bg-[var(--accent-hover)] hover:shadow-[0_0_18px_rgba(252,238,9,0.14)] disabled:opacity-60"
            style={{
              background: 'var(--accent)',
              color: '#050505',
            }}
          >
            Replace Installed Mod
          </button>
          <button
            onClick={() => void doAction('copy')}
            disabled={submitting}
            className="h-10 rounded-sm border-[0.5px] bg-[var(--bg-base)] px-4 text-[11px] brand-font font-bold uppercase tracking-[0.18em] transition-all hover:bg-[rgba(79,216,255,0.08)] disabled:opacity-60"
            style={{
              borderColor: 'rgba(79,216,255,0.34)',
              color: 'var(--accent-cyber-blue)',
            }}
          >
            Install as Copy
          </button>
        </div>

        <button
          onClick={() => {
            if (submitting) return
            void doAction('skip')
          }}
          disabled={submitting}
          className="mt-3 w-full rounded-sm border-[0.5px] border-[var(--border-default)] py-2 text-[10px] brand-font font-bold uppercase tracking-[0.18em] text-[var(--text-muted)] transition-colors hover:border-[var(--border-strong)] hover:text-[var(--text-primary)] disabled:opacity-60"
        >
          Not Now
        </button>
      </div>
    </div>
  )
}

export default VersionMismatchDialog
