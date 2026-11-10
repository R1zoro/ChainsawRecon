/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        bg: '#0D1015',
        surface: {
          DEFAULT: '#151A22',
          2: '#1B222C',
        },
        border: {
          DEFAULT: '#222A35',
        },
        text: {
          DEFAULT: '#D5DCE5',
          muted: '#8390A2',
        },
        accent: {
          DEFAULT: '#53A8D9',
          hover: '#68B6E3',
        },
        success: {
          DEFAULT: '#3FB950',
        },
        warning: {
          DEFAULT: '#D29922',
        },
        danger: {
          DEFAULT: '#F85149',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'sans-serif'],
        mono: ['JetBrains Mono', 'Menlo', 'Monaco', 'Courier New', 'monospace'],
      },
    },
  },
  plugins: [],
};
