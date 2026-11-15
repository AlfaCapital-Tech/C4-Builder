import fs from 'node:fs';

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

// Вне терминала (лог фонового `--site -w`, CI) `\r` не перетирает строку, а склеивает
// все обновления в одну гигантскую — там печатаем только итог фазы. Перевод строки
// после прогресса ставит вызывающий.
const writeProgress = (count: number, total: number, unit: string): void => {
    if (process.stdout.isTTY) process.stdout.write(`processed ${count}/${total} ${unit}\r`);
    else if (count === total) process.stdout.write(`processed ${total} ${unit}`);
};

const encodeURIPath = (path: string): string => {
    path = path.split('\\').join('/');
    return encodeURI(path);
};

// Вне терминала escape-последовательности очистки попали бы в лог/файл мусором.
const clearConsole = (): void => {
    if (!process.stdout.isTTY) return;
    process.stdout.write('\x1b[2J');
    process.stdout.write('\x1b[0f');
};

// Единственный вендорный PlantUML-JAR. Выбор версии убран: локальный java-direct
// рендер (Smetana) не зависит от версии, старые JAR удалены (см. change
// remove-plantuml-version). Одна точка правды для имени и версии JAR.
const VENDORED_JAR = {
    version: '1.2026.8',
    jar: 'plantuml-1.2026.8.jar'
};

export { makeDirectory, readFile, writeFile, encodeURIPath, writeProgress, clearConsole, VENDORED_JAR };
