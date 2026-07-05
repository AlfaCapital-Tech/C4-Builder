import chalk from 'chalk';
import { resolveJava, detectSystemJava, TEMURIN_FEATURE } from '../../core/render/jre.js';

// Прогрев кеша: `c4builder jre install [--force]`. Резолвит/скачивает JRE заранее
// (CI/офлайн) без полной сборки. При годной системной java по умолчанию сообщает,
// что скачивание не требуется; `--force` форсирует загрузку Temurin в кеш.
export default async (args = [], { force = false } = {}) => {
    const action = args[0];
    if (action !== 'install') {
        console.log(chalk.red(`неизвестная подкоманда: c4builder jre ${action || ''}`.trim()));
        console.log(chalk.gray('доступно: c4builder jre install [--force]'));
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
        console.log(chalk.red(e.message));
        process.exit(1);
    }
};
