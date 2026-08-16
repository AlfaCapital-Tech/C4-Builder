import { describe, expect, it } from 'vitest';

import { createFenceExtractor, mapOutsideFences } from './dist.mjs';

// Экстрактор fenced-диаграмм плагина openspec: CommonMark-границы блоков и имена по хешу.
describe('createFenceExtractor', () => {
    it('пустой ```plantuml закрывается сам, не глотая следующий блок', () => {
        const md = '```plantuml\n```\n\nSome text\n\n```d2\nx -> y\n```\n';
        const { markdown, diagrams } = createFenceExtractor().extract(md, 'design');
        expect(diagrams).toHaveLength(2);
        expect(diagrams[0].content).toBe('@startuml\n\n@enduml');
        expect(diagrams[1].content).toBe('x -> y');
        expect(markdown).toContain('Some text');
        expect(markdown).not.toContain('```');
    });

    it('fence с отступом (в списке) и закрывающая длиннее открывающей', () => {
        const md = '- item\n\n  ```d2\n  a -> b\n  ````\n';
        const { markdown, diagrams } = createFenceExtractor().extract(md, 'p');
        expect(diagrams).toHaveLength(1);
        expect(diagrams[0].content).toBe('a -> b');
        expect(markdown).toMatch(/^ {2}!\[p-[0-9a-f]{8}\.d2\]/m);
    });

    it('имя — по содержимому: вставка блока сверху не сдвигает имена, дубли — одна диаграмма', () => {
        const one = '```d2\nONE\n```\n';
        const two = '```d2\nTWO\n```\n';
        const a = createFenceExtractor()
            .extract(one + two, 'x')
            .diagrams.map((d) => d.file);
        const b = createFenceExtractor().extract(`\`\`\`d2\nZERO\n\`\`\`\n${one}${two}`, 'x').diagrams;
        expect(b.slice(1).map((d) => d.file)).toEqual(a);
        expect(createFenceExtractor().extract(one + one, 'x').diagrams).toHaveLength(1);
    });

    it('mapOutsideFences не трогает текст внутри блоков', () => {
        const md = 'a\n```js\na\n```\na';
        expect(mapOutsideFences(md, (t) => t.replace(/a/g, 'b'))).toBe('b\n```js\na\n```\nb');
    });
});
