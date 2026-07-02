/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './src/renderer/**/*.{js,ts,jsx,tsx}',
    './src/renderer/index.html'
  ],
  darkMode: 'class',
  theme: {
    extend: {
      fontFamily: {
        headline: ['Syne', 'sans-serif'],
        body:     ['DM Sans', 'sans-serif'],
        label:    ['DM Sans', 'sans-serif'],
        mono:     ['JetBrains Mono', 'Consolas', 'monospace'],
      },
      borderRadius: {
        DEFAULT: '0.125rem',
        lg:      '0.25rem',
        xl:      '0.5rem',
        full:    '0.75rem',
      },
      keyframes: {
        'settings-in': {
          '0%':   { opacity: '0', transform: 'translateY(14px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        'firstrun-glow': {
          '0%, 100%': { opacity: '0.55' },
          '50%':      { opacity: '1' },
        },
      },
      animation: {
        'settings-in': 'settings-in 0.28s ease-out both',
      },
    },
  },
  plugins: []
}

