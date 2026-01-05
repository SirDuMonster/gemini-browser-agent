/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./src/**/*.{js,jsx,ts,tsx}",
    "./src/**/*.html",
  ],
  theme: {
    extend: {
      colors: {
        'agent-primary': '#6366f1',
        'agent-secondary': '#8b5cf6',
        'agent-success': '#10b981',
        'agent-error': '#ef4444',
        'agent-warning': '#f59e0b',
      },
    },
  },
  plugins: [],
  darkMode: 'class',
}
