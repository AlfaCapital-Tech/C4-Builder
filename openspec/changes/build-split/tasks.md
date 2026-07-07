## 1. Фаза scan

- [x] 1.1 `src/core/scan/tree.ts`: перенести `generateTree`, `foldIncludes`, `getFolderName` + экспортируемый тип дерева скана; `build.ts` импортирует; golden зелёный; коммит

## 2. Фаза render

- [x] 2.1 `src/core/render/diagrams.ts`: перенести `renderDiagram`, `generateImages`, `diagramOutputFormat`, `getMime`, `httpGet` + типы задач рендера/колбэка прогресса; golden зелёный; коммит

## 3. Фаза compose

- [ ] 3.1 `src/core/compose/markdown.ts`: перенести `compileDocument`, `hasOwnH1`, `injectAfterFirstH1`, `generateMD`, `generateCompleteMD`, `generateWebMD` (тип дерева — импорт из scan); golden зелёный; коммит

## 4. Оркестратор

- [ ] 4.1 Ревизия остатка `build.ts`: только оркестрация (бэкап/восстановление dist, вызовы фаз, прогресс); константы — к модулям-владельцам
- [ ] 4.2 Финальная проверка: `npm run build`, golden, `npm pack --dry-run`; коммит
