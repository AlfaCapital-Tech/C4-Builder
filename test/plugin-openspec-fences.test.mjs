import { describe, expect, it } from 'vitest';

import { createFenceExtractor, mapOutsideFences } from './dist.mjs';

// Экстрактор fenced-диаграмм (ядро) с набором языков плагина openspec: CommonMark-границы
// блоков и имена по хешу.
const OPENSPEC = ['plantuml', 'puml', 'd2'];

describe('createFenceExtractor', () => {
    it('пустой ```plantuml закрывается сам, не глотая следующий блок', () => {
        const md = '```plantuml\n```\n\nSome text\n\n```d2\nx -> y\n```\n';
        const { markdown, diagrams } = createFenceExtractor(OPENSPEC).extract(md, 'design');
        expect(diagrams).toHaveLength(2);
        expect(diagrams[0].content).toBe('@startuml\n\n@enduml');
        expect(diagrams[1].content).toBe('x -> y');
        expect(markdown).toContain('Some text');
        expect(markdown).not.toContain('```');
    });

    it('fence с отступом (в списке) и закрывающая длиннее открывающей', () => {
        const md = '- item\n\n  ```d2\n  a -> b\n  ````\n';
        const { markdown, diagrams } = createFenceExtractor(OPENSPEC).extract(md, 'p');
        expect(diagrams).toHaveLength(1);
        expect(diagrams[0].content).toBe('a -> b');
        expect(markdown).toMatch(/^ {2}!\[p-[0-9a-f]{8}\.d2\]/m);
    });

    it('имя — по содержимому: вставка блока сверху не сдвигает имена, дубли — одна диаграмма', () => {
        const one = '```d2\nONE\n```\n';
        const two = '```d2\nTWO\n```\n';
        const a = createFenceExtractor(OPENSPEC)
            .extract(one + two, 'x')
            .diagrams.map((d) => d.file);
        const b = createFenceExtractor(OPENSPEC).extract(
            `\`\`\`d2\nZERO\n\`\`\`\n${one}${two}`,
            'x'
        ).diagrams;
        expect(b.slice(1).map((d) => d.file)).toEqual(a);
        expect(createFenceExtractor(OPENSPEC).extract(one + one, 'x').diagrams).toHaveLength(1);
    });

    it('диаграмма несёт источник и метку soft (ошибка блока не валит сборку)', () => {
        const { diagrams } = createFenceExtractor(OPENSPEC).extract(
            '```plantuml\nA -> B\n```\n',
            'design',
            'openspec/changes/c1/design.md'
        );
        expect(diagrams[0].source).toBe('openspec/changes/c1/design.md');
        expect(diagrams[0].soft).toBe(true);
    });

    it('языки plantuml/puml/d2 (регистр не важен) извлекаются, прочие остаются кодом', () => {
        const md =
            '```PlantUML title\nA -> B\n```\n\n```puml\n@startuml\nC -> D\n@enduml\n```\n\n```text\nE\n```\n';
        const { markdown, diagrams } = createFenceExtractor(OPENSPEC).extract(md, 'p');
        expect(diagrams.map((d) => d.content)).toEqual([
            '@startuml\nA -> B\n@enduml',
            '@startuml\nC -> D\n@enduml'
        ]);
        expect(markdown).toMatch(/^!\[p-[0-9a-f]{8}\.puml\]\(p-[0-9a-f]{8}\.puml\)\n\n!\[p-/);
        expect(markdown).toContain('```text\nE\n```');
    });

    it('mapOutsideFences не трогает текст внутри блоков', () => {
        const md = 'a\n```js\na\n```\na';
        expect(mapOutsideFences(md, (t) => t.replace(/a/g, 'b'))).toBe('b\n```js\na\n```\nb');
    });
});
