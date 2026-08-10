import chalk from 'chalk';
import {
    resolveJava,
    detectSystemJava,
    TEMURIN_FEATURE,
    JRE_CACHE_SCHEMA,
    jreCacheDir
} from '../../core/render/jre.ts';

// `c4builder jre install [--force]` — прогрев кеша: резолвит/скачивает JRE заранее
// (CI/офлайн) без полной сборки. При годной системной java по умолчанию сообщает,
// что скачивание не требуется; `--force` форсирует загрузку Temurin в кеш.
// `c4builder jre info` — машиночитаемые параметры managed-JRE (JSON): путь кеша и
// материал ключа для внешних кешей (actions/cache в CI) из единственного источника
// истины, вместо grep констант по исходникам и хардкода пути.
export default async (args: string[] = [], { force = false }: { force?: boolean } = {}): Promise<void> => {
    const action = args[0];
    if (action === 'info') {
        console.log(
            JSON.stringify({ feature: TEMURIN_FEATURE, schema: JRE_CACHE_SCHEMA, cacheDir: jreCacheDir() })
        );
        return;
    }
    if (action !== 'install') {
        console.log(chalk.red(`неизвестная подкоманда: c4builder jre ${action || ''}`.trim()));
        console.log(chalk.gray('доступно: c4builder jre install [--force] | jre info'));
        process.exit(1);
    }

    try {
        if (!force) {
            const sys = detectSystemJava();
            if (sys) {
                console.log(chalk.green(`системная java годна (v${sys.major}): ${sys.path}`));
                console.log(
                    chalk.gray('скачивание не требуется — для форс-загрузки: c4builder jre install --force')
                );
                return;
            }
        }
        const resolved = await resolveJava({ force, log: (m) => console.log(chalk.gray(m)) });
        const from = resolved.source === 'download' ? `Temurin ${TEMURIN_FEATURE}, скачан` : resolved.source;
        console.log(chalk.green(`JRE готов (${from}): ${resolved.path}`));
    } catch (e) {
        console.log(chalk.red((e as Error).message));
        process.exit(1);
    }
};
