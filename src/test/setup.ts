import "@testing-library/jest-dom/vitest";

Object.defineProperty(navigator, "languages", { configurable: true, get: () => ["fr-CH"] });
