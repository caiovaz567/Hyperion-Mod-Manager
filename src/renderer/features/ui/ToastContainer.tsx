import React from 'react'
import { ToastProvider } from '@heroui/react'
import { hyperionToastQueue } from './toastQueue'

// Real HeroUI toasts: the store's addToast pushes into the shared queue
// (toastQueue.ts) and this provider renders HeroUI's default toast layout
// (variant indicator + title + close button) bottom-right, stacked.
export const ToastContainer: React.FC = () => (
  <ToastProvider queue={hyperionToastQueue} placement="bottom end" width={420} />
)
