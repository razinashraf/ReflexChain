import type { Config } from 'tailwindcss';

/**
 * Deliberately narrow palette. The whole interface is meant to read as an
 * infrastructure console that takes itself extremely seriously, so: near-black
 * ground, one cyan for the network, one amber for consensus, one red for
 * integrity failures, and nothing decorative.
 */
const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}', './lib/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: {
          900: '#05070a',
          800: '#080b11',
          700: '#0c1119',
          600: '#111823',
          500: '#18202e',
          400: '#242e3f',
        },
        signal: {
          cyan: '#22d3ee',
          dim: '#0e7490',
        },
        consensus: {
          amber: '#fbbf24',
          dim: '#92400e',
        },
        live: {
          green: '#34d399',
          dim: '#065f46',
        },
        fail: {
          red: '#f43f5e',
          dim: '#881337',
        },
        muted: {
          DEFAULT: '#64748b',
          bright: '#94a3b8',
        },
      },
      fontFamily: {
        mono: [
          'ui-monospace',
          'SFMono-Regular',
          'JetBrains Mono',
          'Menlo',
          'Consolas',
          'monospace',
        ],
      },
      fontSize: {
        '2xs': ['0.625rem', { lineHeight: '0.875rem' }],
      },
      animation: {
        'pulse-fast': 'pulse 1s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'slide-in': 'slide-in 220ms ease-out',
        scan: 'scan 2.4s linear infinite',
      },
      keyframes: {
        'slide-in': {
          '0%': { opacity: '0', transform: 'translateY(-4px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        scan: {
          '0%': { transform: 'translateY(-100%)' },
          '100%': { transform: 'translateY(100%)' },
        },
      },
    },
  },
  plugins: [],
};

export default config;
