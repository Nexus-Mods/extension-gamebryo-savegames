#!/usr/bin/env node
/**
 * Verifies the TypeScript parser output against expected output from the C++ library.
 * Runs the TS parser directly via ts-node or compiled JS.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// We'll require the compiled TS files. Since the project uses webpack,
// let's require the source directly via a simple transpile approach.
// For now, let's use a direct approach: load the parser module.

// Add ts-node if available, otherwise we'll need to compile first
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
} catch (e) {
  // ts-node not available; try requiring compiled output
}

let parseSaveGame;
try {
  // Try TS source first
  const mod = require('../src/savegame/GamebryoSaveGame');
  parseSaveGame = mod.parseSaveGame;
} catch (e) {
  console.error('Could not load parser:', e.message);
  console.error('Install ts-node: npm install -D ts-node');
  process.exit(1);
}

const SAVES_DIR = path.join(__dirname, 'saves');
const EXPECTED_DIR = path.join(__dirname, 'expected');
const GAME_DIRS = ['oblivion', 'skyrim', 'skyrimse', 'fallout3', 'falloutnv', 'fallout4'];
const SAVE_EXTENSIONS = ['.ess', '.fos'];

let totalTests = 0;
let passed = 0;
let failed = 0;
const failures = [];

function trimAtNull(s) {
  if (typeof s !== 'string') return s;
  const idx = s.indexOf('\u0000');
  return idx >= 0 ? s.substring(0, idx) : s;
}

function assertEqual(label, actual, expected) {
  totalTests++;
  // Trim strings at null terminator — C++ library sometimes reads past it
  const a = trimAtNull(actual);
  const e = trimAtNull(expected);
  if (a === e) {
    passed++;
  } else {
    failed++;
    failures.push(`  ${label}: expected ${JSON.stringify(e)}, got ${JSON.stringify(a)}`);
  }
}

function assertArrayEqual(label, actual, expected) {
  totalTests++;
  if (JSON.stringify(actual) === JSON.stringify(expected)) {
    passed++;
  } else {
    failed++;
    const diff = [];
    const maxLen = Math.max(actual.length, expected.length);
    for (let i = 0; i < maxLen; i++) {
      if (actual[i] !== expected[i]) {
        diff.push(`    [${i}]: expected ${JSON.stringify(expected[i])}, got ${JSON.stringify(actual[i])}`);
        if (diff.length > 5) {
          diff.push(`    ... and ${maxLen - i - 1} more differences`);
          break;
        }
      }
    }
    failures.push(`  ${label}: arrays differ (expected ${expected.length} items, got ${actual.length} items)\n${diff.join('\n')}`);
  }
}

function verifySave(game, saveFile) {
  const baseName = path.basename(saveFile, path.extname(saveFile));
  const safeName = baseName.replace(/[^a-zA-Z0-9_-]/g, '_').substring(0, 80);
  const expectedPath = path.join(EXPECTED_DIR, game, `${safeName}.json`);

  if (!fs.existsSync(expectedPath)) {
    console.log(`  SKIP ${saveFile} (no expected output)`);
    return;
  }

  const expected = JSON.parse(fs.readFileSync(expectedPath, 'utf8'));
  if (expected.error) {
    console.log(`  SKIP ${saveFile} (expected error: ${expected.error})`);
    return;
  }

  const filePath = path.join(SAVES_DIR, game, saveFile);

  // Test quick read
  try {
    const quick = parseSaveGame(filePath, true);
    const eq = expected.quick;
    assertEqual(`${saveFile} quick.characterName`, quick.characterName, eq.characterName);
    assertEqual(`${saveFile} quick.characterLevel`, quick.characterLevel, eq.characterLevel);
    assertEqual(`${saveFile} quick.location`, quick.location, eq.location);
    assertEqual(`${saveFile} quick.saveNumber`, quick.saveNumber, eq.saveNumber);
    assertEqual(`${saveFile} quick.creationTime`, quick.creationTime, eq.creationTime);
    assertEqual(`${saveFile} quick.playTime`, quick.playTime, eq.playTime);
  } catch (err) {
    failed++;
    totalTests++;
    failures.push(`  ${saveFile} quick read THREW: ${err.message}`);
  }

  // Test full read
  try {
    const full = parseSaveGame(filePath, false);
    const ef = expected.full;
    assertEqual(`${saveFile} full.characterName`, full.characterName, ef.characterName);
    assertEqual(`${saveFile} full.characterLevel`, full.characterLevel, ef.characterLevel);
    assertEqual(`${saveFile} full.location`, full.location, ef.location);
    assertEqual(`${saveFile} full.saveNumber`, full.saveNumber, ef.saveNumber);
    assertEqual(`${saveFile} full.creationTime`, full.creationTime, ef.creationTime);
    assertEqual(`${saveFile} full.playTime`, full.playTime, ef.playTime);
    assertArrayEqual(`${saveFile} full.plugins`, full.plugins, ef.plugins);

    if (ef.screenshotSize) {
      assertEqual(`${saveFile} full.screenshotSize.width`, full.screenshotSize.width, ef.screenshotSize.width);
      assertEqual(`${saveFile} full.screenshotSize.height`, full.screenshotSize.height, ef.screenshotSize.height);
    }

    // Verify screenshot hash if available
    if (ef.screenshotHash) {
      const hash = crypto.createHash('sha256').update(full.screenshot).digest('hex');
      assertEqual(`${saveFile} full.screenshotHash`, hash, ef.screenshotHash);
      assertEqual(`${saveFile} full.screenshotLength`, full.screenshot.length, ef.screenshotLength);
    }
  } catch (err) {
    failed++;
    totalTests++;
    failures.push(`  ${saveFile} full read THREW: ${err.message}\n    ${err.stack.split('\n').slice(1, 3).join('\n    ')}`);
  }
}

function main() {
  console.log('Verifying TypeScript parser against C++ expected output...\n');

  for (const game of GAME_DIRS) {
    const saveDir = path.join(SAVES_DIR, game);
    const files = fs.readdirSync(saveDir).filter(f => {
      const ext = path.extname(f).toLowerCase();
      return SAVE_EXTENSIONS.includes(ext);
    });

    const prevFailed = failed;
    console.log(`[${game}] Testing ${files.length} saves...`);
    for (const file of files) {
      verifySave(game, file);
    }

    if (failed === prevFailed) {
      console.log(`[${game}] ALL PASSED\n`);
    } else {
      console.log(`[${game}] ${failed - prevFailed} FAILURES\n`);
    }
  }

  console.log(`\n=== Results ===`);
  console.log(`Total assertions: ${totalTests}`);
  console.log(`Passed: ${passed}`);
  console.log(`Failed: ${failed}`);

  if (failures.length > 0) {
    console.log(`\n=== Failures ===`);
    failures.forEach(f => console.log(f));
  }

  process.exit(failed > 0 ? 1 : 0);
}

main();
