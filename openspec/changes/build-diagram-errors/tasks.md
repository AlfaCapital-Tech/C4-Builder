# Tasks

## 1. Общий разборщик ошибок движка

- [ ] 1.1 Создать `src/core/render/errors.ts` с `describeRenderError(err, { lib })` (design §1): PlantUML-блок `ERROR` → `line N+1: msg`, `.iuml` — без номера, `Bpmn/Mermaid/WireflowError` → `problems`, сбой процесса PlantUML без `ERROR` → первая строка + `(run with --verbose for details)`, прочее — `message`; юнит-тест на каждый случай (включая stderr из issue с Java-стеком) проходит
- [ ] 1.2 Перевести `src/cli/commands/check.ts` на разборщик (повтор `.iuml` с C4-контекстом сохранить); `npm run test:unit -- check` зелёный без правок ожиданий

## 2. Полный список ошибок в строгой сборке

- [ ] 2.1 В `generateImages` (`diagrams.ts`) собирать ошибки входа в `failures` вместо броска, ошибки окружения бросать как раньше, после `queue.run()` бросать `DiagramBuildError` с сортировкой по порядку обхода (design §2); тест в `render-queue`/новом `build-errors.test.mjs`: две сломанные диаграммы → обе в ошибке, корректная отрендерена
- [ ] 2.2 `build.ts`: печатать `✗ <file>: <problem>` в stderr до `build aborted`; `index.ts`: `DiagramBuildError` → код 1 без стека (design §3); интеграционный тест на фикстуре из issue (`Rel(u, s, "uses"` без скобки в строке 4): stderr содержит `✗ src/dangling.puml: line 4: Fatal parsing error`, нет `java.lang.` и `Node.js v`, строка `✗` раньше `build aborted`, код 1
- [ ] 2.3 Тест «нет java»: при недоступной java (заглушка `JAVA_HOME`/`PATH`, без автозагрузки) сообщение печатается один раз, код 1

## 3. Verbose и мягкие пути

- [ ] 3.1 `--verbose` / `DEBUG=c4builder` (`*`, список через запятую): в `index.ts` печатать полный вывод движка и стек каждой ошибки; обновить описание опции `-v, --verbose` (design §4); тест: с `--verbose` в выводе есть `java.lang.`, с `DEBUG=c4builder` — тоже, без них — нет
- [ ] 3.2 Короткий текст в soft-путях `render()` (`⚠` мягких диаграмм, `✗` при `softErrors`) и в заглушке `errorPlaceholderSvg`; `rebuild()` в `dispatch` печатает строки `DiagramBuildError`, а не `stack` (design §5); тест `cli-site-warm`/`watch`: битая `.puml` в `site -w` даёт одну строку `✗ <file>: line N: …` без `java.lang.`

## 4. Баннер только в TTY

- [ ] 4.1 `intro()` (`dispatch.ts`), баннер `cmdHelp` (`help.ts`) — под `process.stdout.isTTY`, `clearConsole()` — no-op вне TTY; тест: сборка с stdout в pipe не содержит figlet-строк и `\x1b[2J`

## 5. Актуализация

- [ ] 5.1 `skills/c4builder/SKILL.md`: убрать обход «long Java stack trace … run `c4builder check` to get the short message» (шаг 3) и пункт «Forgetting `c4builder check` and reading a Java stack trace» — описать новый вывод сборки; `template/AGENTS.md` проверить на то же; `npm run test:unit -- skills` зелёный
- [ ] 5.2 Сайт, обе версии: «05 CLI и конфигурация» — `-v, --verbose` и `DEBUG=c4builder` для сборки; «07 Docker и CI» — формат ошибок сборки и все сломанные диаграммы за прогон; тест `docs-parity` зелёный
- [ ] 5.3 `CHANGELOG.md`: добавить `## Unreleased` со строкой про формат ошибок сборки, `--verbose`/`DEBUG`, баннер вне TTY (#62)
- [ ] 5.4 Финальная проверка: `npm run build`, `npm run check`, `npm run test:unit`, `npm run test:golden` (байты картинок не изменились), тест `cli-language` (новые сообщения на английском)

## Workflow follow-up

- После ревью — архив change (`/opsx:archive`), спеки `build-pipeline` синхронизируются.
