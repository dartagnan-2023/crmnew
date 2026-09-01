/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{js,jsx,ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        display: ['"Inter"', 'system-ui', 'sans-serif'],
        body: ['"Inter"', 'system-ui', 'sans-serif'],
      },
      colors: {
        // Deep Ocean Professional. A cor primaria e a #006194:
        // medida em contraste WCAG, a #0284C7 citada na prosa do DESIGN.md
        // reprova (4,10:1 para texto branco no botao, minimo 4,5).
        brand: {
          50: '#eaf2f9',
          100: '#cce5ff',
          200: '#93ccff',
          300: '#7bc2ff',
          400: '#007bb9',
          500: '#00719f',
          600: '#006194',
          700: '#004b73',
          800: '#003a5a',
          900: '#001d31',
        },
        surface: '#f7f9ff',
        'surface-card': '#ffffff',
        'surface-low': '#f1f4fa',
        'surface-mid': '#ebeef4',
        'surface-high': '#e5e8ee',
        ink: '#181c20',
        'ink-soft': '#3f4850',
        'ink-faint': '#707881',
        line: '#bfc7d2',
      },
      boxShadow: {
        card: '0 1px 2px rgba(0,97,148,.06), 0 1px 4px rgba(0,97,148,.06)',
        lift: '0 4px 12px rgba(0,97,148,.10)',
      },
    },
  },
  plugins: [],
};
