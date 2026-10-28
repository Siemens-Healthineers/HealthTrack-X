/** @type {import('tailwindcss').Config} */
export default {
  darkMode: ["class"],
  content: {
    relative: true,
    files: ['./src/**/*.{ts,tsx}'],
  },
  prefix: "",
  theme: {
    container: {
      center: true,
      padding: "2rem",
      screens: {
        "2xl": "1400px",
      },
    },
    extend: {
      colors: {
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
      keyframes: {
        "accordion-down": {
          from: { height: "0" },
          to: { height: "var(--radix-accordion-content-height)" },
        },
        "accordion-up": {
          from: { height: "var(--radix-accordion-content-height)" },
          to: { height: "0" },
        },
        "flow-right": {
          "0%": { left: "-12px", opacity: "0" },
          "10%": { opacity: "1" },
          "90%": { opacity: "1" },
          "100%": { left: "100%", opacity: "0" },
        },
        "flow-left": {
          "0%": { right: "-12px", opacity: "0" },
          "10%": { opacity: "1" },
          "90%": { opacity: "1" },
          "100%": { right: "100%", opacity: "0" },
        },
        "spin-slow": {
          "0%": { transform: "rotate(0deg)" },
          "100%": { transform: "rotate(360deg)" },
        },
        "spin-reverse": {
          "0%": { transform: "rotate(0deg)" },
          "100%": { transform: "rotate(-360deg)" },
        },
        "pulse-glow": {
          "0%, 100%": { opacity: "0.6", transform: "scale(1)" },
          "50%": { opacity: "1", transform: "scale(1.04)" },
        },
        "float-1": {
          "0%, 100%": { transform: "translate(0, 0)" },
          "33%": { transform: "translate(6px, -5px)" },
          "66%": { transform: "translate(-5px, 4px)" },
        },
        "float-2": {
          "0%, 100%": { transform: "translate(0, -50%)" },
          "33%": { transform: "translate(5px, calc(-50% + 6px))" },
          "66%": { transform: "translate(-4px, calc(-50% - 5px))" },
        },
      },
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
        "flow-right": "flow-right 2s linear infinite",
        "flow-right-delayed": "flow-right 2s linear 1s infinite",
        "flow-left": "flow-left 2s linear infinite",
        "flow-left-delayed": "flow-left 2s linear 1s infinite",
        "spin-slow": "spin-slow 12s linear infinite",
        "spin-reverse": "spin-reverse 8s linear infinite",
        "pulse-glow": "pulse-glow 3s ease-in-out infinite",
        "float-1": "float-1 7s ease-in-out infinite",
        "float-2": "float-2 9s ease-in-out infinite",
        "float-3": "float-1 8s ease-in-out -1.2s infinite",
        "float-4": "float-1 6.5s ease-in-out -2.0s infinite",
        "float-5": "float-1 8.5s ease-in-out -0.6s infinite",
        "float-6": "float-1 7.5s ease-in-out -3.0s infinite",
        "float-7": "float-1 9.5s ease-in-out -4.5s infinite",
      },
    },
  },
  plugins: [require("tailwindcss-animate"), require("@tailwindcss/typography")],
}
