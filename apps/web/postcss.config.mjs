/** Tailwind v4 подключается одним плагином PostCSS: отдельного tailwind.config
 *  больше нет — тема и токены живут в CSS (src/styles/tokens.css). */
const config = {
  plugins: {
    '@tailwindcss/postcss': {},
  },
};

export default config;
