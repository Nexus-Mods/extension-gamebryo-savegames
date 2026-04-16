#!/usr/bin/env node
/**
 * Benchmarks the TypeScript parser against the C++ native module.
 */

const fs = require('fs');
const path = require('path');

try {
  require('ts-node').register({
    transpileOnly: true,
    compilerOptions: {
      module: 'commonjs',
      moduleResolution: 'node10',
      target: 'es2020',
      esModuleInterop: true,
      ignoreDeprecations: '6.0',
    },
  });
} catch (e) {}

const { parseSaveGame } = require('../src/savegame/GamebryoSaveGame');

let nativeLib;
try {
  nativeLib = require('C:\\oss\\node-gamebryo-savegames\\dist\\index.js');
} catch (e) {
  console.log('Native module not available, benchmarking TS only\n');
}

const SAVES_DIR = path.join(__dirname, 'saves');
const GAMES = ['oblivion', 'skyrim', 'skyrimse', 'fallout3', 'falloutnv', 'fallout4'];
const EXTS = ['.ess', '.fos'];

function getAllSaves() {
  const saves = [];
  for (const game of GAMES) {
    const dir = path.join(SAVES_DIR, game);
    for (const f of fs.readdirSync(dir)) {
      if (EXTS.includes(path.extname(f).toLowerCase())) {
        saves.push({ game, file: f, path: path.join(dir, f), size: fs.statSync(path.join(dir, f)).size });
      }
    }
  }
  return saves;
}

function benchTS(saves, quick) {
  const start = process.hrtime.bigint();
  for (const s of saves) {
    parseSaveGame(s.path, quick);
  }
  const elapsed = Number(process.hrtime.bigint() - start) / 1e6;
  return elapsed;
}

function benchNative(saves, quick) {
  return new Promise((resolve) => {
    const start = process.hrtime.bigint();
    let done = 0;
    for (const s of saves) {
      nativeLib.create(s.path, quick, () => {
        done++;
        if (done === saves.length) {
          const elapsed = Number(process.hrtime.bigint() - start) / 1e6;
          resolve(elapsed);
        }
      });
    }
  });
}

async function main() {
  const saves = getAllSaves();
  const totalSizeKB = saves.reduce((s, f) => s + f.size, 0) / 1024;
  console.log(`Benchmarking ${saves.length} saves (${Math.round(totalSizeKB)}KB total)\n`);

  // Per-game breakdown
  const byGame = {};
  for (const s of saves) {
    if (!byGame[s.game]) byGame[s.game] = [];
    byGame[s.game].push(s);
  }

  // Warm up (first run loads files into OS cache)
  benchTS(saves, true);
  benchTS(saves, false);

  const RUNS = 5;

  // --- Quick read benchmarks ---
  console.log('=== Quick Read (metadata only) ===\n');

  const tsQuickTimes = [];
  for (let i = 0; i < RUNS; i++) tsQuickTimes.push(benchTS(saves, true));
  const tsQuickAvg = tsQuickTimes.reduce((a, b) => a + b) / RUNS;
  const tsQuickPerSave = tsQuickAvg / saves.length;

  console.log(`TypeScript:  ${tsQuickAvg.toFixed(1)}ms total, ${tsQuickPerSave.toFixed(2)}ms/save (${RUNS} runs)`);

  if (nativeLib) {
    const nativeQuickTimes = [];
    for (let i = 0; i < RUNS; i++) nativeQuickTimes.push(await benchNative(saves, true));
    const nativeQuickAvg = nativeQuickTimes.reduce((a, b) => a + b) / RUNS;
    const nativeQuickPerSave = nativeQuickAvg / saves.length;
    console.log(`C++ Native:  ${nativeQuickAvg.toFixed(1)}ms total, ${nativeQuickPerSave.toFixed(2)}ms/save (${RUNS} runs)`);
    console.log(`Ratio:       ${(tsQuickAvg / nativeQuickAvg).toFixed(2)}x`);
  }

  // --- Full read benchmarks ---
  console.log('\n=== Full Read (metadata + plugins + screenshot) ===\n');

  const tsFullTimes = [];
  for (let i = 0; i < RUNS; i++) tsFullTimes.push(benchTS(saves, false));
  const tsFullAvg = tsFullTimes.reduce((a, b) => a + b) / RUNS;
  const tsFullPerSave = tsFullAvg / saves.length;

  console.log(`TypeScript:  ${tsFullAvg.toFixed(1)}ms total, ${tsFullPerSave.toFixed(2)}ms/save (${RUNS} runs)`);

  if (nativeLib) {
    const nativeFullTimes = [];
    for (let i = 0; i < RUNS; i++) nativeFullTimes.push(await benchNative(saves, false));
    const nativeFullAvg = nativeFullTimes.reduce((a, b) => a + b) / RUNS;
    const nativeFullPerSave = nativeFullAvg / saves.length;
    console.log(`C++ Native:  ${nativeFullAvg.toFixed(1)}ms total, ${nativeFullPerSave.toFixed(2)}ms/save (${RUNS} runs)`);
    console.log(`Ratio:       ${(tsFullAvg / nativeFullAvg).toFixed(2)}x`);
  }

  // --- Per-game breakdown (TS only, quick read) ---
  console.log('\n=== Per-Game Breakdown (TypeScript, quick read) ===\n');
  for (const game of GAMES) {
    const gameSaves = byGame[game] || [];
    if (gameSaves.length === 0) continue;
    const times = [];
    for (let i = 0; i < RUNS; i++) times.push(benchTS(gameSaves, true));
    const avg = times.reduce((a, b) => a + b) / RUNS;
    const perSave = avg / gameSaves.length;
    const sizeKB = gameSaves.reduce((s, f) => s + f.size, 0) / 1024;
    console.log(`${game.padEnd(12)} ${gameSaves.length} saves, ${Math.round(sizeKB)}KB total, ${avg.toFixed(1)}ms total, ${perSave.toFixed(2)}ms/save`);
  }

  // --- Per-game breakdown (TS, full read) ---
  console.log('\n=== Per-Game Breakdown (TypeScript, full read) ===\n');
  for (const game of GAMES) {
    const gameSaves = byGame[game] || [];
    if (gameSaves.length === 0) continue;
    const times = [];
    for (let i = 0; i < RUNS; i++) times.push(benchTS(gameSaves, false));
    const avg = times.reduce((a, b) => a + b) / RUNS;
    const perSave = avg / gameSaves.length;
    const sizeKB = gameSaves.reduce((s, f) => s + f.size, 0) / 1024;
    console.log(`${game.padEnd(12)} ${gameSaves.length} saves, ${Math.round(sizeKB)}KB total, ${avg.toFixed(1)}ms total, ${perSave.toFixed(2)}ms/save`);
  }
}

main().catch(console.error);
