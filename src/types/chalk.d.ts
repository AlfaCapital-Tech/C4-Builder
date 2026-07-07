// chalk@2 несёт .d.ts в ESM-стиле (export default) при CJS-рантайме: под nodenext
// дефолт-импорт типизируется как namespace, хотя в рантайме это сам инстанс.
// Локальная декларация по фактическому потреблению (цепочечные цвета/модификаторы,
// вызываемые как chalk.x(text)), выравнивает типы с рантаймом.
declare module 'chalk' {
    type ChalkFn = (...text: unknown[]) => string;
    interface Chalk extends ChalkFn {
        green: Chalk;
        blue: Chalk;
        gray: Chalk;
        red: Chalk;
        yellow: Chalk;
        bold: Chalk;
        cyan: Chalk;
    }
    const chalk: Chalk;
    export default chalk;
}
