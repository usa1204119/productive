/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Single calm accent colour used throughout the UI.
        accent: {
          DEFAULT: "#4f46e5",
          hover: "#4338ca",
        },
      },
    },
  },
  plugins: [],
};
