// Стиль фильтра таблиц Changes (опция `filter` плагина openspec). Живёт строкой в src, как
// скрипт в filter.script.ts: плагин отдаёт его ассетом `{ name, content }`, ядро пишет в
// `dist/vendor/plugins/openspec/changes-filter.css`; раскладка самих таблиц остаётся в
// `vendor/openspec/changes.css`, который этот стиль не трогает.

/**
 * Строка фильтра — flex с переносом над первой таблицей; список колонки — `<details>` с
 * `<summary>`-кнопкой (маркер браузера скрыт, стрелка — псевдоэлемент `\\25BE`; удвоенный `\\`
 * из-за шаблонной строки), бейдж числа выбранных цветом темы; раскрытый список — абсолютно
 * позиционированная панель под кнопкой с прокруткой, поле поиска и флажки; счётчик и кнопка
 * `Reset` прижаты вправо, у неактивной кнопки — прозрачность. Скрытые строки, приглушённый
 * родитель, спрятанная таблица без строк и заголовок её секции — классы, которые ставит скрипт.
 */
export const CHANGES_FILTER_CSS = `.markdown-section .c4b-openspec-filter {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.5em;
    margin-bottom: 1rem;
    font-size: 0.9em;
}
.c4b-openspec-filter-menu {
    position: relative;
}
.markdown-section .c4b-openspec-filter-summary {
    display: inline-flex;
    align-items: center;
    gap: 0.4em;
    padding: 0.2em 0.8em;
    border: 1px solid rgba(0, 0, 0, 0.15);
    border-radius: 999px;
    list-style: none;
    cursor: pointer;
    user-select: none;
    -webkit-user-select: none;
}
.c4b-openspec-filter-summary::-webkit-details-marker {
    display: none;
}
.c4b-openspec-filter-summary::after {
    content: '\\25BE';
    color: #7f8c8d;
}
.markdown-section .c4b-openspec-filter-summary:hover,
.markdown-section .c4b-openspec-filter-summary:focus-visible,
.c4b-openspec-filter-menu[open] > .c4b-openspec-filter-summary,
.markdown-section .c4b-openspec-filter-summary--active {
    border-color: var(--theme-color, #42b983);
    outline: none;
}
.c4b-openspec-filter-badge {
    min-width: 1.4em;
    padding: 0 0.4em;
    border-radius: 999px;
    background: var(--theme-color, #42b983);
    color: #fff;
    font-size: 0.85em;
    line-height: 1.5;
    text-align: center;
}
.c4b-openspec-filter-badge[hidden] {
    display: none;
}
.c4b-openspec-filter-list {
    position: absolute;
    top: calc(100% + 4px);
    left: 0;
    z-index: 20;
    min-width: 16em;
    max-height: 20em;
    overflow: auto;
    padding: 0.4em 0;
    background: #fff;
    border: 1px solid rgba(0, 0, 0, 0.12);
    border-radius: 8px;
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.12);
}
.markdown-section .c4b-openspec-filter-search {
    box-sizing: border-box;
    width: calc(100% - 1.2em);
    margin: 0.2em 0.6em 0.4em;
    padding: 0.3em 0.5em;
    border: 1px solid rgba(0, 0, 0, 0.15);
    border-radius: 6px;
    font: inherit;
}
.c4b-openspec-filter-option {
    display: flex;
    align-items: center;
    gap: 0.5em;
    padding: 0.25em 0.8em;
    white-space: nowrap;
    cursor: pointer;
}
.c4b-openspec-filter-option:hover {
    background: rgba(66, 185, 131, 0.1);
}
.c4b-openspec-filter-option[hidden] {
    display: none;
}
.c4b-openspec-filter-foot {
    display: flex;
    align-items: center;
    gap: 0.5em;
    margin-left: auto;
}
.c4b-openspec-filter-count {
    color: #7f8c8d;
    font-variant-numeric: tabular-nums;
}
.markdown-section .c4b-openspec-filter-reset {
    padding: 0.2em 0.8em;
    border: 1px solid rgba(0, 0, 0, 0.15);
    border-radius: 999px;
    background: transparent;
    color: inherit;
    font: inherit;
    line-height: 1.4;
    cursor: pointer;
}
.markdown-section .c4b-openspec-filter-reset:hover,
.markdown-section .c4b-openspec-filter-reset:focus-visible {
    border-color: var(--theme-color, #42b983);
    color: var(--theme-color, #42b983);
    outline: none;
}
.markdown-section .c4b-openspec-filter-reset[disabled] {
    opacity: 0.45;
    cursor: default;
    border-color: rgba(0, 0, 0, 0.15);
    color: inherit;
}
.c4b-openspec-changes tr.c4b-openspec-changes-row--hidden {
    display: none;
}
.c4b-openspec-changes tr.c4b-openspec-changes-row--context {
    opacity: 0.45;
}
.markdown-section .c4b-openspec-changes--empty,
.markdown-section .c4b-openspec-filter-hidden {
    display: none;
}
`;
