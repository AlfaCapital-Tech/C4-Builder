// Пути рёбер React Flow для wireflow-рендера: перенос `getBezierPath` и `getSmoothStepPath`
// из @xyflow/system 0.0.82 (https://github.com/xyflow/xyflow, packages/system/src/utils/edges).
//
// Copyright (c) 2019-2025 webkid GmbH. MIT License: разрешено использовать, копировать и
// изменять при сохранении этого уведомления; полный текст — https://github.com/xyflow/xyflow/blob/main/LICENSE.
//
// Переносим код, а не ставим пакет: это чистые функции, а пакет тянет d3-drag/d3-zoom ради
// интерактива, которого в сборке нет. Логика и формат строки пути сохранены дословно (включая
// пробелы в `L 110,244Q ...`): форма кривой и точка подписи обязаны совпадать с редактором
// Wireflow, а юнит-тесты сверяют вывод с эталонными значениями пакета той же версии.

export type Position = 'left' | 'top' | 'right' | 'bottom';

interface XY {
    x: number;
    y: number;
}

/** [path, labelX, labelY, offsetX, offsetY] — как в @xyflow/system. */
export type EdgePath = [string, number, number, number, number];

const getBezierEdgeCenter = (
    sourceX: number,
    sourceY: number,
    targetX: number,
    targetY: number,
    sourceControlX: number,
    sourceControlY: number,
    targetControlX: number,
    targetControlY: number
): [number, number, number, number] => {
    // Точка кривой Безье при t=0.5 (не геометрическая середина, но считается просто).
    const centerX = sourceX * 0.125 + sourceControlX * 0.375 + targetControlX * 0.375 + targetX * 0.125;
    const centerY = sourceY * 0.125 + sourceControlY * 0.375 + targetControlY * 0.375 + targetY * 0.125;
    return [centerX, centerY, Math.abs(centerX - sourceX), Math.abs(centerY - sourceY)];
};

const calculateControlOffset = (distance: number, curvature: number): number =>
    distance >= 0 ? 0.5 * distance : curvature * 25 * Math.sqrt(-distance);

const getControlWithCurvature = (
    pos: Position,
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    c: number
): [number, number] => {
    switch (pos) {
        case 'left':
            return [x1 - calculateControlOffset(x1 - x2, c), y1];
        case 'right':
            return [x1 + calculateControlOffset(x2 - x1, c), y1];
        case 'top':
            return [x1, y1 - calculateControlOffset(y1 - y2, c)];
        case 'bottom':
            return [x1, y1 + calculateControlOffset(y2 - y1, c)];
    }
};

export interface BezierPathParams {
    sourceX: number;
    sourceY: number;
    sourcePosition?: Position;
    targetX: number;
    targetY: number;
    targetPosition?: Position;
    curvature?: number;
}

export const getBezierPath = ({
    sourceX,
    sourceY,
    sourcePosition = 'bottom',
    targetX,
    targetY,
    targetPosition = 'top',
    curvature = 0.25
}: BezierPathParams): EdgePath => {
    const [sourceControlX, sourceControlY] = getControlWithCurvature(
        sourcePosition,
        sourceX,
        sourceY,
        targetX,
        targetY,
        curvature
    );
    const [targetControlX, targetControlY] = getControlWithCurvature(
        targetPosition,
        targetX,
        targetY,
        sourceX,
        sourceY,
        curvature
    );
    const [labelX, labelY, offsetX, offsetY] = getBezierEdgeCenter(
        sourceX,
        sourceY,
        targetX,
        targetY,
        sourceControlX,
        sourceControlY,
        targetControlX,
        targetControlY
    );
    return [
        `M${sourceX},${sourceY} C${sourceControlX},${sourceControlY} ${targetControlX},${targetControlY} ${targetX},${targetY}`,
        labelX,
        labelY,
        offsetX,
        offsetY
    ];
};

// Центр прямого отрезка — для простых ступенчатых рёбер.
const getEdgeCenter = (
    sourceX: number,
    sourceY: number,
    targetX: number,
    targetY: number
): [number, number, number, number] => {
    const xOffset = Math.abs(targetX - sourceX) / 2;
    const centerX = targetX < sourceX ? targetX + xOffset : targetX - xOffset;
    const yOffset = Math.abs(targetY - sourceY) / 2;
    const centerY = targetY < sourceY ? targetY + yOffset : targetY - yOffset;
    return [centerX, centerY, xOffset, yOffset];
};

const handleDirections: Record<Position, XY> = {
    left: { x: -1, y: 0 },
    right: { x: 1, y: 0 },
    top: { x: 0, y: -1 },
    bottom: { x: 0, y: 1 }
};

const getDirection = (source: XY, sourcePosition: Position, target: XY): XY => {
    if (sourcePosition === 'left' || sourcePosition === 'right')
        return source.x < target.x ? { x: 1, y: 0 } : { x: -1, y: 0 };
    return source.y < target.y ? { x: 0, y: 1 } : { x: 0, y: -1 };
};

const distance = (a: XY, b: XY): number => Math.sqrt((b.x - a.x) ** 2 + (b.y - a.y) ** 2);

// Имитация ортогональной трассировки: не настоящий роутинг, но быстрый и достаточный для
// step/smoothstep по умолчанию (комментарий оригинала).
const getPoints = (
    source: XY,
    sourcePosition: Position,
    target: XY,
    targetPosition: Position,
    center: { x?: number; y?: number },
    offset: number,
    stepPosition: number
): [XY[], number, number, number, number] => {
    const sourceDir = handleDirections[sourcePosition];
    const targetDir = handleDirections[targetPosition];
    const sourceGapped: XY = { x: source.x + sourceDir.x * offset, y: source.y + sourceDir.y * offset };
    const targetGapped: XY = { x: target.x + targetDir.x * offset, y: target.y + targetDir.y * offset };
    const dir = getDirection(sourceGapped, sourcePosition, targetGapped);
    const dirAccessor: 'x' | 'y' = dir.x !== 0 ? 'x' : 'y';
    const currDir = dir[dirAccessor];
    let points: XY[] = [];
    let centerX: number;
    let centerY: number;
    const sourceGapOffset: XY = { x: 0, y: 0 };
    const targetGapOffset: XY = { x: 0, y: 0 };
    const [, , defaultOffsetX, defaultOffsetY] = getEdgeCenter(source.x, source.y, target.x, target.y);

    // Противоположные стороны хендлов — случай по умолчанию.
    if (sourceDir[dirAccessor] * targetDir[dirAccessor] === -1) {
        if (dirAccessor === 'x') {
            centerX = center.x ?? sourceGapped.x + (targetGapped.x - sourceGapped.x) * stepPosition;
            centerY = center.y ?? (sourceGapped.y + targetGapped.y) / 2;
        } else {
            centerX = center.x ?? (sourceGapped.x + targetGapped.x) / 2;
            centerY = center.y ?? sourceGapped.y + (targetGapped.y - sourceGapped.y) * stepPosition;
        }
        const verticalSplit: XY[] = [
            { x: centerX, y: sourceGapped.y },
            { x: centerX, y: targetGapped.y }
        ];
        const horizontalSplit: XY[] = [
            { x: sourceGapped.x, y: centerY },
            { x: targetGapped.x, y: centerY }
        ];
        if (sourceDir[dirAccessor] === currDir)
            points = dirAccessor === 'x' ? verticalSplit : horizontalSplit;
        else points = dirAccessor === 'x' ? horizontalSplit : verticalSplit;
    } else {
        // sourceTarget: x от источника, y от цели; targetSource — наоборот.
        const sourceTarget: XY[] = [{ x: sourceGapped.x, y: targetGapped.y }];
        const targetSource: XY[] = [{ x: targetGapped.x, y: sourceGapped.y }];
        if (dirAccessor === 'x') points = sourceDir.x === currDir ? targetSource : sourceTarget;
        else points = sourceDir.y === currDir ? sourceTarget : targetSource;

        if (sourcePosition === targetPosition) {
            const diff = Math.abs(source[dirAccessor] - target[dirAccessor]);
            // Хендлы с одной стороны ближе offset друг к другу: без сдвига точки перекрылись бы.
            if (diff <= offset) {
                const gapOffset = Math.min(offset - 1, offset - diff);
                if (sourceDir[dirAccessor] === currDir)
                    sourceGapOffset[dirAccessor] =
                        (sourceGapped[dirAccessor] > source[dirAccessor] ? -1 : 1) * gapOffset;
                else
                    targetGapOffset[dirAccessor] =
                        (targetGapped[dirAccessor] > target[dirAccessor] ? -1 : 1) * gapOffset;
            }
        }

        // Смешанные стороны хендлов (например, right → bottom).
        if (sourcePosition !== targetPosition) {
            const dirAccessorOpposite: 'x' | 'y' = dirAccessor === 'x' ? 'y' : 'x';
            const isSameDir = sourceDir[dirAccessor] === targetDir[dirAccessorOpposite];
            const sourceGtTargetOppo = sourceGapped[dirAccessorOpposite] > targetGapped[dirAccessorOpposite];
            const sourceLtTargetOppo = sourceGapped[dirAccessorOpposite] < targetGapped[dirAccessorOpposite];
            const flipSourceTarget =
                (sourceDir[dirAccessor] === 1 &&
                    ((!isSameDir && sourceGtTargetOppo) || (isSameDir && sourceLtTargetOppo))) ||
                (sourceDir[dirAccessor] !== 1 &&
                    ((!isSameDir && sourceLtTargetOppo) || (isSameDir && sourceGtTargetOppo)));
            if (flipSourceTarget) points = dirAccessor === 'x' ? sourceTarget : targetSource;
        }

        const sourceGapPoint: XY = {
            x: sourceGapped.x + sourceGapOffset.x,
            y: sourceGapped.y + sourceGapOffset.y
        };
        const targetGapPoint: XY = {
            x: targetGapped.x + targetGapOffset.x,
            y: targetGapped.y + targetGapOffset.y
        };
        const maxXDistance = Math.max(
            Math.abs(sourceGapPoint.x - points[0].x),
            Math.abs(targetGapPoint.x - points[0].x)
        );
        const maxYDistance = Math.max(
            Math.abs(sourceGapPoint.y - points[0].y),
            Math.abs(targetGapPoint.y - points[0].y)
        );
        // Подпись — на самом длинном сегменте.
        if (maxXDistance >= maxYDistance) {
            centerX = (sourceGapPoint.x + targetGapPoint.x) / 2;
            centerY = points[0].y;
        } else {
            centerX = points[0].x;
            centerY = (sourceGapPoint.y + targetGapPoint.y) / 2;
        }
    }

    const gappedSource: XY = { x: sourceGapped.x + sourceGapOffset.x, y: sourceGapped.y + sourceGapOffset.y };
    const gappedTarget: XY = { x: targetGapped.x + targetGapOffset.x, y: targetGapped.y + targetGapOffset.y };
    const last = points[points.length - 1];
    // Точки с отступом добавляются, только если не совпадают с первой/последней точкой:
    // дубликаты ломают скругления.
    const pathPoints: XY[] = [
        source,
        ...(gappedSource.x !== points[0].x || gappedSource.y !== points[0].y ? [gappedSource] : []),
        ...points,
        ...(gappedTarget.x !== last.x || gappedTarget.y !== last.y ? [gappedTarget] : []),
        target
    ];
    return [pathPoints, centerX, centerY, defaultOffsetX, defaultOffsetY];
};

const getBend = (a: XY, b: XY, c: XY, size: number): string => {
    const bendSize = Math.min(distance(a, b) / 2, distance(b, c) / 2, size);
    const { x, y } = b;
    // Без изгиба.
    if ((a.x === x && x === c.x) || (a.y === y && y === c.y)) return `L${x} ${y}`;
    // Первый сегмент горизонтальный.
    if (a.y === y) {
        const xDir = a.x < c.x ? -1 : 1;
        const yDir = a.y < c.y ? 1 : -1;
        return `L ${x + bendSize * xDir},${y}Q ${x},${y} ${x},${y + bendSize * yDir}`;
    }
    const xDir = a.x < c.x ? 1 : -1;
    const yDir = a.y < c.y ? -1 : 1;
    return `L ${x},${y + bendSize * yDir}Q ${x},${y} ${x + bendSize * xDir},${y}`;
};

export interface SmoothStepPathParams {
    sourceX: number;
    sourceY: number;
    sourcePosition?: Position;
    targetX: number;
    targetY: number;
    targetPosition?: Position;
    /** 0 — ступенька без скруглений (тип `step` React Flow). */
    borderRadius?: number;
    centerX?: number;
    centerY?: number;
    offset?: number;
    stepPosition?: number;
}

export const getSmoothStepPath = ({
    sourceX,
    sourceY,
    sourcePosition = 'bottom',
    targetX,
    targetY,
    targetPosition = 'top',
    borderRadius = 5,
    centerX,
    centerY,
    offset = 20,
    stepPosition = 0.5
}: SmoothStepPathParams): EdgePath => {
    const [points, labelX, labelY, offsetX, offsetY] = getPoints(
        { x: sourceX, y: sourceY },
        sourcePosition,
        { x: targetX, y: targetY },
        targetPosition,
        { x: centerX, y: centerY },
        offset,
        stepPosition
    );
    let path = `M${points[0].x} ${points[0].y}`;
    for (let i = 1; i < points.length - 1; i++)
        path += getBend(points[i - 1], points[i], points[i + 1], borderRadius);
    path += `L${points[points.length - 1].x} ${points[points.length - 1].y}`;
    return [path, labelX, labelY, offsetX, offsetY];
};
