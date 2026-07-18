import fs from 'node:fs';
import zlib from 'node:zlib';

// mkdir -p: недостающие родители создаются, существующий каталог — не ошибка.
// Реальные сбои (EACCES/EROFS) пробрасываются — раньше глотались молча, и сборка
// падала позже невнятной ошибкой записи в несуществующий каталог.
const makeDirectory = async (path: string): Promise<void> => {
    await fs.promises.mkdir(path, { recursive: true });
};

// Кодировка не передаётся ни одним вызовом → всегда Buffer (потребители зовут .toString()).
const readFile = (path: string): Promise<Buffer> => fs.promises.readFile(path);

const writeFile = (path: string, data: string | NodeJS.ArrayBufferView): Promise<void> =>
    fs.promises.writeFile(path, data);

const writeOnSameLine = async (message: string): Promise<void> => {
    process.stdout.write(`${message}\r`);
};

const encodeURIPath = (path: string): string => {
    path = path.split('\\').join('/');
    return encodeURI(path);
};

/**
 * From
 * https://github.com/qjebbs/vscode-plantuml/blob/master/src/plantuml/renders/plantumlServer.ts
 *     
The MIT License (MIT) 

Copyright (c) 2016 jebbs

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and 
associated documentation files (the "Software"), to deal in the Software without restriction, including 
without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell 
copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the 
following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions 
of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED 
TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL 
THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF 
CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER 
DEALINGS IN THE SOFTWARE.
 */
const urlTextFrom = (s: string): string => {
    const opt = { level: 9 };
    const d = zlib.deflateRawSync(Buffer.from(s), opt);
    const b = encode64(String.fromCharCode(...d.subarray(0)));
    return b;
    // from synchro.js
    /* Copyright (C) 1999 Masanao Izumo <iz@onicos.co.jp>
     * Version: 1.0.1
     * LastModified: Dec 25 1999
     */
    function encode64(data: string): string {
        let r = '';
        for (let i = 0; i < data.length; i += 3) {
            if (i + 2 === data.length) {
                r += append3bytes(data.charCodeAt(i), data.charCodeAt(i + 1), 0);
            } else if (i + 1 === data.length) {
                r += append3bytes(data.charCodeAt(i), 0, 0);
            } else {
                r += append3bytes(data.charCodeAt(i), data.charCodeAt(i + 1), data.charCodeAt(i + 2));
            }
        }
        return r;
    }

    function append3bytes(b1: number, b2: number, b3: number): string {
        const c1 = b1 >> 2;
        const c2 = ((b1 & 0x3) << 4) | (b2 >> 4);
        const c3 = ((b2 & 0xf) << 2) | (b3 >> 6);
        const c4 = b3 & 0x3f;
        let r = '';
        r += encode6bit(c1 & 0x3f);
        r += encode6bit(c2 & 0x3f);
        r += encode6bit(c3 & 0x3f);
        r += encode6bit(c4 & 0x3f);
        return r;
    }
    function encode6bit(b: number): string {
        if (b < 10) {
            return String.fromCharCode(48 + b);
        }
        b -= 10;
        if (b < 26) {
            return String.fromCharCode(65 + b);
        }
        b -= 26;
        if (b < 26) {
            return String.fromCharCode(97 + b);
        }
        b -= 26;
        if (b === 0) {
            return '-';
        }
        if (b === 1) {
            return '_';
        }
        return '?';
    }
};

const plantUmlServerUrl = (baseURL: string, imageFormat: string, content: string): string =>
    `${baseURL}/${imageFormat}/0/${urlTextFrom(content)}`;

const clearConsole = (): void => {
    process.stdout.write('\x1b[2J');
    process.stdout.write('\x1b[0f');
};

// Единственный вендорный PlantUML-JAR. Выбор версии убран: локальный java-direct
// рендер (Smetana) не зависит от версии, старые JAR удалены (см. change
// remove-plantuml-version). Одна точка правды для имени и версии JAR.
const VENDORED_JAR = {
    version: '1.2025.2',
    jar: 'plantuml-1.2025.2.jar'
};

export {
    makeDirectory,
    readFile,
    writeFile,
    encodeURIPath,
    writeOnSameLine,
    clearConsole,
    plantUmlServerUrl,
    VENDORED_JAR
};
