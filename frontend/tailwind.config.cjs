/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: 'class',
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        navy: {
          950: '#070B16',
          900: '#080D1A',
          850: '#0B132B',
          800: '#0E1726',
          750: '#111A30',
          700: '#16223F',
          600: '#1F2E54',
        },
      },
      boxShadow: {
        'cyan-glow': '0 0 20px -5px rgba(0, 242, 254, 0.35)',
        'cyan-glow-sm': '0 0 10px -2px rgba(0, 242, 254, 0.25)',
        'emerald-glow-sm': '0 0 10px -2px rgba(16, 185, 129, 0.25)',
      },
    },
  },
  plugins: [],
}
