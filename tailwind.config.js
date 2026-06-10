/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'sans-serif'],
      },
      colors: {
        brand:    { DEFAULT: '#6366f1', dark: '#4f46e5' },
        surface:  '#0f1729',
        critical: '#ef4444',
        warning:  '#f59e0b',
        success:  '#10b981',
      },
      borderRadius: {
        sm: '8px',
        md: '12px',
        lg: '16px',
      },
      boxShadow: {
        card:       '0 2px 12px rgba(0,0,0,0.08)',
        'card-hover': '0 8px 24px rgba(99,102,241,0.15)',
      },
    },
  },
  plugins: [],
};
