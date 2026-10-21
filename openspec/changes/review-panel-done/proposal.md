## Why

Пользователь открыл `site -w` в агентском режиме, ничего не написал и нажал **Discard** на пустой
панели review. Он ждал, что ревью закончится и агент узнает, что правок нет. Вместо этого ничего не
произошло: Discard очищает черновик, а он и так пуст. Действие «правок нет, закончили» в панели
есть: это **Approve**. Но на пустом ревью «Approve» не читается как «закончить», а Discard
выглядит как «отмена» и активен всегда.

## What Changes

- Набор кнопок панели review зависит от черновика:
  - черновик пуст — одна основная кнопка **Done — no changes**. Она отправляет пачку с решением
    `approved`, как Approve сейчас. **Discard** и **Submit review** скрыты;
  - в черновике есть замечания — **Discard**, **Approve**, **Submit review**, как сейчас.
- **Discard** по-прежнему только очищает черновик локально, агенту ничего не уходит. Иначе
  очистка, чтобы начать ревью заново, завершала бы цикл агента.
- Протокол, формат пачки и `c4builder feedback` не меняются: и Done, и Approve дают
  `Decision: approved`.

## Capabilities

### New Capabilities

### Modified Capabilities
- `site-agent-feedback`: требование «Review-пачка» — кнопки панели зависят от того, пуст ли
  черновик; пустое ревью завершается кнопкой **Done — no changes**.

## Impact

- `src/cli/commands/site.comments.ts` — панель review (`renderPanel`, кнопки).
- `test/site-comments-client.test.mjs` — сценарии панели.
- Страница «08 Агенты» (RU/EN), CHANGELOG. Skill и `template/AGENTS.md` кнопки панели не описывают,
  флаги и ключи не меняются.
- Change `site-ui-language` переводит и эти подписи, поэтому этот change делается первым.
