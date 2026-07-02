import React, { useEffect, useState } from 'react'
import { useAppStore } from '../../store/useAppStore'
import { ActionPromptDialog } from './ActionPromptDialog'
import { useTranslation } from '../../i18n/I18nContext'

export const DuplicateInstallDialog: React.FC = () => {
  const { t } = useTranslation()
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
        ...pendingInstallRequest,
        duplicateAction,
        targetModId,
      })

      if (!result.ok || !result.data) {
        addToast(result.error ?? t('dialogs.duplicateInstall.installFailed'), 'error')
        return
      }

      if (result.data.status === 'installed' && result.data.mod) {
        await scanMods({ refreshConflicts: false, refreshModUpdates: false })
        const enableResult = await enableMod(result.data.mod.uuid)
        await scanMods({ immediateConflicts: true, refreshModUpdates: false })
        if (!enableResult.ok) {
          addToast(t('dialogs.duplicateInstall.installedNotActivated', { error: enableResult.error ?? '' }), 'warning')
        } else {
          addToast(t('dialogs.duplicateInstall.installedActivated', { name: result.data.mod.name }), 'success')
        }
      } else if (result.data.status === 'conflict') {
        return
      }
    } finally {
      setSubmitting(false)
    }
  }

  const title = installPrompt.mode === 'reinstall' ? t('dialogs.duplicateInstall.reinstallTitle') : t('dialogs.duplicateInstall.existsTitle')
  const description = installPrompt.mode === 'reinstall'
    ? t('dialogs.duplicateInstall.reinstallDescription', { name: installPrompt.existingModName })
    : t('dialogs.duplicateInstall.existsDescription', { name: installPrompt.incomingModName })
  const detailLabel = installPrompt.mode === 'reinstall' ? t('dialogs.duplicateInstall.reinstallDetailLabel') : t('dialogs.duplicateInstall.existsDetailLabel')

  return (
    <ActionPromptDialog
      tone="accent"
      title={title}
      description={description}
      detailLabel={detailLabel}
      detailValue={installPrompt.existingModName}
      icon="warning"
      primaryLabel={t('dialogs.duplicateInstall.replace')}
      secondaryLabel={t('dialogs.duplicateInstall.installAsCopy')}
      onPrimary={() => handleAction('replace')}
      onSecondary={() => handleAction('copy')}
      onCancel={handleClose}
      submitting={submitting}
    />
  )
}
