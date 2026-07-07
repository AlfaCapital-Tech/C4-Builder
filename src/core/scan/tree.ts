import fs from 'node:fs';
import path from 'node:path';
import fsextra from 'fs-extra';

import { makeDirectory, readFile } from '../../util/utils.ts';
import type { BuildOptions } from '../../config/options.ts';

// Границы фазы scan: дерево исходников и его элементы-диаграммы. Тип дерева —
// публичный контракт, на который опираются render/compose и будущие юнит-тесты.
export interface Diagram {
    dir: string; // имя файла диаграммы (историческое поле)
    ext: string;
    engine: string; // 'plantuml' | 'd2'
    content: string | Buffer;
    isDitaa: boolean;
}

export interface TreeItem {
    dir: string;
    name: string;
    level: number;
    parent?: string;
    mdFiles: (string | Buffer)[];
    diagrams: Diagram[];
    descendants: string[];
}

export const getFolderName = (dir: string, root: string, homepage: string): string => {
    return dir === root ? homepage : path.parse(dir).base;
};

// Формат выходного файла диаграммы: ditaa всегда PNG (нативный, без SVG-представления),
// иначе — выбранный DIAGRAM_FORMAT. При png не-ditaa рендерится в SVG и растеризуется
// (см. рендер ниже), поэтому D2 тоже честно поддерживает png (раньше молча оставался SVG).
// Живёт рядом с Diagram: имя выхода из него нужно scan для проверки коллизий (см. generateTree).
export const diagramOutputFormat = (diagram: Diagram, options: BuildOptions): string =>
    diagram.isDitaa ? 'png' : options.DIAGRAM_FORMAT;

export const generateTree = async (dir: string, options: BuildOptions): Promise<TreeItem[]> => {
    const tree: TreeItem[] = [];

    const build = async (dir: string, parent?: string): Promise<void> => {
        // Skip output folder - this allows a user to use the top-level folder as ROOT_FOLDER.
        if (dir === options.DIST_FOLDER) {
            return;
        }

        const name = getFolderName(dir, options.ROOT_FOLDER, options.HOMEPAGE_NAME);
        let item = tree.find((x) => x.dir === dir);
        if (!item) {
            item = {
                dir: dir,
                name: name,
                level: dir.split(path.sep).length,
                parent: parent,
                mdFiles: [],
                diagrams: [],
                descendants: []
            };
            tree.push(item);
        }

        const IGNORED_FILES = ['CLAUDE.md'];
        const files = fs.readdirSync(dir).filter((x) => x.charAt(0) !== '_' && !IGNORED_FILES.includes(x));
        for (const file of files) {
            //if folder
            if (fs.statSync(path.join(dir, file)).isDirectory()) {
                item.descendants.push(file);
                //create corresponding dist folder
                if (options.GENERATE_WEBSITE || options.GENERATE_MD || options.GENERATE_LOCAL_IMAGES)
                    await makeDirectory(
                        path.join(options.DIST_FOLDER, dir.replace(options.ROOT_FOLDER, ''), file)
                    );

                await build(path.join(dir, file), dir);
            }
        }

        const mdFiles = files.filter((x) => path.extname(x).toLowerCase() === '.md');
        for (const mdFile of mdFiles) {
            const fileContents = await readFile(path.join(dir, mdFile));
            item.mdFiles.push(fileContents);
        }
        // Диаграммы обоих бэкендов: .puml → PlantUML, .d2 → D2. Поле dir — имя файла
        // (историческое), engine выбирает рендерер, isDitaa — только для PlantUML.
        const diagramFiles = files.filter((x) => ['.puml', '.d2'].includes(path.extname(x).toLowerCase()));
        for (const diagramFile of diagramFiles) {
            const ext = path.extname(diagramFile).toLowerCase();
            const engine = ext === '.d2' ? 'd2' : 'plantuml';
            const fileContents = await readFile(path.join(dir, diagramFile));
            const isDitaa =
                engine === 'plantuml' &&
                !!(fileContents ? fileContents.toString() : '').match(/(@startditaa)/gi);
            item.diagrams.push({ dir: diagramFile, ext, engine, content: fileContents, isDitaa });
        }
        item.diagrams.sort((a, b) => `${a.dir}`.localeCompare(b.dir));

        //copy all other files (.d2 исходники, как и .puml, не копируем — они рендерятся)
        const otherFiles = options.EXCLUDE_OTHER_FILES
            ? []
            : files.filter(
                  (x) =>
                      x.charAt(0) === '_' ||
                      ['.md', '.puml', '.d2'].indexOf(path.extname(x).toLowerCase()) === -1
              );

        for (const otherFile of otherFiles) {
            if (fs.statSync(path.join(dir, otherFile)).isDirectory()) continue;

            if (options.GENERATE_MD || options.GENERATE_WEBSITE)
                await fsextra.copy(
                    path.join(dir, otherFile),
                    path.join(options.DIST_FOLDER, dir.replace(options.ROOT_FOLDER, ''), otherFile)
                );
            if (options.GENERATE_COMPLETE_MD_FILE)
                await fsextra.copy(path.join(dir, otherFile), path.join(options.DIST_FOLDER, otherFile));
        }
    };

    await build(dir);

    // Диаграммы именуются по basename исходника, поэтому foo.puml и foo.d2 в одной
    // папке при одном формате дают один выходной файл и затирают друг друга —
    // отлавливаем это явной ошибкой, а не молчаливой потерей одной из диаграмм.
    for (const item of tree) {
        const seen = new Map<string, string>();
        for (const d of item.diagrams) {
            const out = `${path.parse(d.dir).name}.${diagramOutputFormat(d, options)}`;
            if (seen.has(out))
                throw new Error(
                    `Коллизия имени выхода '${out}' в ${item.dir}: '${seen.get(out)}' и '${d.dir}' ` +
                        `рендерятся в один файл. Переименуйте одну из диаграмм.`
                );
            seen.set(out, d.dir);
        }
    }

    return tree;
};

// Свернуть локальные !include (.iuml и пр.) диаграммы в материал для чексуммы — рекурсивно.
// Иначе правка включённого .iuml не инвалидирует кэш и на сайт уезжает устаревший рендер.
// URL (!include https://…) и stdlib (!include <…>) пропускаем: локально не меняются.
export const foldIncludes = (
    content: string,
    fileDir: string,
    searchDir: string,
    visited: Set<string>
): string => {
    const re = /^[ \t]*!include(?:_once|_many|sub|url)?[ \t]+(.+?)[ \t]*$/gim;
    let out = '';
    let m;
    // biome-ignore lint/suspicious/noAssignInExpressions: идиома regex.exec() в условии while
    while ((m = re.exec(content)) !== null) {
        const ref = m[1]
            .trim()
            .replace(/^["']|["']$/g, '')
            .split('!')[0]
            .trim(); // снять кавычки и !subpart
        if (!ref || /^https?:\/\//i.test(ref) || ref.startsWith('<')) continue;
        // PlantUML резолвит include от каталога файла с директивой, затем от include-пути (item.dir)
        const resolved = [path.resolve(fileDir, ref), path.resolve(searchDir, ref)].find(
            (p) => fs.existsSync(p) && fs.statSync(p).isFile()
        );
        if (!resolved || visited.has(resolved)) continue; // защита от циклов и повторов
        visited.add(resolved);
        let inc = '';
        try {
            inc = fs.readFileSync(resolved, 'utf-8');
        } catch {
            continue;
        }
        out += ` ${resolved} ${inc}`;
        out += foldIncludes(inc, path.dirname(resolved), searchDir, visited); // вложенные include
    }
    return out;
};
