import { useEffect, useMemo, useState } from 'react'
import { IpcService } from '../services/IpcService'
import { IPC } from '@shared/types'
import type { IpcResult, NexusValidateResult } from '@shared/types'

export type NexusAccountState =
  | { status: 'not-configured'; isLoading: false; data: null; error: null }
  | { status: 'checking'; isLoading: true; data: null; error: null }
  | { status: 'connected'; isLoading: false; data: NexusValidateResult; error: null }
  | { status: 'error'; isLoading: false; data: null; error: string }

const NOT_CONFIGURED_STATE: NexusAccountState = {
  status: 'not-configured',
  isLoading: false,
  data: null,
  error: null,
}

export function useNexusAccount(apiKey?: string, debounceMs = 450): NexusAccountState {
  const normalizedApiKey = useMemo(() => apiKey?.trim() ?? '', [apiKey])
  const [state, setState] = useState<NexusAccountState>(NOT_CONFIGURED_STATE)

  useEffect(() => {
    if (!normalizedApiKey) {
      setState(NOT_CONFIGURED_STATE)
      return
    }

    let cancelled = false
    const timeoutId = window.setTimeout(async () => {
      setState({ status: 'checking', isLoading: true, data: null, error: null })

      try {
        const result = await IpcService.invoke<IpcResult<NexusValidateResult>>(
          IPC.NEXUS_VALIDATE_KEY,
          normalizedApiKey,
        )

        if (cancelled) return

        if (result.ok && result.data) {
          setState({ status: 'connected', isLoading: false, data: result.data, error: null })
        } else {
          setState({
            status: 'error',
            isLoading: false,
            data: null,
            error: result.error ?? 'Could not validate Nexus account',
          })
        }
      } catch {
        if (cancelled) return
        setState({
          status: 'error',
          isLoading: false,
          data: null,
          error: 'Could not validate Nexus account',
        })
      }
    }, debounceMs)

    return () => {
      cancelled = true
      window.clearTimeout(timeoutId)
    }
  }, [debounceMs, normalizedApiKey])

  return state
}
