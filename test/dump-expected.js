#!/usr/bin/env node
/**
 * Reads all test save files using the existing C++ native module and dumps
 * expected JSON output for comparison with the TypeScript rewrite.
 *
 * Requires the native module at C:\oss\node-gamebryo-savegames to be built.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Load the native module
const savegameLib = require('C:\\oss\\node-gamebryo-savegames\\dist\\index.js');

const SAVES_DIR = path.join(__dirname, 'saves');
const EXPECTED_DIR = path.join(__dirname, 'expected');

const GAME_DIRS = ['oblivion', 'skyrim', 'skyrimse', 'fallout3', 'falloutnv', 'fallout4'];
const SAVE_EXTENSIONS = ['.ess', '.fos'];

function parseSave(filePath, quick) {
  return new Promise((resolve, reject) => {
    try {
      savegameLib.create(filePath, quick, (err, sg) => {
        if (err) return reject(err);
        try {
          const result = {
            characterName: sg.characterName,
            characterLevel: sg.characterLevel,
            location: sg.location,
            saveNumber: sg.saveNumber,
            creationTime: sg.creationTime,
            playTime: sg.playTime,
          };

          if (!quick) {
            result.plugins = sg.plugins;
            result.screenshotSize = sg.screenshotSize;
          }

          resolve(result);
        } catch (e) {
          reject(e);
        }
      });
    } catch (e) {
      reject(e);
    }
  });
}

function getScreenshot(filePath) {
  return new Promise((resolve, reject) => {
    try {
      savegameLib.create(filePath, false, (err, sg) => {
        if (err) return reject(err);
        try {
          const buf = sg.screenshot;
          resolve(buf ? Buffer.from(buf) : null);
        } catch (e) {
          reject(e);
        }
      });
    } catch (e) {
      reject(e);
    }
  });
}

async function processGame(game) {
  const saveDir = path.join(SAVES_DIR, game);
  const expectedDir = path.join(EXPECTED_DIR, game);
  fs.mkdirSync(expectedDir, { recursive: true });

  const files = fs.readdirSync(saveDir).filter(f => {
    const ext = path.extname(f).toLowerCase();
    return SAVE_EXTENSIONS.includes(ext);
  });

  console.log(`\n[${game}] Processing ${files.length} saves...`);

  let success = 0;
  let failed = 0;

  for (const file of files) {
    const filePath = path.join(saveDir, file);
    const baseName = path.basename(file, path.extname(file));
    // Sanitize filename for JSON output
    const safeName = baseName.replace(/[^a-zA-Z0-9_-]/g, '_').substring(0, 80);

    try {
      // Quick read (metadata only)
      const quickResult = await parseSave(filePath, true);

      // Full read (with plugins and screenshot size)
      const fullResult = await parseSave(filePath, false);

      // Save expected JSON
      const expected = {
        fileName: file,
        quick: quickResult,
        full: fullResult,
      };

      const jsonPath = path.join(expectedDir, `${safeName}.json`);
      fs.writeFileSync(jsonPath, JSON.stringify(expected, null, 2));

      // Store screenshot hash + first 256 bytes for verification (not full binary)
      try {
        const screenshot = await getScreenshot(filePath);
        if (screenshot && screenshot.length > 0) {
          const hash = crypto.createHash('sha256').update(screenshot).digest('hex');
          expected.full.screenshotHash = hash;
          expected.full.screenshotLength = screenshot.length;
          expected.full.screenshotHead = Buffer.from(screenshot.slice(0, 256)).toString('base64');
          // Re-write the JSON with screenshot info
          fs.writeFileSync(jsonPath, JSON.stringify(expected, null, 2));
          console.log(`  OK: ${file} (screenshot: ${screenshot.length} bytes, ${fullResult.screenshotSize.width}x${fullResult.screenshotSize.height})`);
        } else {
          console.log(`  OK: ${file} (no screenshot data)`);
        }
      } catch (ssErr) {
        console.log(`  OK: ${file} (screenshot error: ${ssErr.message})`);
      }

      success++;
    } catch (err) {
      console.log(`  FAIL: ${file} — ${err.message}`);

      // Still save the error info
      const errorJson = {
        fileName: file,
        error: err.message,
      };
      const jsonPath = path.join(expectedDir, `${safeName}.json`);
      fs.writeFileSync(jsonPath, JSON.stringify(errorJson, null, 2));

      failed++;
    }
  }

  console.log(`[${game}] Done: ${success} success, ${failed} failed`);
}

async function main() {
  console.log('Dumping expected output from C++ native module...');
  console.log(`Save dir: ${SAVES_DIR}`);
  console.log(`Output dir: ${EXPECTED_DIR}`);

  for (const game of GAME_DIRS) {
    await processGame(game);
  }

  // Summary
  console.log('\n=== Expected Output Summary ===');
  for (const game of GAME_DIRS) {
    const expectedDir = path.join(EXPECTED_DIR, game);
    const jsons = fs.readdirSync(expectedDir).filter(f => f.endsWith('.json'));
    const screenshots = fs.readdirSync(expectedDir).filter(f => f.endsWith('.screenshot.bin'));
    console.log(`${game}: ${jsons.length} JSON files, ${screenshots.length} screenshot files`);
  }
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
