const path = require('path');
const fs = require('fs');

function parseContractId(contractId) {
  // SPY260608P00745000 -> ticker: SPY, date: 260608 (2026-06-08)
  const match = contractId.match(/^([A-Z]+)(\d{6})[CP]\d+$/);
  if (match) {
    const ticker = match[1];
    const dateStr = match[2];
    const year = "20" + dateStr.substring(0, 2);
    const month = dateStr.substring(2, 4);
    const day = dateStr.substring(4, 6);
    const expiry = `${year}-${month}-${day}`;
    return { ticker, expiry };
  }
  return null;
}

function getCachePath(baseDir, contractId) {
  const parsed = parseContractId(contractId);
  if (!parsed) {
    return path.join(baseDir, `${contractId}.json`);
  }
  const { ticker, expiry } = parsed;
  const newPath = path.join(baseDir, ticker, expiry, `${contractId}.json`);
  const oldPath = path.join(baseDir, `${contractId}.json`);

  if (fs.existsSync(newPath)) {
    return newPath;
  }
  if (fs.existsSync(oldPath)) {
    return oldPath;
  }
  return newPath; // default to new structure
}

function getCacheDir(baseDir, contractId) {
  const parsed = parseContractId(contractId);
  if (!parsed) {
    return baseDir;
  }
  return path.join(baseDir, parsed.ticker, parsed.expiry);
}

module.exports = {
  parseContractId,
  getCachePath,
  getCacheDir
};
