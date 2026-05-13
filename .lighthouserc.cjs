module.exports = {
  ci: {
    collect: {
      url: ["http://localhost:3000/", "http://localhost:3000/login"],
      startServerCommand: "pnpm dev:web",
      startServerReadyPattern: "Ready",
      numberOfRuns: 3,
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
