import React, { useEffect, useState } from 'react'
import { useAppStore } from '../../store/useAppStore'
import { ActionPromptDialog } from './ActionPromptDialog'

export const DuplicateInstallDialog: React.FC = () => {
  const {
    installPrompt,
    pendingInstallRequest,
    installMod,
    clearInstallPrompt,
    scanMods,
    enableMod,
    addToast,
  } = useAppStore()
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (!installPrompt || !pendingInstallRequest) {
      setSubmitting(false)
    }
  }, [installPrompt, pendingInstallRequest])

  if (!installPrompt || !pendingInstallRequest) {
    return null
  }

  const handleClose = () => {
    if (submitting) return
    setSubmitting(false)
    clearInstallPrompt()
  }

  const handleAction = async (duplicateAction: 'replace' | 'copy') => {
    setSubmitting(true)
    const sourcePath = pendingInstallRequest.filePath
    // Pass targetModId for both actions: 'replace' uses it to identify which mod to remove,
    // 'copy' uses it only for UI progress-row placement (installer ignores it for copy).
    const targetModId = pendingInstallRequest.targetModId
    clearInstallPrompt()

    try {
      const result = await installMod(sourcePath, {
        duplicateAction,
        targetModId,
      })

      if (!result.ok || !result.data) {
        addToast(result.error ?? 'Install failed', 'error')
        return
      }

      if (result.data.status === 'installed' && result.data.mod) {
        await scanMods()
        const enableResult = await enableMod(result.data.mod.uuid)
        if (!enableResult.ok) {
          addToast(`Installed but couldn't activate: ${enableResult.error}`, 'warning')
        } else {
          addToast(`${result.data.mod.name} installed & activated`, 'success')
        }
      } else if (result.data.status === 'conflict') {
        addToast('File conflicts detected during install', 'warning')
      }
    } finally {
      setSubmitting(false)
    }
  }

  const title = installPrompt.mode === 'reinstall' ? 'Reinstall Mod' : 'Mod Already Installed'
  const description = installPrompt.mode === 'reinstall'
    ? `You are about to reinstall ${installPrompt.existingModName} from the original source archive or folder.`
    : `You are installing ${installPrompt.incomingModName}, but Hyperion found an existing module with the same identity in your library.`
  const detailLabel = installPrompt.mode === 'reinstall' ? 'Target mod' : 'Existing mod'

  return (
    <ActionPromptDialog
      accentColor="#fcee09"
      accentGlow="rgba(252,238,9,0.5)"
      title={title}
      description={description}
      detailLabel={detailLabel}
      detailValue={installPrompt.existingModName}
      icon="warning"
      primaryLabel="Replace"
      secondaryLabel="Install as Copy"
      onPrimary={() => handleAction('replace')}
      onSecondary={() => handleAction('copy')}
      onCancel={handleClose}
      submitting={submitting}
    />
  )
}
