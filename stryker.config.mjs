/** @type {import('@stryker-mutator/api/core').StrykerOptions} */
const config = {
  packageManager: "npm",
  testRunner: "tap",
  checkers: ["typescript"],
  tsconfigFile: "tsconfig.json",
  typescriptChecker: {
    prioritizePerformanceOverAccuracy: false,
  },
  buildCommand: "npx tsc -p tsconfig.json --pretty false",
  mutate: ["src/**/*.ts", "!src/index.ts", "!src/render.ts"],
  tap: {
    testFiles: ["dist/test/**/*.test.js"],
    nodeArgs: ["--test", "--test-isolation=none", "--test-reporter=tap", "-r", "{{hookFile}}", "{{testFile}}"],
  },
  ignorePatterns: ["dist", "reports", ".stryker-tmp", "coverage"],
  reporters: ["clear-text", "progress", "json"],
  incremental: true,
  coverageAnalysis: "perTest",
  concurrency: 8,
  timeoutMS: 30000,
  dryRunTimeoutMinutes: 3,
};

export default config;
