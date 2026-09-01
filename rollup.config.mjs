import typescript from '@rollup/plugin-typescript';
import resolve from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';
import JavaScriptObfuscator from 'javascript-obfuscator';
import fs from 'fs';

const pkg = JSON.parse(fs.readFileSync('./package.json', 'utf-8'));

const userScriptBanner = `// ==UserScript==
// @name         IVision FSSC Autopilot (元年云费控极速自动驾驶副驾)
// @namespace    https://github.com/Chris-C1108/iv-fssc-autopilot
// @version      ${pkg.version}
// @description  元年云报销全流程超级副驾：①【发票夹 & 费用记录】全量OCR数据穿透补全(乘车时间/里程100%恢复)、自动识别通信费、自由切换分类、早晚行程智能推断、拖拽多附件；②【经费报销单页】丰富多维菜单Item(科目/项目/成本中心/向客户请款)、自动聚合备注TAG(如X2605-001)、智能检索匹配项目、蝴蝶效应引擎链式联动、一键自动持久化保存(saveBillData)并自动刷新单据视图；③【极速模式】首行蝴蝶+内存克隆+单次入库(30倍提速)。
// @author       Chris-C1108
// @match        https://ync37.yuanian.com/fssc/*
// @match        https://time-mg.huge-vision.com/*
// @noframes
// @grant        GM_xmlhttpRequest
// @grant        unsafeWindow
// @run-at       document-end
// ==/UserScript==
`;

function customObfuscatePlugin(banner) {
  return {
    name: 'custom-obfuscator',
    renderChunk(code) {
      const obfuscated = JavaScriptObfuscator.obfuscate(code, {
        compact: true,
        controlFlowFlattening: true,
        controlFlowFlatteningThreshold: 0.75,
        deadCodeInjection: false,
        debugProtection: false,
        disableConsoleOutput: false,
        identifierNamesGenerator: 'hexadecimal',
        log: false,
        numbersToExpressions: true,
        renameGlobals: false,
        selfDefending: false,
        simplify: true,
        splitStrings: true,
        splitStringsChunkLength: 10,
        stringArray: true,
        stringArrayCallsTransform: true,
        stringArrayEncoding: ['base64', 'rc4'],
        stringArrayIndexShift: true,
        stringArrayRotate: true,
        stringArrayShuffle: true,
        stringArrayWrappersCount: 2,
        stringArrayWrappersType: 'variable',
        stringArrayThreshold: 0.85,
        transformObjectKeys: true,
        unicodeEscapeSequence: false
      });
      // 确保油猴元数据 Banner 严格置于文件最顶部且不被混淆
      return {
        code: banner.trim() + '\n\n' + obfuscated.getObfuscatedCode(),
        map: null
      };
    }
  };
}

export default [
  // 1. 生产环境高强度混淆构建 (Production Obfuscated)
  {
    input: 'src/index.ts',
    output: {
      file: 'dist/iv-fssc-autopilot.user.js',
      format: 'iife',
      sourcemap: false
    },
    plugins: [
      resolve({ browser: true }),
      commonjs(),
      typescript({ tsconfig: './tsconfig.json' }),
      customObfuscatePlugin(userScriptBanner)
    ]
  },
  // 2. 开发调试版本 (Dev Unobfuscated with SourceMap)
  {
    input: 'src/index.ts',
    output: {
      file: 'dist/iv-fssc-autopilot.dev.user.js',
      format: 'iife',
      banner: userScriptBanner,
      sourcemap: true
    },
    plugins: [
      resolve({ browser: true }),
      commonjs(),
      typescript({ tsconfig: './tsconfig.json' })
    ]
  }
];
