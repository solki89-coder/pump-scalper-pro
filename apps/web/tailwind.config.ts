import type { Config } from 'tailwindcss';

const config: Config = {
  darkMode: 'class',
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        background: '#0a0b0f',
        surface: '#12141a',
        'surface-hover': '#181b23',
        border: '#22252e',
        foreground: '#e8e9ec',
        muted: '#8b8f9c',
        accent: '#7c5cff',
        positive: '#22c55e',
        negative: '#ef4444',
        warning: '#f59e0b',
      },
      borderRadius: {
        lg: '0.75rem',
      },
    },
  },
  plugins: [],
};

export default config;
