import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        include: ['test/**/*.test.mjs'],
        // golden-тест спавнит реальный CLI с JVM-рендером PlantUML — прогоны долгие
        testTimeout: 300_000,
        hookTimeout: 300_000
    }
});
