/** @type {import('postcss').Config} */
const config = {
  plugins: {
    // Tailwind v4 ships its own PostCSS plugin — no autoprefixer needed,
    // Lightning CSS handles vendor prefixing internally.
    "@tailwindcss/postcss": {},
  },
};

export default config;
