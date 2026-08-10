import inquirer from 'inquirer';
import { z } from 'zod';
import fs from 'node:fs';
import path from 'node:path';
import { defaultConfig } from '../../config/defaults.ts';
import type { BuildOptions } from '../../config/options.ts';

// Ответы inquirer.prompt — динамический словарь (Record<string, any> в типах inquirer).
type PromptAnswers = Awaited<ReturnType<typeof inquirer.prompt>>;

// Непустая строка: в zod `.trim()` — трансформ, а не проверка, поэтому пустую строку
// и пробелы отсекает явный `.min(1)`.
const nonEmptyString = z.string().trim().min(1);

// Валидатор ответа визарда: true при успешном safeParse, иначе текст ошибки для inquirer.
// Пустой Enter уже подставил дефолт (answer = value || default) — сообщение получают
// только явно введённые пробелы/пустая строка при отсутствии дефолта.
const validate =
    (schema: z.ZodType, message = 'значение обязательно') =>
    (answer: unknown): string | true =>
        schema.safeParse(answer).success || message;

// Пункт default-списка чекбокса inquirer: ключ отмечен, если он включён в текущем
// конфиге, а при незаданном значении — если включён по умолчанию.
const checkedKey = (current: boolean | undefined, dflt: boolean, key: string): string | null =>
    (current === undefined ? dflt : current) ? key : null;

export default async (
    currentConfiguration: Partial<BuildOptions>,
    conf: { set(key: string, value: unknown): void },
    program: { config?: boolean }
): Promise<void> => {
    // ESM исполняется в strict mode: под CommonJS `responses` был неявным глобалом,
    // здесь объявляем его явно (иначе присваивание бросит ReferenceError).
    let responses: PromptAnswers;
    if (!currentConfiguration.PROJECT_NAME || program.config) {
        responses = await inquirer.prompt({
            type: 'input',
            name: 'projectName',
            message: 'Project Name',
            default: currentConfiguration.PROJECT_NAME || path.parse(process.cwd()).name,
            validate: validate(nonEmptyString, 'укажите имя проекта')
        });
        conf.set('projectName', responses.projectName);
    }

    if (!currentConfiguration.HOMEPAGE_NAME || program.config) {
        responses = await inquirer.prompt({
            type: 'input',
            name: 'homepageName',
            message: 'HomePage Name',
            default: currentConfiguration.HOMEPAGE_NAME || defaultConfig.homepageName,
            validate: validate(nonEmptyString, 'укажите имя главной страницы')
        });
        conf.set('homepageName', responses.homepageName);
    }

    if (!currentConfiguration.ROOT_FOLDER || program.config) {
        responses = await inquirer.prompt({
            type: 'input',
            name: 'rootFolder',
            message: 'Root documentation folder',
            default: currentConfiguration.ROOT_FOLDER || defaultConfig.rootFolder,
            validate: (answer: string): string | true => {
                if (!nonEmptyString.safeParse(answer).success) return 'укажите папку с документацией';
                if (answer.indexOf('/') !== -1 || answer.indexOf('\\') !== -1)
                    return 'имя папки не должно содержать «/» или «\\»';
                // statSync бросает ENOENT для несуществующего пути — ловим и превращаем в
                // сообщение, иначе async-хендлер inquirer уронит процесс сырым стектрейсом.
                try {
                    if (!fs.statSync(path.join(process.cwd(), answer)).isDirectory())
                        return 'указанный путь не является каталогом';
                } catch {
                    return 'папка не найдена';
                }
                return true;
            }
        });
        conf.set('rootFolder', responses.rootFolder);
    }

    if (!currentConfiguration.DIST_FOLDER || program.config) {
        responses = await inquirer.prompt({
            type: 'input',
            name: 'distFolder',
            message: 'Destination folder',
            default: currentConfiguration.DIST_FOLDER || defaultConfig.distFolder,
            validate: (answers) => {
                // легаси-дефект: обёртка не вызвана с answers → isValid всегда истинна. Бэклог.
                const isValid: unknown = validate(z.string().trim().optional());
                if (isValid) {
                    if (answers.indexOf('/') !== -1 || answers.indexOf('\\') !== -1) return false;
                    return true;
                }
                return false;
            }
        });
        conf.set('distFolder', responses.distFolder);
    }

    if (
        currentConfiguration.GENERATE_MD === undefined ||
        currentConfiguration.GENERATE_COMPLETE_MD_FILE === undefined ||
        currentConfiguration.GENERATE_WEBSITE === undefined ||
        program.config
    ) {
        const defaults = [
            checkedKey(currentConfiguration.GENERATE_MD, defaultConfig.generateMD, 'generateMD'),
            checkedKey(
                currentConfiguration.GENERATE_COMPLETE_MD_FILE,
                defaultConfig.generateCompleteMD,
                'generateCompleteMD'
            ),
            checkedKey(currentConfiguration.GENERATE_WEBSITE, defaultConfig.generateWEB, 'generateWEB')
        ];

        responses = await inquirer.prompt({
            type: 'checkbox',
            name: 'generate',
            message: 'Compilation format:',
            default: defaults,
            choices: [
                {
                    name: 'Multiple markdown files',
                    value: 'generateMD'
                },
                {
                    name: 'Generate a single complete markdown file',
                    value: 'generateCompleteMD'
                },
                {
                    name: 'Generate website',
                    value: 'generateWEB'
                }
            ]
        });

        conf.set('generateMD', responses.generate.includes('generateMD'));
        conf.set('generateCompleteMD', responses.generate.includes('generateCompleteMD'));
        conf.set('generateWEB', responses.generate.includes('generateWEB'));

        if (responses.generate.includes('generateMD')) {
            let mdOptions: PromptAnswers = await inquirer.prompt({
                type: 'confirm',
                name: 'includeNavigation',
                message: 'Include basic navigation?',
                default:
                    currentConfiguration.INCLUDE_NAVIGATION === undefined
                        ? defaultConfig.includeNavigation
                        : currentConfiguration.INCLUDE_NAVIGATION
            });
            conf.set('includeNavigation', mdOptions.includeNavigation);

            mdOptions = await inquirer.prompt({
                type: 'confirm',
                name: 'includeTableOfContents',
                message: 'Include navigable table of contents?',
                default:
                    currentConfiguration.INCLUDE_TABLE_OF_CONTENTS === undefined
                        ? defaultConfig.includeTableOfContents
                        : currentConfiguration.INCLUDE_TABLE_OF_CONTENTS
            });
            conf.set('includeTableOfContents', mdOptions.includeTableOfContents);
        }

        if (responses.generate.includes('generateWEB')) {
            let webOptions: PromptAnswers = await inquirer.prompt({
                type: 'input',
                name: 'webTheme',
                message: 'Change the default docsify theme?',
                default: currentConfiguration.WEB_THEME || defaultConfig.webTheme
            });
            conf.set('webTheme', webOptions.webTheme);

            webOptions = await inquirer.prompt({
                // confirm возвращает boolean — схема требует строгий z.boolean();
                // input сохранял бы строку ('y') и валил последующий safeParse конфига.
                type: 'confirm',
                name: 'supportSearch',
                message: 'Support search on navbar?',
                default: defaultConfig.supportSearch
            });
            conf.set('supportSearch', webOptions.supportSearch);

            webOptions = await inquirer.prompt({
                type: 'input',
                name: 'repoUrl',
                message: 'Include a repository url?',
                default: currentConfiguration.REPO_NAME || defaultConfig.repoUrl
            });
            conf.set('repoUrl', webOptions.repoUrl);

            webOptions = await inquirer.prompt({
                type: 'confirm',
                name: 'executeScript',
                message: 'Support script execution and OpenAPI rendering?',
                default:
                    // легаси-дефект: camelCase-ключ (нет в BuildOptions) → всегда undefined-ветка. Бэклог.
                    (currentConfiguration as { executeScript?: boolean }).executeScript === undefined
                        ? defaultConfig.executeScript
                        : (currentConfiguration as { executeScript?: boolean }).executeScript
            });
            conf.set('executeScript', webOptions.executeScript);

            webOptions = await inquirer.prompt({
                type: 'input',
                name: 'docsifyTemplate',
                message: 'Path to a specific Docsify template?',
                default: defaultConfig.docsifyTemplate
            });
            conf.set('docsifyTemplate', webOptions.docsifyTemplate);

            webOptions = await inquirer.prompt({
                type: 'input',
                name: 'webPort',
                message: 'Change the default serve port?',
                default: currentConfiguration.WEB_PORT || defaultConfig.webPort
            });
            conf.set('webPort', webOptions.webPort);
        }
    }

    if (
        currentConfiguration.GENERATE_LOCAL_IMAGES === undefined ||
        currentConfiguration.EMBED_DIAGRAM === undefined ||
        currentConfiguration.INCLUDE_BREADCRUMBS === undefined ||
        currentConfiguration.INCLUDE_LINK_TO_DIAGRAM === undefined ||
        currentConfiguration.EXCLUDE_OTHER_FILES === undefined ||
        program.config
    ) {
        const defaults = [
            checkedKey(
                currentConfiguration.INCLUDE_BREADCRUMBS,
                defaultConfig.includeBreadcrumbs,
                'includeBreadcrumbs'
            ),
            checkedKey(
                currentConfiguration.GENERATE_LOCAL_IMAGES,
                defaultConfig.generateLocalImages,
                'generateLocalImages'
            ),
            checkedKey(
                currentConfiguration.INCLUDE_LINK_TO_DIAGRAM,
                defaultConfig.includeLinkToDiagram,
                'includeLinkToDiagram'
            ),
            checkedKey(currentConfiguration.DIAGRAMS_ON_TOP, defaultConfig.diagramsOnTop, 'diagramsOnTop'),
            checkedKey(currentConfiguration.EMBED_DIAGRAM, defaultConfig.embedDiagram, 'embedDiagram'),
            checkedKey(
                currentConfiguration.EXCLUDE_OTHER_FILES,
                defaultConfig.excludeOtherFiles,
                'excludeOtherFiles'
            )
        ];
        const choices = [
            {
                name: 'Include breadcrumbs',
                value: 'includeBreadcrumbs'
            },
            {
                name: 'Replace diagrams with a link',
                value: 'includeLinkToDiagram'
            },
            {
                name: 'Place diagrams before text',
                value: 'diagramsOnTop'
            },
            {
                name: 'Embed SVG Diagram',
                value: 'embedDiagram'
            },
            {
                name: 'Exclude other files',
                value: 'excludeOtherFiles'
            }
        ];
        choices.push({
            name: 'Generate diagram images locally',
            value: 'generateLocalImages'
        });

        responses = await inquirer.prompt({
            type: 'checkbox',
            name: 'generate',
            message: 'Compilation format:',
            default: defaults,
            choices: choices
        });
        conf.set('includeBreadcrumbs', responses.generate.includes('includeBreadcrumbs'));
        conf.set('includeLinkToDiagram', responses.generate.includes('includeLinkToDiagram'));
        conf.set('diagramsOnTop', responses.generate.includes('diagramsOnTop'));
        conf.set('embedDiagram', responses.generate.includes('embedDiagram'));
        conf.set('excludeOtherFiles', responses.generate.includes('excludeOtherFiles'));
        conf.set('generateLocalImages', responses.generate.includes('generateLocalImages'));
    }

    if (!currentConfiguration.PLANTUML_SERVER_URL || program.config) {
        responses = await inquirer.prompt({
            type: 'input',
            name: 'plantumlServerUrl',
            message: 'PlantUML Server URL',
            default: currentConfiguration.PLANTUML_SERVER_URL || defaultConfig.plantumlServerUrl,
            validate: validate(nonEmptyString, 'укажите URL сервера PlantUML')
        });
        conf.set('plantumlServerUrl', responses.plantumlServerUrl);
    }

    if (!currentConfiguration.DIAGRAM_FORMAT || program.config) {
        responses = await inquirer.prompt({
            type: 'input',
            name: 'diagramFormat',
            message: 'Diagram Image Format',
            default: currentConfiguration.DIAGRAM_FORMAT || defaultConfig.diagramFormat,
            validate: validate(nonEmptyString, 'укажите формат изображения диаграмм')
        });
        conf.set('diagramFormat', responses.diagramFormat);
    }

    if (!currentConfiguration.CHARSET || program.config) {
        responses = await inquirer.prompt({
            type: 'input',
            name: 'charset',
            message: 'Change the default charset',
            default: currentConfiguration.CHARSET || defaultConfig.charset
        });
        conf.set('charset', responses.charset);
    }
};
