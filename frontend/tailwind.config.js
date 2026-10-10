/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
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

        // Brand accent (pavo lime-green)
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
        navy: 'rgb(var(--navy) / <alpha-value>)',
      },
      borderRadius: {
        xl2: '14px',
      },
      boxShadow: {
        card: '0 1px 2px rgba(17,17,17,.04)',
        soft: '0 18px 40px -28px rgba(17,17,17,.35)',
        lift: '0 24px 56px -30px rgba(17,17,17,.45)',
        glow: '0 0 0 1px rgb(var(--acc) / .45), 0 12px 34px -12px rgb(var(--acc) / .5)',
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
          from: { opacity: '0', transform: 'translateY(6px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        float: {
          '0%, 100%': { transform: 'translateY(0) rotate(0deg)' },
          '50%': { transform: 'translateY(-14px) rotate(6deg)' },
        },
        shimmer: {
          '0%': { backgroundPosition: '-200% 0' },
          '100%': { backgroundPosition: '200% 0' },
        },
      },
      animation: {
        'fade-in': 'fade-in .3s ease-out',
        float: 'float 9s ease-in-out infinite',
        shimmer: 'shimmer 2s linear infinite',
      },
    },
  },
  plugins: [],
}
