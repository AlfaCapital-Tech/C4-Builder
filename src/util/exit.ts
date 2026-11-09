// Коды возврата команды — одна таблица на модуль команды: ею пользуется и сам код при выходе, и
// справка `<command> --help` (cli/help.ts), поэтому описание кода не расходится с поведением.
// Порядок ключей — порядок строк в справке.
export type ExitCodes = Record<string, readonly [code: number, meaning: string]>;

// Выход явный и при успехе: висящий handle упавшего движка (воркер D2, окно jsdom) иначе
// подвесил бы CI. Но process.exit не ждёт асинхронной записи в pipe (macOS, лог агента) и
// обрезал бы хвост — ровно строки ошибок. Выходим из колбэка последней записи: колбэки потока
// идут по порядку, значит всё выше уже записано. `out` — финальный вывод в stdout (отчёт).
export const exitAfterWrite = (code: number, out = ''): Promise<never> =>
    new Promise(() => {
        process.stdout.write(out, () => process.stderr.write('', () => process.exit(code)));
    });
