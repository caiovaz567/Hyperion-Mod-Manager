import React from 'react'
import Box from '@mui/material/Box'
import { useAppStore } from '../../store/useAppStore'
import { getInstallProgressAppearance } from '../../utils/installProgressAppearance'

export const StatusBar: React.FC = () => {
  const { statusMessage, mods, installing, installProgress, installStatus } = useAppStore()
  const enabledCount = mods.filter((m) => m.enabled && m.kind === 'mod').length
  const totalCount = mods.filter((m) => m.kind === 'mod').length
  const installAppearance = getInstallProgressAppearance(installStatus)

  const label = installing
    ? `${installStatus ?? 'Installing...'} ${installProgress > 0 ? `${installProgress}%` : ''}`.trim()
    : (statusMessage || 'Ready')

  return (
    <Box
      sx={{
        height: 26,
        display: 'flex',
        alignItems: 'center',
        px: 2,
        background: '#0A0A0A',
        borderTop: '1px solid rgba(255,255,255,0.06)',
        flexShrink: 0,
        gap: 2
      }}
    >
      {/* Left: status */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, overflow: 'hidden' }}>
        {installing && (
          <Box sx={{ width: 80, height: 2, background: 'rgba(255,255,255,0.08)', borderRadius: 1, flexShrink: 0 }}>
            <Box sx={{
              height: '100%',
              width: `${installProgress}%`,
              background: installAppearance.accent,
              borderRadius: 1,
              boxShadow: `0 0 8px ${installAppearance.accent}66`,
              transition: 'width 0.3s ease'
            }} />
          </Box>
        )}
        <Box component="span" sx={{
          fontSize: '0.72rem',
          fontFamily: '"DM Sans", sans-serif',
          color: installing ? installAppearance.accent : 'rgba(242,242,242,0.58)',
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis'
        }}>
          {label}
        </Box>
      </Box>

      <Box sx={{ flex: 1 }} />

      {/* Right: mod count */}
      <Box component="span" sx={{
        fontSize: '0.72rem',
        fontFamily: '"DM Sans", sans-serif',
        color: 'rgba(242,242,242,0.5)',
        whiteSpace: 'nowrap',
        flexShrink: 0
      }}>
        {enabledCount} active / {totalCount} total
      </Box>
    </Box>
  )
}
