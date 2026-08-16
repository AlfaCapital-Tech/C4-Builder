// Fenced-блоки ```plantuml / ```d2 в артефактах → диаграммы страницы (рендер общим
// локальным движком) + ссылка `![…](name.ext)` на их месте: compose подставит картинку
// inline, а клиентский docsify-plantuml (онлайн-рендер в браузере) не сработает —
// fence в выводе уже отсутствует.
import type { PageDiagram } from '../../core/plugins/types.ts';

// Fenced-блок: открывающая ``` или ~~~ (≥3), инфо-строка, тело, закрывающая того же вида.
const FENCE_RE = /^(`{3,}|~{3,})[ \t]*([^\n]*)\n([\s\S]*?)\n\1[ \t]*$/gm;

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
 * Экстрактор диаграмм одной страницы: счётчик сквозной, чтобы имена файлов
 * (`<base>-<n>.puml`) не пересекались между артефактами страницы.
 */
export const createFenceExtractor = () => {
    let n = 0;
    return {
        extract(md: string, base: string): { markdown: string; diagrams: PageDiagram[] } {
            const diagrams: PageDiagram[] = [];
            const markdown = md.replace(FENCE_RE, (whole, _fence, info: string, body: string) => {
                const lang = info.trim().split(/\s+/)[0]?.toLowerCase() ?? '';
                const ext = ENGINE_EXT[lang];
                if (!ext) return whole;
                const file = `${base}-${++n}${ext}`;
                // PlantUML требует @startuml/@enduml; в артефактах их часто опускают.
                const content =
                    ext === '.puml' && !/@start\w+/.test(body) ? `@startuml\n${body}\n@enduml` : body;
                diagrams.push({ file, content });
                return `![${file}](${file})`;
            });
            return { markdown, diagrams };
        }
    };
};
