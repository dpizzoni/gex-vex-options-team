import fs from 'fs';
import path from 'path';

export type DealerSnapshot = {
  contractId: string;
  buy: number;
  sell: number;
  lastOI: number;
  lastDate: string;
  bias: number;
  source?: "FILE" | "TEST" | "HARDCODE";
};

export function calculateDealerBias(buy: number, sell: number): number {
  const inventory = buy + sell;
  if (inventory === 0) {
    return 0;
  }
  return (buy - sell) / inventory;
}

export function applyDealerExposure(rawGex: number, rawVex: number, bias: number) {
  return {
    dealerGex: rawGex * bias,
    dealerVex: rawVex * bias
  };
}

function getAllJsonFiles(dirPath: string, arrayOfFiles: string[] = []): string[] {
  if (!fs.existsSync(dirPath)) return arrayOfFiles;
  const files = fs.readdirSync(dirPath);
  files.forEach(function(file) {
    const fullPath = path.join(dirPath, file);
    if (fs.statSync(fullPath).isDirectory()) {
      arrayOfFiles = getAllJsonFiles(fullPath, arrayOfFiles);
    } else {
      if (file.endsWith('.json') && file !== 'metadata.json' && file !== 'test.json') {
        arrayOfFiles.push(fullPath);
      }
    }
  });
  return arrayOfFiles;
}

// In-memory cache: cache/dealer/ only changes via a redeploy (data is
// committed by CI) or a local rebuild, so re-parsing every file on every
// request burns Fluid Active CPU for no reason within a warm instance.
let cachedDealerMap: Map<string, DealerSnapshot> | null = null;

export function invalidateDealerCache() {
  cachedDealerMap = null;
}

export function loadDealer(): Map<string, DealerSnapshot> {
  if (cachedDealerMap) return cachedDealerMap;

  const cacheMap = new Map<string, DealerSnapshot>();

  try {
    const dealerDir = path.join(process.cwd(), 'cache', 'dealer');
    if (!fs.existsSync(dealerDir)) return cacheMap;

    const testPath = path.join(dealerDir, 'test.json');
    if (fs.existsSync(testPath)) {
      const data = fs.readFileSync(testPath, 'utf8');
      const parsed = JSON.parse(data);
      
      for (const contractId of Object.keys(parsed)) {
        const item = parsed[contractId];
        const bias = calculateDealerBias(item.buy, item.sell);
        cacheMap.set(contractId, {
          contractId,
          buy: item.buy,
          sell: item.sell,
          lastOI: item.lastOI,
          lastDate: item.lastDate,
          bias,
          source: 'TEST'
        });
      }
    }

    const filePaths = getAllJsonFiles(dealerDir);
    for (const filePath of filePaths) {
      try {
        const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        if (data.contractId && typeof data.buy === 'number') {
          cacheMap.set(data.contractId, {
            contractId: data.contractId,
            buy: data.buy,
            sell: data.sell,
            lastOI: data.lastOI || 0,
            lastDate: data.lastDate || "",
            bias: data.bias !== undefined ? data.bias : calculateDealerBias(data.buy, data.sell),
            source: 'FILE'
          });
        }
      } catch (e) {
        console.error(`Error reading ${filePath}:`, e);
      }
    }

    for (const [contractId, snapshot] of cacheMap.entries()) {
      console.log(`Dealer Lookup:\n  ${contractId}\nSource:\n  ${snapshot.source}`);
    }

  } catch (error) {
    console.error('Error loading dealer cache:', error);
  }

  cachedDealerMap = cacheMap;
  return cacheMap;
}

export function saveDealer(cacheMap: Map<string, DealerSnapshot>) {
  try {
    const cachePath = path.join(process.cwd(), 'cache', 'dealer', 'test.json');
    const obj: Record<string, any> = {};
    for (const [key, val] of cacheMap.entries()) {
      obj[key] = {
        buy: val.buy,
        sell: val.sell,
        lastOI: val.lastOI,
        lastDate: val.lastDate
      };
    }
    fs.writeFileSync(cachePath, JSON.stringify(obj, null, 2), 'utf8');
  } catch (error) {
    console.error('Error saving dealer cache:', error);
  }
}
