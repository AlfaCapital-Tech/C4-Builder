// Fenced-блоки ```plantuml / ```d2 в артефактах → диаграммы страницы (рендер общим
// локальным движком) + ссылка `![…](name.ext)` на их месте: compose подставит картинку
// inline, а клиентский docsify-plantuml (онлайн-рендер в браузере) не сработает —
// fence в выводе уже отсутствует.
import crypto from 'node:crypto';

import type { PageDiagram } from '../../core/plugins/types.ts';

// Fenced-блок по CommonMark: открывающая ``` или ~~~ (≥3) с любым отступом (fence в
// списке), инфо-строка, тело (может быть пустым), закрывающая того же вида не короче
// открывающей. Тело захватывается вместе с завершающим переводом строки.
const FENCE_RE = /^([ \t]*)(`{3,}|~{3,})[ \t]*([^\n]*)\n([\s\S]*?)^[ \t]*\2[`~]*[ \t]*$/gm;

const ENGINE_EXT: Record<string, string> = { plantuml: '.puml', puml: '.puml', d2: '.d2' };

/** Применить fn к тексту вне fenced-блоков (сами блоки — без изменений). */
export const mapOutsideFences = (md: string, fn: (text: string) => string): string => {
    let out = '';
    let last = 0;
    for (const m of md.matchAll(FENCE_RE)) {
        out += fn(md.slice(last, m.index)) + m[0];
        last = m.index + m[0].length;
    }
    return out + fn(md.slice(last));
};

/**
 * Экстрактор диаграмм одной страницы. Имя файла — `<base>-<sha1 контента>`: не зависит
 * от позиции fence, поэтому вставка/удаление соседнего блока не сдвигает имена и не
 * подсовывает картинку соседа из кэша; одинаковые блоки дают одну диаграмму.
 */
export const createFenceExtractor = () => {
    const seen = new Set<string>();
    return {
        extract(md: string, base: string, source?: string): { markdown: string; diagrams: PageDiagram[] } {
            const diagrams: PageDiagram[] = [];
            const markdown = md.replace(
                FENCE_RE,
                (whole, indent: string, _fence, info: string, body: string) => {
                    const lang = info.trim().split(/\s+/)[0]?.toLowerCase() ?? '';
                    const ext = ENGINE_EXT[lang];
                    if (!ext) return whole;
                    // Отступ fence (в списке) снимаем со строк тела, как CommonMark.
                    const src = body
                        .replace(/\n$/, '')
                        .split('\n')
                        .map((l) => (l.startsWith(indent) ? l.slice(indent.length) : l))
                        .join('\n');
                    // PlantUML требует @startuml/@enduml; в артефактах их часто опускают.
                    const content =
                        ext === '.puml' && !/@start\w+/.test(src) ? `@startuml\n${src}\n@enduml` : src;
                    const hash = crypto.createHash('sha1').update(content).digest('hex').slice(0, 8);
                    const file = `${base}-${hash}${ext}`;
                    if (!seen.has(file)) {
                        seen.add(file);
                        // soft: блок в артефакте — не файл проекта; синтаксическая
                        // ошибка в нём не должна ронять весь сайт (раньше такие блоки
                        // рендерил браузер и показывал картинку с ошибкой).
                        diagrams.push({ file, content, source, soft: true });
                    }
                    return `${indent}![${file}](${file})`;
                }
            );
            return { markdown, diagrams };
        }
    };
};
