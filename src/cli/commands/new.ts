import inquirer from 'inquirer';
import chalk from 'chalk';
import fs from 'node:fs';
import path from 'node:path';
import fsextra from 'fs-extra';
import Configstore from 'configstore';

import { readFile, writeFile, makeDirectory } from '../../util/utils.ts';
import { defaultConfig } from '../../config/defaults.ts';
import { TEMPLATE_DIR } from '../../util/paths.ts';

// Общая проверка имени проекта: возвращает текст ошибки или null (валидно).
// Интерактив показывает её и переспрашивает; --yes падает с ней (exit≠0), без ре-промпта.
const validateProjectName = (name?: string): string | null => {
    if (!name?.trim()) return 'имя проекта не задано';
    if (name.indexOf('/') !== -1 || name.indexOf('\\') !== -1)
        return 'имя проекта не должно содержать «/» или «\\»';
    const target = path.join(process.cwd(), name);
    if (fs.existsSync(target)) {
        // readdirSync по файлу бросает ENOTDIR — сперва различаем файл и каталог.
        if (!fs.statSync(target).isDirectory()) return `«${name}» уже существует и является файлом`;
        if (fs.readdirSync(target).length > 0) return `папка «${name}» уже существует и не пуста`;
    }
    return null;
};

// Копия шаблона в новый проект как есть (включая dot-файлы) — раньше это была ручная
// рекурсия на 40 строк, повторявшая fsextra.copy по типам файлов.
const generateTemplate = (dir: string, projectName: string): Promise<void> =>
    fsextra.copy(dir, path.join(process.cwd(), projectName));

export default async (opts: { yes?: boolean; name?: string } = {}): Promise<void> => {
    const nonInteractive = !!opts.yes;

    // --- имя проекта: флаг --name пропускает промпт; --yes без имени — фатально ---
    let projectName: string;
    if (opts.name) {
        const err = validateProjectName(opts.name);
        if (err) {
            console.log(chalk.red(`ОШИБКА: ${err}`));
            process.exit(1);
        }
        projectName = opts.name;
    } else if (nonInteractive) {
        console.log(chalk.red('ОШИБКА: режим --yes требует --name <name>'));
        process.exit(1);
    } else {
        console.log('\nThis will create a new folder with the name of the project');
        const responses = await inquirer.prompt({
            type: 'input',
            name: 'projectName',
            message: 'Project Name',
            validate: (answers) => validateProjectName(answers) || true
        });
        projectName = responses.projectName;
    }

    await makeDirectory(projectName);
    await generateTemplate(TEMPLATE_DIR, projectName);

    const conf = new Configstore(
        path.join(process.cwd(), projectName).split(path.sep).splice(1).join('_'),
        {},
        { configPath: path.join(process.cwd(), projectName, '.c4builder') }
    );
    // --yes: полный конфиг из единого defaultConfig → последующий c4builder собирает
    // без wizard'а. Интерактив пишет только projectName (первая сборка ведёт через wizard).
    if (nonInteractive) {
        for (const [key, value] of Object.entries(defaultConfig)) conf.set(key, value);
    }
    conf.set('projectName', projectName);

    const readme = await readFile(path.join(TEMPLATE_DIR, 'readme.md'));
    await writeFile(path.join(process.cwd(), projectName, 'README.MD'), `# ${projectName}\n\n${readme}`);

    console.log(chalk.green(`the project was created`));
    console.log(chalk.gray(`run the following commands`));
    console.log(`> cd ${projectName}`);
    console.log(`> c4builder`);
    if (!nonInteractive)
        console.log(chalk.gray(`the wizard will guide you through the rest of the configuration`));
    console.log(chalk.gray(`check out the ./${projectName}/docs folder created`));
    return;
};
