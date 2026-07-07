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
    if (fs.existsSync(target) && fs.readdirSync(target).length > 0)
        return `папка «${name}» уже существует и не пуста`;
    return null;
};

const generateTemplate = async (dir: string, projectName: string): Promise<void> => {
    const build = async (dir: string, _parent?: string): Promise<void> => {
        const files = fs.readdirSync(dir);
        for (const file of files) {
            if (fs.statSync(path.join(dir, file)).isDirectory()) {
                await makeDirectory(
                    path.join(process.cwd(), projectName, dir.replace(TEMPLATE_DIR, ''), file)
                );
                await build(path.join(dir, file), dir);
            }
        }

        const mdFiles = files.filter((x) => path.extname(x).toLowerCase() === '.md');
        for (const mdFile of mdFiles) {
            await fsextra.copy(
                path.join(dir, mdFile),
                path.join(process.cwd(), projectName, dir.replace(TEMPLATE_DIR, ''), mdFile)
            );
        }
        const pumlFiles = files.filter((x) => path.extname(x).toLowerCase() === '.puml');
        for (const pumlFile of pumlFiles) {
            const fileContents = await readFile(path.join(dir, pumlFile));
            await writeFile(
                path.join(process.cwd(), projectName, dir.replace(TEMPLATE_DIR, ''), pumlFile),
                fileContents
            );
        }
        const otherFiles = files.filter(
            (x) => ['.md', '.puml'].indexOf(path.extname(x).toLowerCase()) === -1
        );
        for (const otherFile of otherFiles) {
            if (fs.statSync(path.join(dir, otherFile)).isDirectory()) continue;

            await fsextra.copy(
                path.join(dir, otherFile),
                path.join(process.cwd(), projectName, dir.replace(TEMPLATE_DIR, ''), otherFile)
            );
        }
    };

    await build(dir);
};

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
