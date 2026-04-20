import { useEffect, useState } from 'react'
import { IpcService } from '../services/IpcService'
import { IPC } from '@shared/types'

export function useAppVersion(): string {
  const [appVersion, setAppVersion] = useState('—')

  useEffect(() => {
    IpcService.invoke<string>(IPC.GET_APP_VERSION)
      .then((version) => setAppVersion(version || '—'))
      .catch(() => setAppVersion('—'))
  }, [])

  return appVersion
}
