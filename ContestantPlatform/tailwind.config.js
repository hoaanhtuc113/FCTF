/** @type {import('tailwindcss').Config} */
import typography from "@tailwindcss/typography";
export const content = ["./src/**/*.{js,jsx,ts,tsx}"];

export const theme = {
  extend: {
    colors: {
      primary: "#00000", // thay màu này bằng màu bạn muốn cho primary
      secondary: "#c3ba9a", // thay màu này bằng màu bạn muốn cho secondary
      "theme-color-primary": "#c3ba9a",
      "theme-color-primary-dark": "#cc5200",
      "theme-color-secondary": "#fdfefe",
      "theme-color-secondary-dark": "#fdfefe",
      "theme-color-gray": "#838181",
      "theme-text-color-darkOrange": "#FF9D3D",
    },
    fontFamily: {
      sans: ["Inter", "ui-sans-serif", "system-ui"],
      serif: ["Merriweather", "serif"],
      primary: ["Roboto", "sans-serif", "monospace"],
    },
    typography: (theme) => ({
      white: {
        css: {
          color: theme('colors.white'),
          a: { color: theme('colors.white') },
          strong: { color: theme('colors.white') },
          'ul > li::before': { backgroundColor: theme('colors.white') },
          code: { color: theme('colors.white') },
          h1: { color: theme('colors.white') },
          h2: { color: theme('colors.white') },
          h3: { color: theme('colors.white') },
          blockquote: { color: theme('colors.white') },
          li: {
            color: theme('colors.white'),}
        },
      },
    })
  },
};
export const plugins = [typography];
