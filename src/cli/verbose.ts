// Подробный вывод ошибок (полный stderr движка, стеки): флаг `-v/--verbose` или DEBUG в
// принятой у Node-утилит форме — список через запятую/пробел, `c4builder` или `*`. Env нужен
// там, где флаг не добавить (npm-скрипт, CI-шаг, docker-обёртка).
export const debugEnabled = (debug: string | undefined = process.env.DEBUG): boolean =>
    (debug ?? '')
        .split(/[\s,]+/)
        .some((token) => token === '*' || token === 'c4builder' || token === 'c4builder:*');

export const isVerbose = (opts: { verbose?: boolean } = {}): boolean => !!opts.verbose || debugEnabled();
