const fs = require('fs');
const path = require('path');
const { parseContractId } = require('./cache-resolver');

const cacheDir = path.join(__dirname, '..', 'cache');
const backupDir = path.join(__dirname, '..', 'cache_backup');

function copyRecursiveSync(src, dest) {
  if (fs.existsSync(src)) {
    fs.mkdirSync(dest, { recursive: true });
    fs.readdirSync(src).forEach((file) => {
      const srcPath = path.join(src, file);
      const destPath = path.join(dest, file);
      if (fs.lstatSync(srcPath).isDirectory()) {
        copyRecursiveSync(srcPath, destPath);
      } else {
        fs.copyFileSync(srcPath, destPath);
      }
    });
  }
}

function migrateDir(type) {
  const oldDir = path.join(cacheDir, type);
  if (!fs.existsSync(oldDir)) return;

  const files = fs.readdirSync(oldDir).filter(f => f.endsWith('.json') && f !== 'metadata.json' && f !== 'test.json');
  console.log(`Found ${files.length} flat files in cache/${type}/`);

  if (files.length === 0) {
    console.log(`No flat files to migrate in cache/${type}/`);
    return;
  }

  const metadata = {};

  for (const file of files) {
    const contractId = file.replace('.json', '');
    const parsed = parseContractId(contractId);
    if (!parsed) continue;

    const { ticker, expiry } = parsed;
    
    // update metadata
    if (!metadata[ticker]) {
      metadata[ticker] = {
        ticker: ticker,
        lastCapture: new Date().toISOString().substring(0, 16).replace('T', ' '),
        contracts: 0,
        expirations: new Set(),
        version: 2
      };
    }
    metadata[ticker].contracts++;
    metadata[ticker].expirations.add(expiry);

    const targetDir = path.join(oldDir, ticker, expiry);
    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }

    const oldPath = path.join(oldDir, file);
    const newPath = path.join(targetDir, file);
    
    fs.copyFileSync(oldPath, newPath);
  }

  // write metadata.json
  for (const ticker in metadata) {
    metadata[ticker].expirations = Array.from(metadata[ticker].expirations).sort();
    const metaPath = path.join(oldDir, ticker, 'metadata.json');
    fs.writeFileSync(metaPath, JSON.stringify(metadata[ticker], null, 2), 'utf8');
  }

  // validate count and delete old files
  let afterCount = 0;
  for (const ticker in metadata) {
      afterCount += metadata[ticker].contracts;
  }
  
  if (afterCount === files.length) {
    for (const file of files) {
      fs.unlinkSync(path.join(oldDir, file));
    }
    console.log(`Migrated ${type}: Before: ${files.length}, After: ${afterCount}`);
  } else {
    console.log(`Migration validation failed for ${type}. Before: ${files.length}, After: ${afterCount}`);
  }
}

function run() {
  console.log('Creating backup...');
  copyRecursiveSync(cacheDir, backupDir);
  console.log('Backup created at cache_backup/');

  migrateDir('uw');
  migrateDir('dealer');
  
  console.log('Migration complete.');
}

run();
