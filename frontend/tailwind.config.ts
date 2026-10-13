import type { Config } from 'tailwindcss';

// Theme: near-black surfaces, neon green = success / active / Mongo-affected, purple = graph, agents, highlights.
const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: {
          950: '#050507',
          900: '#0a0a0f',
          800: '#101018',
          700: '#1a1a25',
          600: '#2a2a3a',
          500: '#3f3f55',
        },
        neon: {
          DEFAULT: '#22ff88',
          dim: '#14b85f',
          faint: 'rgba(34,255,136,0.12)',
        },
        violet: {
          DEFAULT: '#a855f7',
          soft: '#c4b5fd',
          faint: 'rgba(168,85,247,0.14)',
        },
      },
      fontFamily: {
        sans: ['ui-sans-serif', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'Consolas', 'monospace'],
      },
      boxShadow: {
        neon: '0 0 0 1px rgba(34,255,136,0.55), 0 0 18px rgba(34,255,136,0.18)',
        violet: '0 0 0 1px rgba(168,85,247,0.55), 0 0 18px rgba(168,85,247,0.2)',
      },
    },
  },
  plugins: [],
};

export default config;
