import { styled } from '@mui/material/styles'
import Button from '@mui/material/Button'
import IconButton from '@mui/material/IconButton'

// Primary — yellow accent, black text
export const PrimaryButton = styled(Button)(() => ({
  background: '#FCEE09',
  color: '#000000',
  fontFamily: '"DM Sans", sans-serif',
  fontWeight: 600,
  fontSize: '0.8125rem',
  letterSpacing: 0,
  textTransform: 'none',
  borderRadius: 6,
  height: 32,
  padding: '0 16px',
  border: 'none',
  transition: 'background 100ms ease, transform 80ms ease',
  '&:hover': {
    background: '#FFF22A'
  },
  '&:active': {
    transform: 'scale(0.98)'
  }
}))

// Secondary — bordered, transparent
export const SecondaryButton = styled(Button)(() => ({
  background: '#101010',
  color: '#F2F2F2',
  fontFamily: '"DM Sans", sans-serif',
  fontWeight: 500,
  fontSize: '0.8125rem',
  letterSpacing: 0,
  textTransform: 'none',
  borderRadius: 6,
  height: 32,
  padding: '0 16px',
  border: 'none',
  transition: 'background 100ms ease, color 100ms ease, transform 80ms ease',
  '&:hover': {
    background: '#1C1C1C',
    color: '#FFFFFF'
  },
  '&:active': {
    transform: 'scale(0.98)'
  }
}))

// Ghost — no border, muted text
export const GhostButton = styled(Button)(() => ({
  background: 'transparent',
  color: 'rgba(242,242,242,0.72)',
  fontFamily: '"DM Sans", sans-serif',
  fontWeight: 500,
  fontSize: '0.8125rem',
  letterSpacing: 0,
  textTransform: 'none',
  borderRadius: 6,
  height: 32,
  padding: '0 12px',
  border: 'none',
  transition: 'background 100ms ease, color 100ms ease, transform 80ms ease',
  '&:hover': {
    background: '#1C1C1C',
    color: '#F2F2F2'
  },
  '&:active': {
    transform: 'scale(0.98)'
  }
}))

// Destructive — red tinted
export const DestructiveButton = styled(Button)(() => ({
  background: 'rgba(248,113,113,0.13)',
  color: '#FF9B9B',
  fontFamily: '"DM Sans", sans-serif',
  fontWeight: 500,
  fontSize: '0.8125rem',
  letterSpacing: 0,
  textTransform: 'none',
  borderRadius: 6,
  height: 32,
  padding: '0 16px',
  border: 'none',
  transition: 'background 100ms ease, color 100ms ease, transform 80ms ease',
  '&:hover': {
    background: '#F87171',
    color: '#190505'
  },
  '&:active': {
    transform: 'scale(0.98)'
  }
}))

// Icon button — refined, no glow
export const SubtleIconButton = styled(IconButton)(() => ({
  color: 'rgba(242,242,242,0.6)',
  borderRadius: 6,
  transition: 'color 100ms ease, background 100ms ease',
  '&:hover': {
    color: '#F2F2F2',
    background: 'rgba(255,255,255,0.06)'
  },
  '&:active': {
    background: 'rgba(255,255,255,0.1)'
  }
}))

// Legacy aliases — keep for any remaining usages, map to new variants
export const CyberButton = PrimaryButton
export const AccentButton = PrimaryButton
export const DangerButton = DestructiveButton
export const GlowIconButton = SubtleIconButton
