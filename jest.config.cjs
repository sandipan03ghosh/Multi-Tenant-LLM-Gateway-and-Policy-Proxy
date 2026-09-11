/** @type {import('jest').Config} */
module.exports = {
  preset: "ts-jest/presets/default-esm",
  testEnvironment: "node",
  extensionsToTreatAsEsm: [".ts"],
  // Our tsconfig uses NodeNext resolution, so relative imports use explicit ".js" extensions
  // even though the source files are ".ts". Strip that extension so ts-jest resolves the
  // actual .ts file instead of looking for a nonexistent compiled .js file.
  moduleNameMapper: {
    "^(\\.{1,2}/.*)\\.js$": "$1",
  },
  transform: {
    "^.+\\.ts$": ["ts-jest", { useESM: true }],
  },
  roots: ["<rootDir>/packages"],
  testPathIgnorePatterns: ["/node_modules/", "/dist/", "/generated/"],
};
