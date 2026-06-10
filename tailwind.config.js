/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        // Stock Market Theme
        primary: '#52c49a',       // Soft emerald (bullish)
        secondary: '#0a0a0a',     // Pure black
        danger: '#ef4444',        // Red (bearish)
        success: '#52c49a',       // Green
        warning: '#f59e0b',       // Amber

        // Custom stock colors
        bullish: '#52c49a',       // Green for positive
        bearish: '#ef4444',       // Red for negative

        // Dark theme colors - Pure Black
        dark: {
          100: '#0a0a0a',
          200: '#080808',
          300: '#000000',
          400: '#111111',
          500: '#1a1a1a',
        },

        // Surface colors
        surface: '#0a0a0a',
        'surface-light': '#111111',

        // Accent colors
        accent: {
          green: '#52c49a',
          red: '#dc2626',
          gold: '#fbbf24',
        }
      },
      backgroundImage: {
        'gradient-radial': 'radial-gradient(var(--tw-gradient-stops))',
        'stock-gradient': '#000000',
        'bullish-gradient': 'linear-gradient(135deg, #047857 0%, #52c49a 100%)',
        'bearish-gradient': 'linear-gradient(135deg, #7f1d1d 0%, #ef4444 100%)',
      },
      boxShadow: {
        'glow-green': '0 0 20px rgba(52, 196, 154, 0.22)',
        'glow-red': '0 0 20px rgba(239, 68, 68, 0.3)',
        'glow-gold': '0 0 20px rgba(251, 191, 36, 0.3)',
      },
      animation: {
        'pulse-slow': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
      }
    },
  },
  plugins: [],
}
