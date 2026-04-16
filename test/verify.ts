#!/usr/bin/env npx ts-node
/**
 * Verifies the TypeScript parser output against expected output from the C++ library.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { parseSaveGame, SaveGameData } from '../src/savegame/GamebryoSaveGame';

const SAVES_DIR = path.join(__dirname, 'saves');
const EXPECTED_DIR = path.join(__dirname, 'expected');
const GAME_DIRS = ['oblivion', 'skyrim', 'skyrimse', 'fallout3', 'falloutnv', 'fallout4'];
const SAVE_EXTENSIONS = ['.ess', '.fos'];

let totalTests = 0;
let passed = 0;
let failed = 0;
const failures: string[] = [];

function trimAtNull(s: unknown): unknown {
  if (typeof s !== 'string') return s;
  const idx = s.indexOf('\u0000');
  return idx >= 0 ? s.substring(0, idx) : s;
}

function assertEqual(label: string, actual: unknown, expected: unknown): void {
  totalTests++;
  const a = trimAtNull(actual);
  const e = trimAtNull(expected);
  if (a === e) {
    passed++;
  } else {
    failed++;
    failures.push(`  ${label}: expected ${JSON.stringify(e)}, got ${JSON.stringify(a)}`);
  }
}

function assertArrayEqual(label: string, actual: string[], expected: string[]): void {
  totalTests++;
  if (JSON.stringify(actual) === JSON.stringify(expected)) {
    passed++;
  } else {
    failed++;
    const diff: string[] = [];
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

interface ExpectedData {
  fileName: string;
  error?: string;
  quick: {
    characterName: string;
    characterLevel: number;
    location: string;
    saveNumber: number;
    creationTime: number;
    playTime: string;
  };
  full: {
    characterName: string;
    characterLevel: number;
    location: string;
    saveNumber: number;
    creationTime: number;
    playTime: string;
    plugins: string[];
    screenshotSize?: { width: number; height: number };
    screenshotHash?: string;
    screenshotLength?: number;
  };
}

function verifySave(game: string, saveFile: string): void {
  const baseName = path.basename(saveFile, path.extname(saveFile));
  const safeName = baseName.replace(/[^a-zA-Z0-9_-]/g, '_').substring(0, 80);
  const expectedPath = path.join(EXPECTED_DIR, game, `${safeName}.json`);

  if (!fs.existsSync(expectedPath)) {
    console.log(`  SKIP ${saveFile} (no expected output)`);
    return;
  }

  const expected: ExpectedData = JSON.parse(fs.readFileSync(expectedPath, 'utf8'));
  if (expected.error) {
    console.log(`  SKIP ${saveFile} (expected error: ${expected.error})`);
    return;
  }

  const filePath = path.join(SAVES_DIR, game, saveFile);

  // Test quick read
  try {
    const quick: SaveGameData = parseSaveGame(filePath, true);
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
    failures.push(`  ${saveFile} quick read THREW: ${(err as Error).message}`);
  }

  // Test full read
  try {
    const full: SaveGameData = parseSaveGame(filePath, false);
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

    if (ef.screenshotHash) {
      const hash = crypto.createHash('sha256').update(full.screenshot).digest('hex');
      assertEqual(`${saveFile} full.screenshotHash`, hash, ef.screenshotHash);
      assertEqual(`${saveFile} full.screenshotLength`, full.screenshot.length, ef.screenshotLength);
    }
  } catch (err) {
    failed++;
    totalTests++;
    failures.push(`  ${saveFile} full read THREW: ${(err as Error).message}\n    ${(err as Error).stack!.split('\n').slice(1, 3).join('\n    ')}`);
  }
}

function main(): void {
  console.log('Verifying TypeScript parser against expected output...\n');

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
