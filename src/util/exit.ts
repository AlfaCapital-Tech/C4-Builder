// Выход после того, как stdout/stderr дописаны: в pipe (CI, лог агента) на macOS запись
// асинхронна, и голый process.exit обрезал бы хвост — ровно строки ошибок.
export const exitAfterFlush = (code: number): void => {
    process.exitCode = code;
    process.stdout.write('', () => process.stderr.write('', () => process.exit(code)));
};
