import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { isPathInside } from '../dist/core/render/jre.js';

// zip-slip: extractZip обязан отклонять записи, выходящие за пределы каталога распаковки.
describe('isPathInside (защита extractZip от zip-slip)', () => {
    const dest = path.resolve('/tmp/jre-stage');

    it('обычные записи внутри каталога проходят', () => {
        expect(isPathInside(dest, 'jdk-21/bin/java.exe')).toBe(true);
        expect(isPathInside(dest, 'lib/modules')).toBe(true);
        expect(isPathInside(dest, 'release')).toBe(true);
    });

    it('выход за каталог через ../ отклоняется', () => {
        expect(isPathInside(dest, '../evil')).toBe(false);
        expect(isPathInside(dest, '../../etc/passwd')).toBe(false);
        expect(isPathInside(dest, 'jdk/../../evil')).toBe(false);
    });

    it('абсолютный путь-запись отклоняется', () => {
        expect(isPathInside(dest, '/etc/cron.d/evil')).toBe(false);
    });

    it('каталог-префикс-ловушка (jre-stage-evil) не считается внутренним', () => {
        expect(isPathInside(dest, '../jre-stage-evil/x')).toBe(false);
    });
});
