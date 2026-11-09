// Стиль раскладки таблиц Changes плагина openspec. Живёт строкой в src, как filter.style.ts и
// скрипты ядра в compose/site.scripts.ts: в `vendor/` только чужой код, а комментарии остаются
// здесь и не попадают в выход. Ядро пишет его в `dist/vendor/plugins/openspec/changes.css`.

/**
 * Обёртка `.c4b-openspec-changes` (renderChangesIndex): одна раскладка колонок во всех секциях
 * страницы. Служебные колонки Schema (2), Tasks (3), Updated (4) не переносятся и имеют общую
 * минимальную ширину, колонки опции `columns` (5+) — тоже; Change забирает остальное, поэтому
 * переносится только не влезающее имя change'а или длинное значение. `width` ячейки в авто-раскладке
 * таблицы — минимум: колонка растёт под длинное содержимое. На узком экране обёртка прокручивается,
 * а не сжимает колонки; с опцией `columns` (`--extra`) у таблицы минимальная ширина. Прогресс, где
 * закрыты все задачи (таблицы, сводка, страница change'а), — цветом темы, а не браузера.
 */
export const CHANGES_CSS = `.markdown-section .c4b-openspec-changes {
    margin-bottom: 1rem;
    overflow-x: auto;
}
.markdown-section .c4b-openspec-changes table {
    display: table;
    margin-bottom: 0;
    overflow: visible;
    width: 100%;
}
.markdown-section .c4b-openspec-changes--extra table {
    min-width: 60em;
}
.c4b-openspec-changes th:nth-child(2),
.c4b-openspec-changes td:nth-child(2),
.c4b-openspec-changes th:nth-child(3),
.c4b-openspec-changes td:nth-child(3),
.c4b-openspec-changes th:nth-child(4),
.c4b-openspec-changes td:nth-child(4) {
    white-space: nowrap;
}
.c4b-openspec-changes th:nth-child(2) {
    width: 8em;
}
.c4b-openspec-changes th:nth-child(3) {
    width: 14em;
}
.c4b-openspec-changes th:nth-child(4) {
    width: 8em;
}
.c4b-openspec-changes th:nth-child(n + 5) {
    width: 12em;
}
.c4b-openspec-changes progress {
    vertical-align: middle;
    width: 6em;
}
.markdown-section progress.c4b-progress-done {
    accent-color: var(--theme-color, #42b983);
}
`;
