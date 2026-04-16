#!/usr/bin/env node
/**
 * Downloads save game files from Nexus Mods for each supported game format.
 * Requires NEXUS_API_KEY environment variable (premium account for direct downloads).
 * Uses 7-Zip for extraction.
 */

const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const API_KEY = process.env.NEXUS_API_KEY;
if (!API_KEY) {
  console.error('NEXUS_API_KEY environment variable not set');
  process.exit(1);
}

const SEVENZIP = 'C:\\Program Files\\7-Zip\\7z.exe';
const SAVES_DIR = path.join(__dirname, 'saves');
const TEMP_DIR = path.join(__dirname, '.tmp');

// Size limits to keep git repo manageable
const MAX_ARCHIVE_KB = 5000;     // Skip archives larger than 5MB
const MAX_SAVE_FILE_BYTES = 5 * 1024 * 1024;  // Skip individual saves larger than 5MB

// Game definitions: local folder name, Nexus domain, mod IDs to try
const GAMES = [
  {
    folder: 'oblivion',
    domain: 'oblivion',
    extensions: ['.ess'],
    modIds: [50861, 53859, 55906, 55698, 50152, 48602, 46404, 46014, 49128, 51480,
             50346, 50214, 50534, 47073, 47009, 46279, 46183, 46039, 45883, 45841,
             44756, 43403, 42531, 42298, 41809, 44802, 42557, 42356, 42876, 42899],
  },
  {
    folder: 'skyrim',
    domain: 'skyrim',
    extensions: ['.ess'],
    modIds: [120644, 116818, 118156, 117556, 117207, 112127, 115599, 110216, 105110, 104688,
             119747, 118667, 117475, 117372, 117371, 117370, 113341, 112262, 111269, 111005],
  },
  {
    folder: 'skyrimse',
    domain: 'skyrimspecialedition',
    extensions: ['.ess'],
    modIds: [58357, 77281, 104079, 164110, 160768, 164113, 143256, 166850, 167049, 170025,
             155512, 138442, 167095, 168393, 166850],
  },
  {
    folder: 'fallout3',
    domain: 'fallout3',
    extensions: ['.fos'],
    modIds: [27038, 25278, 25250, 24987, 24384, 24765, 22702, 23799, 22399, 22894,
             25530, 25126, 24113, 24022, 23784, 23328, 22486, 22397, 22399, 26521],
  },
  {
    folder: 'falloutnv',
    domain: 'newvegas',
    extensions: ['.fos'],
    modIds: [97129, 96222, 88896, 88321, 86474, 86310, 90159, 89052, 90353, 88118,
             79360, 94261, 97236, 96434, 85617, 85571,
             91884, 91870, 96195, 97151],
  },
  {
    folder: 'fallout4',
    domain: 'fallout4',
    extensions: ['.fos'],
    modIds: [102264, 102135, 102134, 98185, 98117, 92904, 92142, 83242, 100316, 92300,
             103050, 101038, 99147, 97375, 96704, 95652,
             94623, 94469, 94467, 93890, 93484, 91812, 95235, 77344],
  },
];

const TARGET_COUNT = 10;

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function fetch(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url);
    const mod = parsedUrl.protocol === 'https:' ? https : http;
    const opts = {
      hostname: parsedUrl.hostname,
      path: parsedUrl.pathname + parsedUrl.search,
      headers: { ...headers, 'User-Agent': 'save-game-test-downloader/1.0' },
    };
    mod.get(opts, (res) => {
      // Follow redirects
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return fetch(res.headers.location, headers).then(resolve, reject);
      }
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error(`HTTP ${res.statusCode} for ${url}`));
      }
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => resolve(Buffer.concat(chunks)));
      res.on('error', reject);
    }).on('error', reject);
  });
}

async function nexusApi(endpoint) {
  const url = `https://api.nexusmods.com/v1${endpoint}`;
  const buf = await fetch(url, { apikey: API_KEY });
  return JSON.parse(buf.toString('utf8'));
}

async function getDownloadUrl(domain, modId, fileId) {
  const links = await nexusApi(`/games/${domain}/mods/${modId}/files/${fileId}/download_link.json`);
  if (links.length === 0) throw new Error('No download links');
  return links[0].URI;
}

async function downloadFile(url, destPath) {
  const buf = await fetch(url);
  fs.writeFileSync(destPath, buf);
  return destPath;
}

function extractArchive(archivePath, destDir) {
  fs.mkdirSync(destDir, { recursive: true });
  try {
    execSync(`"${SEVENZIP}" x -y -o"${destDir}" "${archivePath}"`, {
      stdio: 'pipe',
      timeout: 60000,
    });
  } catch (e) {
    // Try as zip fallback
    try {
      execSync(`unzip -o "${archivePath}" -d "${destDir}"`, {
        stdio: 'pipe',
        timeout: 60000,
      });
    } catch (e2) {
      console.warn(`  Failed to extract ${path.basename(archivePath)}: ${e.message}`);
      return [];
    }
  }

  // Find all save files recursively
  const saves = [];
  function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else {
        saves.push(full);
      }
    }
  }
  walk(destDir);
  return saves;
}

function findSaveFiles(files, extensions) {
  return files.filter(f => {
    const ext = path.extname(f).toLowerCase();
    return extensions.includes(ext);
  });
}

async function processGame(game) {
  const gameDir = path.join(SAVES_DIR, game.folder);
  const gameTmp = path.join(TEMP_DIR, game.folder);
  fs.mkdirSync(gameTmp, { recursive: true });

  // Count existing saves
  const existing = fs.readdirSync(gameDir).filter(f => {
    const ext = path.extname(f).toLowerCase();
    return game.extensions.includes(ext);
  });
  if (existing.length >= TARGET_COUNT) {
    console.log(`[${game.folder}] Already have ${existing.length} saves, skipping`);
    return;
  }

  let collected = existing.length;
  console.log(`[${game.folder}] Have ${collected}/${TARGET_COUNT} saves, downloading more...`);

  for (const modId of game.modIds) {
    if (collected >= TARGET_COUNT) break;

    try {
      // Get file list for this mod
      const filesResp = await nexusApi(`/games/${game.domain}/mods/${modId}/files.json`);
      const files = filesResp.files || [];

      // Prefer MAIN files, fall back to any — filter by archive size
      const mainFiles = files.filter(f => f.category_name === 'MAIN' && f.size_kb <= MAX_ARCHIVE_KB);
      const allValid = files.filter(f => f.category_name !== 'DELETED' && f.size_kb <= MAX_ARCHIVE_KB);
      const candidates = mainFiles.length > 0 ? mainFiles : allValid;

      // Sort by size ascending — prefer smallest archives
      candidates.sort((a, b) => a.size_kb - b.size_kb);

      if (candidates.length === 0) {
        const smallest = files.filter(f => f.category_name !== 'DELETED').sort((a, b) => a.size_kb - b.size_kb)[0];
        console.log(`  [${game.folder}] mod ${modId}: no files under ${MAX_ARCHIVE_KB}kb (smallest: ${smallest ? smallest.size_kb + 'kb' : 'none'})`);
        continue;
      }

      // Download the smallest candidate
      const fileInfo = candidates[0];
      console.log(`  [${game.folder}] mod ${modId}: downloading ${fileInfo.file_name} (${fileInfo.size_kb}kb)`);

      const downloadUrl = await getDownloadUrl(game.domain, modId, fileInfo.file_id);
      const archivePath = path.join(gameTmp, fileInfo.file_name);
      await downloadFile(downloadUrl, archivePath);

      // Extract and find save files
      const extractDir = path.join(gameTmp, `mod_${modId}`);
      const allFiles = extractArchive(archivePath, extractDir);
      const saveFiles = findSaveFiles(allFiles, game.extensions);

      if (saveFiles.length === 0) {
        console.log(`  [${game.folder}] mod ${modId}: no ${game.extensions.join('/')} files in archive`);
        continue;
      }

      // Copy save files to game dir — filter by individual file size, prefer smallest
      saveFiles.sort((a, b) => fs.statSync(a).size - fs.statSync(b).size);
      for (const sf of saveFiles) {
        if (collected >= TARGET_COUNT) break;
        const fileSize = fs.statSync(sf).size;
        if (fileSize > MAX_SAVE_FILE_BYTES) {
          const sizeKb = Math.round(fileSize / 1024);
          console.log(`    SKIP ${path.basename(sf)} (${sizeKb}kb > ${MAX_SAVE_FILE_BYTES / 1024}kb limit)`);
          continue;
        }
        const destName = path.basename(sf);
        const destPath = path.join(gameDir, destName);
        const sizeKb = Math.round(fileSize / 1024);
        if (fs.existsSync(destPath)) {
          const altDest = path.join(gameDir, `mod${modId}_${destName}`);
          if (!fs.existsSync(altDest)) {
            fs.copyFileSync(sf, altDest);
            collected++;
            console.log(`    -> ${path.basename(altDest)} (${sizeKb}kb)`);
          }
        } else {
          fs.copyFileSync(sf, destPath);
          collected++;
          console.log(`    -> ${destName} (${sizeKb}kb)`);
        }
      }

      // Small delay to be polite to the API
      await sleep(500);
    } catch (err) {
      console.warn(`  [${game.folder}] mod ${modId}: ${err.message}`);
      await sleep(1000);
    }
  }

  console.log(`[${game.folder}] Done: ${collected} saves collected`);
}

async function main() {
  fs.mkdirSync(TEMP_DIR, { recursive: true });

  for (const game of GAMES) {
    await processGame(game);
  }

  // Cleanup temp dir
  try {
    fs.rmSync(TEMP_DIR, { recursive: true, force: true });
    console.log('\nCleaned up temp directory');
  } catch (e) {
    console.warn('Could not clean temp dir:', e.message);
  }

  // Print summary
  console.log('\n=== Summary ===');
  for (const game of GAMES) {
    const gameDir = path.join(SAVES_DIR, game.folder);
    const saves = fs.readdirSync(gameDir).filter(f => {
      const ext = path.extname(f).toLowerCase();
      return game.extensions.includes(ext);
    });
    const totalKb = saves.reduce((sum, s) => sum + Math.round(fs.statSync(path.join(gameDir, s)).size / 1024), 0);
    console.log(`${game.folder}: ${saves.length} saves (${totalKb}kb total)`);
    saves.forEach(s => {
      const kb = Math.round(fs.statSync(path.join(gameDir, s)).size / 1024);
      console.log(`  ${s} (${kb}kb)`);
    });
  }
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
