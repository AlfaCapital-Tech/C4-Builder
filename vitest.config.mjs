import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        include: ['test/**/*.test.mjs'],
        // golden-тест спавнит реальный CLI с JVM-рендером PlantUML — прогоны долгие
        testTimeout: 300_000,
        // beforeAll = ensureManagedJre (может качать JRE) + 3×runBuild (по 240 с, см.
        // BUILD_TIMEOUT_MS в helpers.mjs). hookTimeout ДОЛЖЕН покрывать сумму, иначе
        // vitest уронит хук невнятным «hook timed out» раньше, чем сборка отдаст свою
        // внятную ошибку: 3×240 с + запас на скачивание JRE ≈ 840 с.
        hookTimeout: 840_000
    }
});
