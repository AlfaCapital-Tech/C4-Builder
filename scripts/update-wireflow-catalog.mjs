#!/usr/bin/env node
// Обновление вендоренного каталога шаблонов экранов Wireflow (vendor/wireflow/):
//
//   node scripts/update-wireflow-catalog.mjs <sha>
//
// Скачивает архив коммита github.com/vanila-io/wireflow (MIT), берёт из него только
// шаблоны экранов (public/graphics/**/*.svg), их реестр (lib/graphics.json), пропорции
// (lib/graphic-sizes.json) и LICENSE, пишет VERSION с SHA коммита. Каталог руками не
// правится — только этим скриптом, чтобы VERSION всегда соответствовал содержимому (он идёт
// в ключ кэша рендера). Остальной код редактора (React Flow, стили) в пакет не попадает:
// рендер wireflow-диаграмм в c4builder свой (src/core/render/wireflowrenderer.ts).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import { extract } from 'tar';

const REPO = 'vanila-io/wireflow';
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const TARGET = path.join(ROOT, 'vendor', 'wireflow');

const sha = process.argv[2];
if (!sha || !/^[0-9a-f]{7,40}$/i.test(sha)) {
    console.error('usage: node scripts/update-wireflow-catalog.mjs <commit sha>');
    process.exit(1);
}

// Иллюстраторовский экспорт несёт XML-пролог, DOCTYPE и закомментированные слои — в
// <symbol> они не нужны, а в пакете весят. Геометрию не трогаем: рендер детерминирован от
// байтов каталога, минификация путей дала бы расхождения с редактором.
const cleanSvg = (svg) =>
    `${svg
        .replace(/^﻿/, '')
        .replace(/<\?xml[^>]*\?>/g, '')
        .replace(/<!DOCTYPE[^>]*>/g, '')
        .replace(/<!--[\s\S]*?-->/g, '')
        .replace(/\r\n/g, '\n')
        .replace(/^[ \t]+$/gm, '')
        .replace(/\n{2,}/g, '\n')
        .trim()}\n`;

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wireflow-catalog-'));
try {
    const url = `https://codeload.github.com/${REPO}/tar.gz/${sha}`;
    console.log(`downloading ${url}`);
    const res = await fetch(url);
    if (!res.ok || !res.body) throw new Error(`${url}: HTTP ${res.status}`);
    const archive = path.join(tmp, 'src.tar.gz');
    await pipeline(res.body, fs.createWriteStream(archive));

    // Нужные пути; верхний каталог архива — `<repo>-<sha>/`, его срезает strip: 1.
    const wanted = (p) =>
        /^[^/]+\/(public\/graphics\/[^/]+\/[^/]+\.svg|lib\/graphics\.json|lib\/graphic-sizes\.json|LICENSE)$/.test(
            p
        );
    await extract({ file: archive, cwd: tmp, strip: 1, filter: wanted });

    const graphics = JSON.parse(fs.readFileSync(path.join(tmp, 'lib', 'graphics.json'), 'utf8'));
    const sizes = JSON.parse(fs.readFileSync(path.join(tmp, 'lib', 'graphic-sizes.json'), 'utf8'));
    if (!Array.isArray(graphics) || !graphics.length) throw new Error('lib/graphics.json: no graphics');

    fs.rmSync(TARGET, { recursive: true, force: true });
    fs.mkdirSync(path.join(TARGET, 'graphics'), { recursive: true });
    let copied = 0;
    for (const g of graphics) {
        // src вида /graphics/<category>/<slug>.svg — тот же относительный путь в каталоге.
        const rel = String(g.src).replace(/^\//, '');
        const from = path.join(tmp, 'public', rel);
        if (!fs.existsSync(from)) throw new Error(`${g.id}: ${g.src} is missing in the archive`);
        if (typeof sizes[g.id] !== 'number') throw new Error(`${g.id}: no entry in lib/graphic-sizes.json`);
        const to = path.join(TARGET, rel);
        fs.mkdirSync(path.dirname(to), { recursive: true });
        fs.writeFileSync(to, cleanSvg(fs.readFileSync(from, 'utf8')));
        copied++;
    }
    fs.copyFileSync(path.join(tmp, 'lib', 'graphics.json'), path.join(TARGET, 'graphics.json'));
    fs.copyFileSync(path.join(tmp, 'lib', 'graphic-sizes.json'), path.join(TARGET, 'graphic-sizes.json'));
    fs.copyFileSync(path.join(tmp, 'LICENSE'), path.join(TARGET, 'LICENSE'));
    fs.writeFileSync(path.join(TARGET, 'VERSION'), `${sha}\n`);
    console.log(`vendor/wireflow: ${copied} graphics, VERSION ${sha}`);
} finally {
    fs.rmSync(tmp, { recursive: true, force: true });
}
