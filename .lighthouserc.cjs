const isCI = process.env.CI === "true";

// In CI the full Docker stack is already running on port 5487 (production build).
// Locally, LHCI starts the Next.js dev server on port 3000.
const baseUrl = isCI ? "http://localhost:5487" : "http://localhost:3000";

module.exports = {
  ci: {
    collect: {
      url: [`${baseUrl}/`, `${baseUrl}/login`],
      // Only start a dev server locally — CI has Docker Compose running already
      ...(isCI
        ? {}
        : {
            startServerCommand: "pnpm dev:web",
            startServerReadyPattern: "Ready",
          }),
      numberOfRuns: isCI ? 1 : 3,
    },
    assert: {
      assertions: {
        "categories:performance": ["warn", { minScore: 0.8 }],
        "categories:accessibility": ["error", { minScore: 0.9 }],
        "categories:best-practices": ["error", { minScore: 0.9 }],
        "categories:seo": ["warn", { minScore: 0.8 }],
      },
    },
    upload: {
      target: "temporary-public-storage",
    },
  },
};
