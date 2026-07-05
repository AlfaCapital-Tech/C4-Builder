const figlet = require('figlet');
const inquirer = require('inquirer');
const chalk = require('chalk');
const fs = require('fs');
const path = require('path');
const fsextra = require('fs-extra');
const Configstore = require('configstore');

const { readFile, writeFile, makeDirectory } = require('./utils.js');
const { defaultConfig } = require('./defaults.js');

// Общая проверка имени проекта: возвращает текст ошибки или null (валидно).
// Интерактив показывает её и переспрашивает; --yes падает с ней (exit≠0), без ре-промпта.
const validateProjectName = (name) => {
    if (!name || !name.trim()) return 'имя проекта не задано';
    if (name.indexOf('/') !== -1 || name.indexOf('\\') !== -1)
        return 'имя проекта не должно содержать «/» или «\\»';
    const target = path.join(process.cwd(), name);
    if (fs.existsSync(target) && fs.readdirSync(target).length > 0)
        return `папка «${name}» уже существует и не пуста`;
    return null;
};

const generateTemplate = async (dir, projectName) => {
    const build = async (dir, parent) => {
        let files = fs.readdirSync(dir);
        for (const file of files) {
            if (fs.statSync(path.join(dir, file)).isDirectory()) {
                await makeDirectory(
                    path.join(
                        process.cwd(),
                        projectName,
                        dir.replace(path.join(__dirname, 'template'), ''),
                        file
                    )
                );
                await build(path.join(dir, file), dir);
            }
        }

        const mdFiles = files.filter((x) => path.extname(x).toLowerCase() === '.md');
        for (const mdFile of mdFiles) {
            await fsextra.copy(
                path.join(dir, mdFile),
                path.join(
                    process.cwd(),
                    projectName,
                    dir.replace(path.join(__dirname, 'template'), ''),
                    mdFile
                )
            );
        }
        const pumlFiles = files.filter((x) => path.extname(x).toLowerCase() === '.puml');
        for (const pumlFile of pumlFiles) {
            const fileContents = await readFile(path.join(dir, pumlFile));
            await writeFile(
                path.join(
                    process.cwd(),
                    projectName,
                    dir.replace(path.join(__dirname, 'template'), ''),
                    pumlFile
                ),
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
                path.join(
                    process.cwd(),
                    projectName,
                    dir.replace(path.join(__dirname, 'template'), ''),
                    otherFile
                )
            );
        }
    };

    await build(dir);
};

module.exports = async (opts = {}) => {
    const nonInteractive = !!opts.yes;

    // --- имя проекта: флаг --name пропускает промпт; --yes без имени — фатально ---
    let projectName;
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

    // --- VSCode-сниппеты: явный флаг или --yes → без промпта (дефолт true) ---
    let isVSCode;
    if (opts.vscodeExplicit || nonInteractive) {
        isVSCode = opts.vscode !== false;
    } else {
        const responses = await inquirer.prompt({
            type: 'confirm',
            name: 'isVSCode',
            message: 'Include the VSCode autocomplete?',
            default: true
        });
        isVSCode = responses.isVSCode;
    }

    await makeDirectory(projectName);
    await generateTemplate(path.join(__dirname, 'template'), projectName);

    let conf = new Configstore(
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

    let readme = await readFile(path.join(__dirname, 'template', 'readme.md'));
    await writeFile(path.join(process.cwd(), projectName, 'README.MD'), `# ${projectName}\n\n${readme}`);

    if (isVSCode) {
        const snippets = await readFile(path.join(__dirname, 'vendor', 'C4-PlantUML', 'C4.code-snippets'));
        await makeDirectory(path.join(projectName, '.vscode'));
        await writeFile(path.join(process.cwd(), projectName, '.vscode', 'C4.code-snippets'), snippets);
    }

    console.log(chalk.green(`the project was created`));
    console.log(chalk.gray(`run the following commands`));
    console.log(`> cd ${projectName}`);
    console.log(`> c4builder`);
    if (!nonInteractive)
        console.log(chalk.gray(`the wizard will guide you through the rest of the configuration`));
    console.log(chalk.gray(`check out the ./${projectName}/docs folder created`));
    return;
};
