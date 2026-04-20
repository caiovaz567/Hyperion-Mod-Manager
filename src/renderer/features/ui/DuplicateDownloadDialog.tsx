import React, { useState } from 'react'
import { useAppStore } from '../../store/useAppStore'
import { ActionPromptDialog } from './ActionPromptDialog'

export const DuplicateDownloadDialog: React.FC = () => {
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
      accentColor="#fcee09"
      accentGlow="rgba(252,238,9,0.5)"
      title={duplicateDownloadPrompt.existingIsDownloading ? 'File Already Downloading' : 'File Already Exists'}
      description={
        duplicateDownloadPrompt.existingIsDownloading
          ? 'Hyperion is already downloading this archive right now. If you continue, the new request will be saved as a separate copy so both downloads can finish without colliding.'
          : 'Hyperion found this file in your downloads folder already. If you continue, the new download will be saved as a separate copy with a clear duplicate label.'
      }
      icon="warning"
      primaryLabel="Download Again"
      onPrimary={() => void handleConfirm()}
      onCancel={handleClose}
      submitting={submitting}
      detailContent={
        <div className="px-4 py-4">
          <div className="space-y-4">
            <div>
              <div className="ui-support-mono uppercase tracking-[0.18em]">
                {duplicateDownloadPrompt.existingIsDownloading ? 'Archive downloading now' : 'Existing archive'}
              </div>
              <div className="mt-2 break-words text-sm font-medium tracking-[0.01em] text-white">
                {duplicateDownloadPrompt.existingFileName}
              </div>
            </div>
            <div className="h-px w-full bg-[#1d1d1d]" />
            <div>
              <div className="ui-support-mono uppercase tracking-[0.18em]">New archive name</div>
              <div className="mt-2 break-words text-sm font-medium tracking-[0.01em] text-[#fcee09]">
                {duplicateDownloadPrompt.incomingFileName}
              </div>
            </div>
          </div>
        </div>
      }
    />
  )
}
