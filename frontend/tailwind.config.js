/** @type {import('tailwindcss').Config} */

// As cores sao servidas por variaveis CSS para que o modo escuro seja uma troca
// de valores em index.css, e nao uma segunda classe em cada elemento. O formato
// "R G B" (canais separados por espaco) e o que permite o <alpha-value>, ou seja,
// e o que mantem funcionando os usos com opacidade como bg-risk/25 e bg-ok/60.
// O segundo argumento e o valor de reserva (a paleta clara). Ele existe porque
// este arquivo e o index.css moram em pastas diferentes e sao publicados em
// commits separados: se este chegar primeiro, a reserva mantem o sistema
// identico ao que ja estava no ar, em vez de deixar as variaveis indefinidas
// e derrubar todas as cores ate o proximo deploy.
const v = (name, reserva) => `rgb(var(${name}, ${reserva}) / <alpha-value>)`;

module.exports = {
  content: ['./src/**/*.{js,jsx,ts,tsx}'],
  // O tema e resolvido em JS e estampado como data-theme no <html>. Assim o CSS
  // precisa de um bloco claro e um escuro, sem duplicar a paleta numa media query.
  darkMode: ['class', '[data-theme="dark"]'],
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
          50: v('--c-brand-50', '234 242 249'),
          100: v('--c-brand-100', '204 229 255'),
          200: v('--c-brand-200', '147 204 255'),
          300: v('--c-brand-300', '123 194 255'),
          400: v('--c-brand-400', '0 123 185'),
          500: v('--c-brand-500', '0 113 159'),
          600: v('--c-brand-600', '0 97 148'),
          700: v('--c-brand-700', '0 75 115'),
          800: v('--c-brand-800', '0 58 90'),
          900: v('--c-brand-900', '0 29 49'),
          // 'ink' e a marca usada como TEXTO ou link, nao como preenchimento.
          // Os dois papeis puxam para lados opostos no escuro: o preenchimento
          // precisa ficar escuro para o texto branco em cima continuar legivel,
          // e o texto precisa clarear para ser legivel sobre o fundo escuro.
          ink: v('--c-brand-ink', '0 97 148'),
        },
        surface: v('--c-surface', '247 249 255'),
        'surface-card': v('--c-surface-card', '255 255 255'),
        'surface-low': v('--c-surface-low', '241 244 250'),
        'surface-mid': v('--c-surface-mid', '235 238 244'),
        'surface-high': v('--c-surface-high', '229 232 238'),
        ink: v('--c-ink', '24 28 32'),
        'ink-soft': v('--c-ink-soft', '63 72 80'),
        'ink-faint': v('--c-ink-faint', '102 109 117'),
        line: v('--c-line', '191 199 210'),
        // Estados semanticos. Cada trio (fundo / borda / tinta) foi conferido
        // nos DOIS temas: texto sobre o fundo >= 4,5:1, e o fundo se distingue
        // da pagina >= 1,15:1.
        info: v('--c-info', '211 230 245'), 'info-line': v('--c-info-line', '156 198 230'), 'info-ink': v('--c-info-ink', '0 75 115'),
        ok: v('--c-ok', '207 233 218'), 'ok-line': v('--c-ok-line', '147 205 176'), 'ok-ink': v('--c-ok-ink', '11 107 69'),
        warn: v('--c-warn', '255 227 196'), 'warn-line': v('--c-warn-line', '240 195 147'), 'warn-ink': v('--c-warn-ink', '107 59 0'),
        risk: v('--c-risk', '255 217 212'), 'risk-line': v('--c-risk-line', '242 179 171'), 'risk-ink': v('--c-risk-ink', '147 0 10'),
      },
      boxShadow: {
        card: '0 1px 2px rgb(var(--c-shadow, 0 97 148) / 0.06), 0 1px 4px rgb(var(--c-shadow, 0 97 148) / 0.06)',
        lift: '0 4px 12px rgb(var(--c-shadow, 0 97 148) / 0.10)',
      },
    },
  },
  plugins: [],
};
