import type { Config } from 'tailwindcss'

const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        brand: {
          50: '#eef7ff',
          100: '#d9edff',
          200: '#bce0ff',
          300: '#8ecdff',
          400: '#59b0ff',
          500: '#338eff',
          600: '#1b6ef5',
          700: '#1457e1',
          800: '#1747b6',
          900: '#193f8f',
          950: '#142857',
        },
        maldives: {
          sky: '#00a6a6',
          coral: '#f4633a',
          sand: '#f7f3ec',
          deep: '#0e1c2b',
        },
      },
      fontFamily: {
        sans: ['system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'],
        thaana: ['"Faruma"', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
}
export default config
