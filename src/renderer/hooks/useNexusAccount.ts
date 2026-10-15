import { useEffect, useMemo, useRef, useState } from 'react'
import { IpcService } from '../services/IpcService'
import { IPC } from '@shared/types'
import type { IpcResult, NexusValidateResult } from '@shared/types'
import { translate } from '../i18n/translate'

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

// Validates the account behind either a key the user is typing right now
// (`typedKey`) or, when nothing is typed, the key stored in the main process -
// identified only by its fingerprint `storedKeyId`. The renderer never holds
// the stored key itself.
export function useNexusAccount(
  typedKey: string | undefined,
  storedKeyId: string | undefined,
  debounceMs = 450,
): NexusAccountState {
  const normalizedApiKey = useMemo(() => typedKey?.trim() ?? '', [typedKey])
  const normalizedStoredId = storedKeyId?.trim() ?? ''
  const [state, setState] = useState<NexusAccountState>(NOT_CONFIGURED_STATE)
  const previousTypedKeyRef = useRef(normalizedApiKey)
  const stateRef = useRef(state)
  stateRef.current = state

  useEffect(() => {
    // A just-saved typed key being cleared from the input hands validation over
    // to the stored key (the same account) - re-check silently instead of
    // flashing "checking" over an already-connected account.
    const handingOffToStored = Boolean(previousTypedKeyRef.current) && !normalizedApiKey
      && Boolean(normalizedStoredId) && stateRef.current.status === 'connected'
    previousTypedKeyRef.current = normalizedApiKey

    if (!normalizedApiKey && !normalizedStoredId) {
      setState(NOT_CONFIGURED_STATE)
      return
    }

    let cancelled = false
    const timeoutId = window.setTimeout(async () => {
      if (!handingOffToStored) setState({ status: 'checking', isLoading: true, data: null, error: null })

      try {
        const result = normalizedApiKey
          ? await IpcService.invoke<IpcResult<NexusValidateResult>>(IPC.NEXUS_VALIDATE_KEY, normalizedApiKey)
          : await IpcService.invoke<IpcResult<NexusValidateResult>>(IPC.NEXUS_VALIDATE_KEY)

        if (cancelled) return

        if (result.ok && result.data) {
          setState({ status: 'connected', isLoading: false, data: result.data, error: null })
        } else {
          setState({
            status: 'error',
            isLoading: false,
            data: null,
            error: result.error ?? translate('shell.account.validateFailed'),
          })
        }
      } catch {
        if (cancelled) return
        setState({
          status: 'error',
          isLoading: false,
          data: null,
          error: translate('shell.account.validateFailed'),
        })
      }
    }, debounceMs)

    return () => {
      cancelled = true
      window.clearTimeout(timeoutId)
    }
  }, [debounceMs, normalizedApiKey, normalizedStoredId])

  return state
}
