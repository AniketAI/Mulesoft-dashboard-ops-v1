/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', '-apple-system', 'sans-serif'],
        mono: ['JetBrains Mono', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
      colors: {
        mule: {
          50: '#f0f9ff',
          100: '#e0f2fe',
          200: '#bae6fd',
          300: '#7dd3fc',
          400: '#38bdf8',
          500: '#0ea5e9',
          600: '#0284c7',
          700: '#0369a1',
          800: '#075985',
          900: '#0c4a6e'
        },
        // ── Salesforce Lightning Design System brand palette ──────────────
        // sf      = Brand Blue   (primary actions, links, focus states)
        // sfteal  = Teal         (info / ping / secondary actions)
        // sfgreen = Success Green(running status, start action, production)
        // sfpurple= Purple       (export / CH1 tag / in-progress states)
        // sforange= Warning Orange (sandbox, partial/pending states)
        // sfred   = Error Red    (stop action, failures, destructive)
        sf: {
          50: '#eff8ff', 100: '#d9efff', 200: '#b3dfff', 300: '#7cc3fa',
          400: '#4fb0f6', 500: '#1b96ff', 600: '#0176d3', 700: '#014486',
          800: '#032d60', 900: '#001639', 950: '#000d1f'
        },
        sfteal: {
          50: '#e9fbf8', 100: '#c9f3ec', 200: '#94e6da', 300: '#5ed9c6',
          400: '#2bc2b9', 500: '#0b827c', 600: '#096a66', 700: '#07504d',
          800: '#053b39', 900: '#032726', 950: '#021a19'
        },
        sfgreen: {
          50: '#e9f8ef', 100: '#c8edd5', 200: '#92dcae', 300: '#5ecb8c',
          400: '#45c65a', 500: '#2e8a4a', 600: '#04844b', 700: '#04663b',
          800: '#034d2d', 900: '#02331e', 950: '#011f13'
        },
        sfpurple: {
          50: '#f5edfb', 100: '#e4cdf4', 200: '#c99bea', 300: '#ae6adf',
          400: '#9a56d4', 500: '#8e4ec6', 600: '#7638ab', 700: '#5c2c87',
          800: '#432063', 900: '#2b1440', 950: '#1a0c28'
        },
        sforange: {
          50: '#fff4e8', 100: '#ffe3c2', 200: '#ffc98a', 300: '#feac56',
          400: '#fe9339', 500: '#dd7a01', 600: '#b56301', 700: '#8c4d01',
          800: '#633601', 900: '#3f2200', 950: '#241400'
        },
        sfred: {
          50: '#fdecee', 100: '#fbd0d4', 200: '#f49aa3', 300: '#ea6873',
          400: '#e0394a', 500: '#ba0517', 600: '#950412', 700: '#74030e',
          800: '#52020a', 900: '#330106', 950: '#1f0003'
        }
      }
    }
  },
  plugins: []
};