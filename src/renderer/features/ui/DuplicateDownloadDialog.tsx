import React, { useState } from 'react'
import { useAppStore } from '../../store/useAppStore'
import { ActionPromptDialog } from './ActionPromptDialog'
import { useTranslation } from '../../i18n/I18nContext'

export const DuplicateDownloadDialog: React.FC = () => {
  const { t } = useTranslation()
  const {
    duplicateDownloadPrompt,
    confirmDuplicateDownload,
    clearDuplicateDownloadPrompt,
  } = useAppStore((state) => ({
    duplicateDownloadPrompt: state.duplicateDownloadPrompt,
    confirmDuplicateDownload: state.confirmDuplicateDownload,
    clearDuplicateDownloadPrompt: state.clearDuplicateDownloadPrompt,
  }))
  const [submitting, setSubmitting] = useState(false)

  if (!duplicateDownloadPrompt) {
    return null
  }

  const handleClose = () => {
    if (submitting) return
    clearDuplicateDownloadPrompt()
  }

  const handleConfirm = async () => {
    setSubmitting(true)
    try {
      await confirmDuplicateDownload()
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <ActionPromptDialog
      tone="accent"
      title={duplicateDownloadPrompt.existingIsDownloading ? t('dialogs.duplicateDownload.titleDownloading') : t('dialogs.duplicateDownload.titleExists')}
      description={
        duplicateDownloadPrompt.existingIsDownloading
          ? t('dialogs.duplicateDownload.descriptionDownloading')
          : t('dialogs.duplicateDownload.descriptionExists')
      }
      icon="warning"
      primaryLabel={t('dialogs.duplicateDownload.downloadAgain')}
      onPrimary={() => void handleConfirm()}
      onCancel={handleClose}
      submitting={submitting}
      detailContent={
        <div className="px-4 py-4">
          <div className="space-y-4">
            <div>
              <div className="ui-support-mono uppercase tracking-[0.18em]">
                {duplicateDownloadPrompt.existingIsDownloading ? t('dialogs.duplicateDownload.labelDownloading') : t('dialogs.duplicateDownload.labelExisting')}
              </div>
              <div className="mt-2 break-words text-[15px] font-medium tracking-[0.01em] text-[var(--text-primary)]">
                {duplicateDownloadPrompt.existingFileName}
              </div>
            </div>
            <div className="h-px w-full bg-[var(--bg-subtle)]" />
            <div>
              <div className="ui-support-mono uppercase tracking-[0.18em]">{t('dialogs.duplicateDownload.newName')}</div>
              <div className="mt-2 break-words text-[15px] font-medium tracking-[0.01em] text-[var(--accent)]">
                {duplicateDownloadPrompt.incomingFileName}
              </div>
            </div>
          </div>
        </div>
      }
    />
  )
}
