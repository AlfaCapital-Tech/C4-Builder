import inquirer from 'inquirer';
import joi from 'joi';
import fs from 'node:fs';
import path from 'node:path';
import { defaultConfig } from '../../config/defaults.ts';
import type { BuildOptions } from '../../config/options.ts';

// Ответы inquirer.prompt — динамический словарь (Record<string, any> в типах inquirer).
type PromptAnswers = Awaited<ReturnType<typeof inquirer.prompt>>;

// Двухветочная обёртка joi.validate — легаси как есть (joi@17 не несёт .validate,
// живёт else-ветка). Мёртвая if-ветка сохранена под каст — бэклог legacy-fixes.
const validate =
    (schema: joi.Schema) =>
    (answers: unknown): boolean => {
        //just in case: joi@17 не несёт module-level .validate — if-ветка мертва (легаси).
        const legacyJoi = joi as { validate?: (answers: unknown, schema: joi.Schema) => { error?: unknown } };
        if (legacyJoi.validate) {
            return !legacyJoi.validate(answers, schema).error;
        } else {
            return !schema.validate(answers).error;
        }
    };

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
            validate: validate(joi.string().trim().optional())
        });
        conf.set('projectName', responses.projectName);
    }

    if (!currentConfiguration.HOMEPAGE_NAME || program.config) {
        responses = await inquirer.prompt({
            type: 'input',
            name: 'homepageName',
            message: 'HomePage Name',
            default: currentConfiguration.HOMEPAGE_NAME || defaultConfig.homepageName,
            validate: validate(joi.string().trim().optional())
        });
        conf.set('homepageName', responses.homepageName);
    }

    if (!currentConfiguration.ROOT_FOLDER || program.config) {
        responses = await inquirer.prompt({
            type: 'input',
            name: 'rootFolder',
            message: 'Root documentation folder',
            default: currentConfiguration.ROOT_FOLDER || defaultConfig.rootFolder,
            validate: (answers) => {
                const isValid = validate(joi.string().trim().optional())(answers);
                if (isValid) {
                    if (answers.indexOf('/') !== -1 || answers.indexOf('\\') !== -1) return false;

                    //check it's an actual folder
                    const isDirectory = fs.statSync(path.join(process.cwd(), answers)).isDirectory();
                    if (isDirectory) return true;
                }
                return false;
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
                const isValid: unknown = validate(joi.string().trim().optional());
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
            currentConfiguration.GENERATE_MD === undefined
                ? defaultConfig.generateMD
                    ? 'generateMD'
                    : null
                : currentConfiguration.GENERATE_MD
                  ? 'generateMD'
                  : null,
            currentConfiguration.GENERATE_COMPLETE_MD_FILE === undefined
                ? defaultConfig.generateCompleteMD
                    ? 'generateCompleteMD'
                    : null
                : currentConfiguration.GENERATE_COMPLETE_MD_FILE
                  ? 'generateCompleteMD'
                  : null,
            currentConfiguration.GENERATE_WEBSITE === undefined
                ? defaultConfig.generateWEB
                    ? 'generateWEB'
                    : null
                : currentConfiguration.GENERATE_WEBSITE
                  ? 'generateWEB'
                  : null
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

        conf.set('generateMD', !!responses.generate.find((x: string) => x === 'generateMD'));
        conf.set('generateCompleteMD', !!responses.generate.find((x: string) => x === 'generateCompleteMD'));
        conf.set('generateWEB', !!responses.generate.find((x: string) => x === 'generateWEB'));

        if (responses.generate.find((x: string) => x === 'generateMD')) {
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

        if (responses.generate.find((x: string) => x === 'generateWEB')) {
            let webOptions: PromptAnswers = await inquirer.prompt({
                type: 'input',
                name: 'webTheme',
                message: 'Change the default docsify theme?',
                default: currentConfiguration.WEB_THEME || defaultConfig.webTheme
            });
            conf.set('webTheme', webOptions.webTheme);

            webOptions = await inquirer.prompt({
                type: 'input',
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
            currentConfiguration.INCLUDE_BREADCRUMBS === undefined
                ? defaultConfig.includeBreadcrumbs
                    ? 'includeBreadcrumbs'
                    : null
                : currentConfiguration.INCLUDE_BREADCRUMBS
                  ? 'includeBreadcrumbs'
                  : null,
            currentConfiguration.GENERATE_LOCAL_IMAGES === undefined
                ? defaultConfig.generateLocalImages
                    ? 'generateLocalImages'
                    : null
                : currentConfiguration.GENERATE_LOCAL_IMAGES
                  ? 'generateLocalImages'
                  : null,
            currentConfiguration.INCLUDE_LINK_TO_DIAGRAM === undefined
                ? defaultConfig.includeLinkToDiagram
                    ? 'includeLinkToDiagram'
                    : null
                : currentConfiguration.INCLUDE_LINK_TO_DIAGRAM
                  ? 'includeLinkToDiagram'
                  : null,
            currentConfiguration.DIAGRAMS_ON_TOP === undefined
                ? defaultConfig.diagramsOnTop
                    ? 'diagramsOnTop'
                    : null
                : currentConfiguration.DIAGRAMS_ON_TOP
                  ? 'diagramsOnTop'
                  : null,
            currentConfiguration.EMBED_DIAGRAM === undefined
                ? defaultConfig.embedDiagram
                    ? 'embedDiagram'
                    : null
                : currentConfiguration.EMBED_DIAGRAM
                  ? 'embedDiagram'
                  : null,
            currentConfiguration.EXCLUDE_OTHER_FILES === undefined
                ? defaultConfig.excludeOtherFiles
                    ? 'excludeOtherFiles'
                    : null
                : currentConfiguration.EXCLUDE_OTHER_FILES
                  ? 'excludeOtherFiles'
                  : null
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
        conf.set('includeBreadcrumbs', !!responses.generate.find((x: string) => x === 'includeBreadcrumbs'));
        conf.set(
            'includeLinkToDiagram',
            !!responses.generate.find((x: string) => x === 'includeLinkToDiagram')
        );
        conf.set('diagramsOnTop', !!responses.generate.find((x: string) => x === 'diagramsOnTop'));
        conf.set('embedDiagram', !!responses.generate.find((x: string) => x === 'embedDiagram'));
        conf.set('excludeOtherFiles', !!responses.generate.find((x: string) => x === 'excludeOtherFiles'));

        conf.set(
            'generateLocalImages',
            !!responses.generate.find((x: string) => x === 'generateLocalImages')
        );
    }

    if (!currentConfiguration.PLANTUML_SERVER_URL || program.config) {
        responses = await inquirer.prompt({
            type: 'input',
            name: 'plantumlServerUrl',
            message: 'PlantUML Server URL',
            default: currentConfiguration.PLANTUML_SERVER_URL || defaultConfig.plantumlServerUrl,
            validate: validate(joi.string().trim().optional())
        });
        conf.set('plantumlServerUrl', responses.plantumlServerUrl);
    }

    if (!currentConfiguration.DIAGRAM_FORMAT || program.config) {
        responses = await inquirer.prompt({
            type: 'input',
            name: 'diagramFormat',
            message: 'Diagram Image Format',
            default: currentConfiguration.DIAGRAM_FORMAT || defaultConfig.diagramFormat,
            validate: validate(joi.string().trim().optional())
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
