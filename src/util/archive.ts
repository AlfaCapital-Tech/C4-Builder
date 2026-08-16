// Распаковка архивов (zip через yauzl, tar.gz через node-tar) — общий слой для
// JRE-резолвера и резолвера источников плагинов. Оба формата защищены от выхода
// записей за целевой каталог: tar — самим node-tar (≥6 по умолчанию), zip — здесь.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

// yauzl/tar грузятся лениво (только при распаковке) — не тянем их на импорте модуля.
const require = createRequire(import.meta.url);

// Минимальный контракт yauzl (внешняя зависимость без @types): только то,
// что реально использует extractZip — без привязки к полному API либы.
interface YauzlEntry {
    fileName: string;
    externalFileAttributes: number;
}
interface YauzlZipFile {
    on(event: 'entry', listener: (entry: YauzlEntry) => void): void;
    on(event: 'end', listener: () => void): void;
    on(event: 'error', listener: (err: Error) => void): void;
    readEntry(): void;
    openReadStream(entry: YauzlEntry, cb: (err: Error | null, stream: NodeJS.ReadableStream) => void): void;
}

// Защита от zip-slip: путь записи, разрешённый относительно destDir, обязан
// оставаться ВНУТРИ него (не `../` за пределы). Экспортируется для юнит-теста.
export const isPathInside = (destDir: string, entryName: string): boolean => {
    const root = path.resolve(destDir);
    const dest = path.resolve(root, entryName);
    return dest === root || dest.startsWith(root + path.sep);
};

export const extractZip = (archive: string, destDir: string): Promise<void> =>
    new Promise((resolve, reject) => {
        require('yauzl').open(archive, { lazyEntries: true }, (err: Error | null, zip: YauzlZipFile) => {
            if (err) return reject(err);
            zip.on('entry', (entry: YauzlEntry) => {
                // zip-slip: злонамеренная запись `../../evil` вышла бы за destDir.
                if (!isPathInside(destDir, entry.fileName)) {
                    return reject(
                        new Error(`Небезопасный путь в архиве (выход за каталог): ${entry.fileName}`)
                    );
                }
                // Симлинки пропускаем: в недоверенном архиве симлинк мог бы указывать
                // за пределы каталога.
                const isSymlink = ((entry.externalFileAttributes >>> 16) & 0xffff & 0o170000) === 0o120000;
                if (isSymlink) return zip.readEntry();
                const dest = path.join(destDir, entry.fileName);
                if (entry.fileName.endsWith('/')) {
                    fs.mkdirSync(dest, { recursive: true });
                    return zip.readEntry();
                }
                fs.mkdirSync(path.dirname(dest), { recursive: true });
                zip.openReadStream(entry, (e: Error | null, rs: NodeJS.ReadableStream) => {
                    if (e) return reject(e);
                    const ws = fs.createWriteStream(dest);
                    ws.on('error', reject);
                    ws.on('finish', () => {
                        const mode = (entry.externalFileAttributes >>> 16) & 0o777;
                        if (mode) {
                            try {
                                fs.chmodSync(dest, mode);
                            } catch {
                                /* права не критичны на windows */
                            }
                        }
                        zip.readEntry();
                    });
                    rs.pipe(ws);
                });
            });
            zip.on('end', resolve);
            zip.on('error', reject);
            zip.readEntry();
        });
    });

export const extractTarGz = (archive: string, destDir: string): Promise<void> =>
    require('tar').x({ file: archive, cwd: destDir });
