const figlet = require('figlet');
const inquirer = require('inquirer');
const joi = require('joi');
const chalk = require('chalk');
const fs = require('fs');
const path = require('path');
const fsextra = require('fs-extra');
const Configstore = require('configstore');

const { readFile, writeFile, makeDirectory } = require('./utils.js');

const validate = (schema) => (answers) => {
    //just in case
    if (joi.validate) {
        return !joi.validate(answers, schema).error;
    } else {
        return !schema.validate(answers).error;
    }
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

module.exports = async () => {
    console.log('\nThis will create a new folder with the name of the project');

    let responses;

    responses = await inquirer.prompt({
        type: 'input',
        name: 'projectName',
        message: 'Project Name',
        validate: (answers) => {
            let isValid = validate(joi.string().trim().optional())(answers);
            if (isValid) {
                if (answers.indexOf('/') !== -1 || answers.indexOf('\\') !== -1) return false;

                //check if it already exists
                if (fs.existsSync(path.join(process.cwd(), answers))) {
                    let files = fs.readdirSync(path.join(process.cwd(), answers));
                    if (files.length > 0) throw `Folder ${answers} is not empty`;
                }
                return true;
            }
            return false;
        }
    });
    let projectName = responses.projectName;

    responses = await inquirer.prompt({
        type: 'confirm',
        name: 'isVSCode',
        message: 'Include the VSCode autocomplete?',
        default: true
    });
    let isVSCode = responses.isVSCode;
    console.log(isVSCode);

    await makeDirectory(projectName);
    await generateTemplate(path.join(__dirname, 'template'), projectName);

    let conf = new Configstore(
        path.join(process.cwd(), projectName).split(path.sep).splice(1).join('_'),
        {},
        { configPath: path.join(process.cwd(), projectName, '.c4builder') }
    );
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
    console.log(chalk.gray(`the wizard will guide you through the rest of the configuration`));
    console.log(chalk.gray(`check out the ./${projectName}/docs folder created`));
    return;
};
