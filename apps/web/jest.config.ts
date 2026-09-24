import type { Config } from 'jest'
import nextJest from 'next/jest.js'

const createJestConfig = nextJest({ dir: './' })

const config: Config = {
  coverageProvider: 'v8',
  testEnvironment: 'jsdom',
  setupFilesAfterEnv: ['<rootDir>/jest.setup.ts'],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/$1',
    // Paquetes del monorepo: apuntar a la fuente TS para que next/jest los transforme.
    '^@xinuco/([^/]+)/(.+)$': '<rootDir>/../../packages/$1/$2',
    '^@xinuco/([^/]+)$': '<rootDir>/../../packages/$1/index.ts',
  },
  testMatch: ['**/__tests__/**/*.test.[jt]s?(x)', '**/?(*.)+(spec|test).[jt]s?(x)'],
  testPathIgnorePatterns: ['<rootDir>/node_modules/', '<rootDir>/.next/'],
}

export default createJestConfig(config)
