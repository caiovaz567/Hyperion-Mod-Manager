import React from 'react'
import Box from '@mui/material/Box'
import Typography from '@mui/material/Typography'
import Chip from '@mui/material/Chip'
import Switch from '@mui/material/Switch'
import type { ModMetadata } from '@shared/types'
import { formatWindowsDateTime } from '../../utils/dateFormat'
import { useAppStore } from '../../store/useAppStore'

interface ModCardProps {
  mod: ModMetadata
  selected: boolean
  onSelect: () => void
  index?: number
}

const TYPE_COLORS: Record<string, string> = {
  archive:   '#00b4ff',
  redmod:    '#00ffcc',
  cet:       '#e0f4ff',
  redscript: '#4dc8ff',
  tweakxl:   '#80d8ff',
  red4ext:   '#ff5533',
  bin:       '#607d8b',
  engine:    '#9c88ff',
  r6:        '#00b4ff',
  unknown:   '#455a64'
}

export const ModCard: React.FC<ModCardProps> = ({ mod, selected, onSelect, index = 0 }) => {
  const { enableMod, disableMod, addToast } = useAppStore()
  const typeColor = TYPE_COLORS[mod.type] ?? '#455a64'
  const delay = `${(index % 16) * 0.04}s`

  if (mod.kind === 'separator') {
    return (
      <Box
        sx={{
          gridColumn: '1 / -1',
          display: 'flex', alignItems: 'center', gap: 1.5,
          py: 0.75, cursor: 'pointer'
        }}
        onClick={onSelect}
      >
        <Box sx={{ flex: 1, height: 1, background: 'linear-gradient(90deg, transparent, rgba(0,180,255,0.2))' }} />
        <Typography sx={{
          color: 'rgba(0,180,255,0.4)',
          fontFamily: '"Orbitron", monospace',
          fontSize: '0.52rem',
          letterSpacing: '0.25em',
          textTransform: 'uppercase'
        }}>
          {mod.name}
        </Typography>
        <Box sx={{ flex: 1, height: 1, background: 'linear-gradient(90deg, rgba(0,180,255,0.2), transparent)' }} />
      </Box>
    )
  }

  const handleToggle = async (e: React.ChangeEvent<HTMLInputElement>) => {
    e.stopPropagation()
    const result = e.target.checked
      ? await enableMod(mod.uuid)
      : await disableMod(mod.uuid)
    if (!result.ok) addToast(result.error ?? 'Operation failed', 'error')
  }

  return (
    <Box
      onClick={onSelect}
      className="tron-slide-in"
      sx={{
        animationDelay: delay,
        cursor: 'pointer',
        userSelect: 'none',
        background: 'rgba(0,6,14,0.9)',
        border: selected
          ? `1px solid ${typeColor}`
          : '1px solid rgba(0,180,255,0.07)',
        borderTop: selected
          ? `2px solid ${typeColor}`
          : `2px solid ${typeColor}44`,
        display: 'flex', flexDirection: 'column',
        p: 1.5, gap: 0.75, minHeight: 140,
        position: 'relative', overflow: 'hidden',
        transition: 'border-color 0.15s, box-shadow 0.15s',
        boxShadow: selected
          ? `0 0 18px ${typeColor}28, inset 0 0 18px ${typeColor}06`
          : 'none',
        '&:hover': {
          border: selected
            ? `1px solid ${typeColor}`
            : '1px solid rgba(0,180,255,0.2)',
          borderTop: selected
            ? `2px solid ${typeColor}`
            : `2px solid ${typeColor}88`,
          boxShadow: selected
            ? `0 0 18px ${typeColor}28`
            : '0 0 10px rgba(0,180,255,0.08)'
        }
      }}
    >
      {/* Selected highlight line */}
      {selected && (
        <Box sx={{
          position: 'absolute',
          top: 0, left: 0, right: 0, height: 1,
          background: `linear-gradient(90deg, transparent, ${typeColor}, transparent)`,
          boxShadow: `0 0 8px ${typeColor}`
        }} />
      )}

      {/* Top row: type chip + status dot */}
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <Chip
          label={mod.type.toUpperCase()}
          size="small"
          sx={{
            height: 16,
            fontSize: '0.5rem',
            letterSpacing: '0.08em',
            background: `${typeColor}16`,
            color: typeColor,
            border: `1px solid ${typeColor}30`,
            borderRadius: 1
          }}
        />
        <Box sx={{
          width: 8, height: 8,
          borderRadius: '50%',
          background: mod.enabled ? '#00ffcc' : 'rgba(0,180,255,0.15)',
          boxShadow: mod.enabled ? '0 0 6px rgba(0,255,200,0.9)' : 'none',
          flexShrink: 0,
          transition: 'all 0.25s'
        }} />
      </Box>

      {/* Mod name */}
      <Typography sx={{
        color: mod.enabled ? '#e0f4ff' : 'rgba(180,210,230,0.45)',
        fontFamily: '"Share Tech Mono", monospace',
        fontSize: '0.82rem',
        fontWeight: 600,
        letterSpacing: '0.02em',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
        textShadow: mod.enabled ? `0 0 10px ${typeColor}50` : 'none',
        lineHeight: 1.3,
        transition: 'all 0.2s'
      }}>
        {mod.name}
      </Typography>

      {/* Author */}
      <Typography sx={{
        color: 'rgba(0,180,255,0.35)',
        fontFamily: '"Share Tech Mono", monospace',
        fontSize: '0.62rem',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
        minHeight: '0.62rem',
        lineHeight: 1.2
      }}>
        {mod.author ?? ''}
      </Typography>

      <Box sx={{ flex: 1 }} />

      {/* Bottom row: date + order + toggle */}
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mt: 0.25 }}>
        <Typography sx={{
          color: 'rgba(0,180,255,0.22)',
          fontFamily: '"Share Tech Mono", monospace',
          fontSize: '0.58rem'
        }}>
          {formatWindowsDateTime(mod.installedAt)}
        </Typography>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.25 }}>
          <Typography sx={{
            color: typeColor,
            fontFamily: '"Orbitron", monospace',
            fontSize: '0.58rem',
            fontWeight: 700,
            opacity: 0.8
          }}>
            #{mod.order}
          </Typography>
          <Switch
            size="small"
            checked={mod.enabled}
            onChange={handleToggle}
            onClick={(e) => e.stopPropagation()}
            sx={{
              '& .MuiSwitch-switchBase.Mui-checked': { color: typeColor },
              '& .MuiSwitch-switchBase.Mui-checked + .MuiSwitch-track': {
                backgroundColor: `${typeColor}55`
              }
            }}
          />
        </Box>
      </Box>
    </Box>
  )
}
