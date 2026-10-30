/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Monochrome core (Figma brand language)
        canvas: 'rgb(var(--canvas) / <alpha-value>)',
        soft: 'rgb(var(--soft) / <alpha-value>)',
        line: 'rgb(var(--line) / <alpha-value>)',
        ink: 'rgb(var(--ink) / <alpha-value>)',
        dim: 'rgb(var(--dim) / <alpha-value>)',

        // Accent = ink
        acc: 'rgb(var(--acc) / <alpha-value>)',
        acc2: 'rgb(var(--acc2) / <alpha-value>)',

        // Semantic
        ok: 'rgb(var(--ok) / <alpha-value>)',
        warn: 'rgb(var(--warn) / <alpha-value>)',
        err: 'rgb(var(--err) / <alpha-value>)',

        // Pastel color-block palette
        lime: 'rgb(var(--lime) / <alpha-value>)',
        mint: 'rgb(var(--mint) / <alpha-value>)',
        cream: 'rgb(var(--cream) / <alpha-value>)',
        lilac: 'rgb(var(--lilac) / <alpha-value>)',
        pink: 'rgb(var(--pink) / <alpha-value>)',
        coral: 'rgb(var(--coral) / <alpha-value>)',
        aqua: 'rgb(var(--aqua) / <alpha-value>)',
        navy: 'rgb(var(--navy) / <alpha-value>)',
      },
      boxShadow: {
        card: '0 1px 2px rgba(0,0,0,.04)',
        soft: '0 8px 24px -16px rgba(0,0,0,.3)',
        lift: '0 18px 48px -24px rgba(0,0,0,.35)',
      },
      fontFamily: {
        sans: [
          'Inter',
          'system-ui',
          '-apple-system',
          'Segoe UI',
          'Microsoft YaHei',
          'sans-serif',
        ],
        mono: [
          'ui-monospace',
          'JetBrains Mono',
          'SFMono-Regular',
          'Menlo',
          'Consolas',
          'monospace',
        ],
      },
      keyframes: {
        'fade-in': {
          from: { opacity: '0' },
          to: { opacity: '1' },
        },
        rise: {
          from: { opacity: '0', transform: 'translateY(6px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        indeterminate: {
          '0%': { transform: 'translateX(-100%)' },
          '100%': { transform: 'translateX(300%)' },
        },
      },
      animation: {
        'fade-in': 'fade-in .2s ease-out',
        rise: 'rise .24s cubic-bezier(.22,1,.36,1) both',
        indeterminate: 'indeterminate 1.4s ease-in-out infinite',
      },
    },
  },
  plugins: [],
}
