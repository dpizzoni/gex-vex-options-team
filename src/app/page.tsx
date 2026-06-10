"use client";

import React, { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { 
  RefreshCw, 
  TrendingUp, 
  Calendar, 
  Activity, 
  AlertTriangle, 
  ChevronDown, 
  DollarSign,
  Zap,
  Layers,
  ArrowRightLeft,
  Columns,
  Grid,
  Copy,
  Check,
  FileText,
  Eye
} from "lucide-react";
import styles from "./page.module.css";
import GammaMatrix, { MatrixRawData } from "./components/GammaMatrix";

interface OptionContract {
  strike: number;
  impliedVolatility: number;
  openInterest: number;
  volume: number;
  bid: number;
  ask: number;
  gamma: number;
  gex: number;
  vanna: number;
  vex: number;
}

interface OptionsResponse {
  spot: number;
  symbol: string;
  expirations: string[];
  selectedExpiration: string;
  calls: OptionContract[];
  puts: OptionContract[];
  kingNode: number | null;
  gammaFlip: number | null;
  vannaFlip: number | null;
  totalCallGex: number;
  totalPutGex: number;
  netGex: number;
  totalCallVex: number;
  totalPutVex: number;
  netVex: number;
  dealerBias: {
    overall: string;
    gexRegime: string;
    vexRegime: string;
  };
}

export default function Home() {
  const [symbol, setSymbol] = useState<string>("SPY");
  const [customTicker, setCustomTicker] = useState<string>("");
  const [data, setData] = useState<OptionsResponse | null>(null);
  const [selectedExp, setSelectedExp] = useState<string>("");
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [filterType, setFilterType] = useState<"ALL" | "CALL" | "PUT">("ALL");
  const [exposureMode, setExposureMode] = useState<"RAW" | "DEALER">("DEALER");
  const [sortConfig, setSortConfig] = useState<{ key: string, direction: 'asc' | 'desc' } | null>(null);

  // Matrix Mode State
  const [viewMode, setViewMode] = useState<"chain" | "matrix">("matrix");
  const matrixAggregation = exposureMode;
  const [matrixExpMode, setMatrixExpMode] = useState<"SINGLE" | "MULTI">("SINGLE");
  const [matrixSelectedExps, setMatrixSelectedExps] = useState<string[]>([]);
  const [matrixRelevantOnly, setMatrixRelevantOnly] = useState<boolean>(false);
  const [matrixStrikeWindow, setMatrixStrikeWindow] = useState<10 | 20 | 30 | 0>(10);
  const [matrixRawData, setMatrixRawData] = useState<MatrixRawData[]>([]);
  const [matrixLoading, setMatrixLoading] = useState<boolean>(false);
  const [matrixDisplayFormat, setMatrixDisplayFormat] = useState<"HEATMAP" | "TABLE">("HEATMAP");
  // Dealer Engine State
  const [dealerCache, setDealerCache] = useState<Record<string, any> | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [refreshStats, setRefreshStats] = useState<{ uw: number, dealer: number, duration: number } | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  // Analysis Panel State
  const [analysisTab, setAnalysisTab] = useState<"visual" | "text">("visual");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    fetch(`/api/dealer?t=${Date.now()}`).then(res => res.json()).then(data => {
      setDealerCache(data);
    }).catch(err => {
      console.error("Dealer cache fetch failed", err);
    });
  }, []);

  const displayExpirations = useMemo(() => {
    if (!data?.expirations) return [];
    const uniqueExps = Array.from(new Set(data.expirations));
    if (symbol === "SPY" || symbol === "QQQ") {
      return uniqueExps.slice(0, 5);
    }
    if (symbol === "TSLA" || symbol === "GOOGL") {
      return uniqueExps.slice(0, 10);
    }
    return uniqueExps;
  }, [data?.expirations, symbol]);

  
  // Dual Matrix States
  const [gexStats, setGexStats] = useState<any>(null);
  const [vexStats, setVexStats] = useState<any>(null);
  const [hoveredStrike, setHoveredStrike] = useState<number | null>(null);
  const [selectedNode, setSelectedNode] = useState<{strike: number, expiry: string} | null>(null);

  
  const gexScrollRef = useRef<HTMLDivElement>(null);
  const vexScrollRef = useRef<HTMLDivElement>(null);
  
  // Prevent infinite loops during scroll sync
  const isSyncingRef = useRef<"GEX" | "VEX" | null>(null);

  // Prevent stale data overwriting from slow networks
  const currentTickerRef = useRef(symbol);
  useEffect(() => {
    currentTickerRef.current = symbol;
  }, [symbol]);

  const [hasLoadedStorage, setHasLoadedStorage] = useState(false);

  useEffect(() => {
    if (typeof window !== "undefined") {
      const savedSymbol = localStorage.getItem("gex_vex_symbol");
      if (savedSymbol) setSymbol(savedSymbol);
      
      const savedExp = localStorage.getItem("gex_vex_selectedExp");
      if (savedExp) setSelectedExp(savedExp);

      const savedFilter = localStorage.getItem("gex_vex_filterType");
      if (savedFilter) setFilterType(savedFilter as any);

      const savedExposure = localStorage.getItem("gex_vex_exposureMode");
      if (savedExposure) setExposureMode(savedExposure as any);

      const savedViewMode = localStorage.getItem("gex_vex_viewMode");
      if (savedViewMode) setViewMode(savedViewMode as any);

      const savedMatrixExp = localStorage.getItem("gex_vex_matrixExpMode");
      if (savedMatrixExp) setMatrixExpMode(savedMatrixExp as any);

      const savedMatrixSelected = localStorage.getItem("gex_vex_matrixSelectedExps");
      if (savedMatrixSelected) setMatrixSelectedExps(JSON.parse(savedMatrixSelected));

      const savedStrikeWindow = localStorage.getItem("gex_vex_matrixStrikeWindow");
      if (savedStrikeWindow) setMatrixStrikeWindow(parseInt(savedStrikeWindow) as any);

      const savedDisplayFormat = localStorage.getItem("gex_vex_matrixDisplayFormat");
      if (savedDisplayFormat) setMatrixDisplayFormat(savedDisplayFormat as any);

      setHasLoadedStorage(true);
    }
  }, []);

  useEffect(() => {
    if (hasLoadedStorage && typeof window !== "undefined") {
      localStorage.setItem("gex_vex_symbol", symbol);
      if (selectedExp) localStorage.setItem("gex_vex_selectedExp", selectedExp);
      localStorage.setItem("gex_vex_filterType", filterType);
      localStorage.setItem("gex_vex_exposureMode", exposureMode);
      localStorage.setItem("gex_vex_viewMode", viewMode);
      localStorage.setItem("gex_vex_matrixExpMode", matrixExpMode);
      localStorage.setItem("gex_vex_matrixSelectedExps", JSON.stringify(matrixSelectedExps));
      localStorage.setItem("gex_vex_matrixStrikeWindow", matrixStrikeWindow.toString());
      localStorage.setItem("gex_vex_matrixDisplayFormat", matrixDisplayFormat);
    }
  }, [hasLoadedStorage, symbol, selectedExp, filterType, exposureMode, viewMode, matrixExpMode, matrixSelectedExps, matrixStrikeWindow, matrixDisplayFormat]);



  const requestSort = (key: string) => {
    let direction: 'asc' | 'desc' = 'asc';
    if (sortConfig && sortConfig.key === key && sortConfig.direction === 'asc') {
      direction = 'desc';
    }
    setSortConfig({ key, direction });
  };

  const fetchOptions = useCallback(async (ticker: string, expDate?: string, isBackground = false) => {
    if (!isBackground) {
      setLoading(true);
      setData(null);
    }
    setError(null);
    try {
      let url = `/api/options?symbol=${ticker}`;
      if (expDate) {
        url += `&expiration=${expDate}`;
      }
      
      const res = await fetch(url, { cache: 'no-store' });
      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(errorData.detail || `HTTP error! status: ${res.status}`);
      }
      
      const json: OptionsResponse = await res.json();
      if (currentTickerRef.current === ticker) {
        setData(json);
        setLastUpdated(new Date());
        if (json.selectedExpiration) {
          setSelectedExp(json.selectedExpiration);
        }
      }
    } catch (err: any) {
      console.error("Error fetching options data:", err);
      setError(err.message || "An unexpected error occurred while fetching option chain data.");
    } finally {
      if (!isBackground) {
        setLoading(false);
      }
    }
  }, []);

  // Fetch Matrix Data for ALL expirations
  const fetchMatrixData = useCallback(async (ticker: string, expirations: string[], isBackground = false) => {
    if (!isBackground) {
      setMatrixLoading(true);
    }
    try {
      const promises = expirations.map(async (exp) => {
        const url = `/api/options?symbol=${ticker}&expiration=${exp}`;
        const res = await fetch(url, { cache: 'no-store' });
        if (!res.ok) throw new Error(`HTTP error ${res.status}`);
        const json: OptionsResponse = await res.json();
        return {
          expiration: exp,
          calls: json.calls,
          puts: json.puts
        };
      });
      const results = await Promise.all(promises);
      if (currentTickerRef.current === ticker) {
        setMatrixRawData(results);
        setLastUpdated(new Date());
        if (results.length > 0 && matrixSelectedExps.length === 0) {
          setMatrixSelectedExps([results[0].expiration]);
        }
      }
    } catch (err: any) {
      console.error("Error fetching matrix data:", err);
      setError(err.message || "Failed to fetch matrix data");
    } finally {
      if (!isBackground) {
        setMatrixLoading(false);
      }
    }
  }, [matrixSelectedExps.length]);

  useEffect(() => {
    if (viewMode === "matrix" && displayExpirations.length > 0 && matrixRawData.length === 0 && !matrixLoading) {
      if (data?.symbol === symbol) {
        fetchMatrixData(symbol, displayExpirations);
      }
    }
  }, [viewMode, displayExpirations, symbol, fetchMatrixData, matrixRawData.length, matrixLoading, data?.symbol]);

  const isInitialFetch = useRef(true);

  // Fetch when symbol changes
  useEffect(() => {
    if (!hasLoadedStorage) return;

    setMatrixRawData([]);
    let expToFetch = undefined;
    if (isInitialFetch.current) {
       expToFetch = selectedExp || undefined;
       isInitialFetch.current = false;
    } else {
       setSelectedExp("");
    }
    fetchOptions(symbol, expToFetch);
  }, [symbol, hasLoadedStorage, fetchOptions]); // excluding selectedExp since we only use it on initial fetch

  // Handle expiration tab change
  const handleExpirationChange = (expDate: string) => {
    setSelectedExp(expDate);
    fetchOptions(symbol, expDate);
    if (matrixExpMode === "SINGLE") {
      setMatrixSelectedExps([expDate]);
    }
  };

  // Manual refresh
  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      const res = await fetch('/api/dealer/build', { method: 'POST' });
      const resData = await res.json();
      if (!res.ok) throw new Error(resData.error || "Dealer rebuild failed");
      
      const cacheRes = await fetch(`/api/dealer?t=${Date.now()}`);
      const cacheData = await cacheRes.json();
      setDealerCache(cacheData);

      const stdout = resData.stdout || "";
      let uwCount = 0;
      if (stdout.includes('contracts found:')) {
         uwCount = stdout.split('processing:')[0].split('\n').filter((l: string) => l.trim() !== '' && !l.includes('contracts found:') && !l.includes('>')).length;
      }
      const dealerMatch = stdout.match(/SAVED:/g);
      const dealerCount = dealerMatch ? dealerMatch.length : 0;

      setRefreshStats({ uw: uwCount, dealer: dealerCount, duration: resData.duration });
      
      setTimeout(() => setRefreshStats(null), 2000);

    } catch (e: any) {
      alert(`Dealer rebuild failed\n${e.message}`);
    } finally {
      setIsRefreshing(false);
    }
  };

  const autoRefreshFn = useRef<() => void>(() => {});
  autoRefreshFn.current = () => {
    // Para el auto-refresh de fondo, solo consultamos los datos actualizados de la caché del servidor.
    // No disparamos el reconstructor pesado de dealer (handleRefresh) para evitar alertas y bloqueos.
    fetch(`/api/dealer?t=${Date.now()}`)
      .then(res => res.json())
      .then(cacheData => setDealerCache(cacheData))
      .catch(err => console.error("Auto-refresh dealer cache fetch failed", err));

    if (viewMode === "matrix" && displayExpirations.length > 0) {
      if (data?.symbol === symbol) {
        fetchMatrixData(symbol, displayExpirations, true);
      }
    } else {
      fetchOptions(symbol, selectedExp || undefined, true);
    }
  };

  useEffect(() => {
    const interval = setInterval(() => {
      autoRefreshFn.current();
    }, 1 * 60 * 1000); // 1 minute
    return () => clearInterval(interval);
  }, []);

  // Format GEX values to standard professional abbreviations (e.g. $1.2M, -$450K)
  const formatGex = (val: number) => {
    const absVal = Math.abs(val);
    const sign = val < 0 ? "-" : "";
    if (absVal >= 1.0e9) {
      return `${sign}$${(absVal / 1.0e9).toFixed(2)}B`;
    } else if (absVal >= 1.0e6) {
      return `${sign}$${(absVal / 1.0e6).toFixed(2)}M`;
    } else if (absVal >= 1.0e3) {
      return `${sign}$${(absVal / 1.0e3).toFixed(1)}K`;
    } else {
      return `${sign}$${absVal.toFixed(2)}`;
    }
  };

  // Get GEX Heatmap Styles
  const getGexCellStyle = (gex: number, type: "CALL" | "PUT") => {
    if (!data) return {};
    const maxAbsGex = Math.max(
      ...data.calls.map(c => Math.abs(c.gex)),
      ...data.puts.map(p => Math.abs(p.gex)),
      1
    );
    
    // Intensity factor from 0 to 1
    const intensity = Math.min(Math.abs(gex) / maxAbsGex, 1.0);
    
    // Generate a sleek background shade + left boundary glow matching absolute GEX size
    if (type === "CALL") {
      return {
        background: `rgba(0, 230, 118, ${intensity * 0.18})`,
        borderLeft: `4px solid rgba(0, 230, 118, ${intensity * 0.9})`,
        color: `rgb(${Math.floor(180 + 75 * (1 - intensity))}, 255, ${Math.floor(180 + 75 * (1 - intensity))})`,
        fontWeight: intensity > 0.5 ? 700 : 500,
        fontFamily: "monospace"
      };
    } else {
      return {
        background: `rgba(255, 42, 109, ${intensity * 0.18})`,
        borderLeft: `4px solid rgba(255, 42, 109, ${intensity * 0.9})`,
        color: `rgb(255, ${Math.floor(180 + 75 * (1 - intensity))}, ${Math.floor(180 + 75 * (1 - intensity))})`,
        fontWeight: intensity > 0.5 ? 700 : 500,
        fontFamily: "monospace"
      };
    }
  };



  // Prepare table rows and compute derived metrics
  const rows = React.useMemo(() => {
    if (!data) return [];
    
    let baseRows: Array<{
      strike: number;
      type: "CALL" | "PUT";
      iv: number;
      oi: number;
      vol: number;
      gamma: number;
      gex: number;
      vanna: number;
      vex: number;
    }> = [];

    let filteredCalls = data.calls;
    let filteredPuts = data.puts;

    if (matrixStrikeWindow > 0 && data.spot) {
      filteredCalls = filteredCalls.filter(c => Math.abs(c.strike - data.spot!) <= matrixStrikeWindow);
      filteredPuts = filteredPuts.filter(p => Math.abs(p.strike - data.spot!) <= matrixStrikeWindow);
    }

    if (filterType === "ALL" || filterType === "CALL") {
      baseRows = baseRows.concat(filteredCalls.map(c => ({
        strike: c.strike,
        type: "CALL",
        iv: c.impliedVolatility,
        oi: c.openInterest,
        vol: c.volume,
        gamma: c.gamma,
        gex: c.gex,
        vanna: c.vanna,
        vex: c.vex
      })));
    }

    if (filterType === "ALL" || filterType === "PUT") {
      baseRows = baseRows.concat(filteredPuts.map(p => ({
        strike: p.strike,
        type: "PUT",
        iv: p.impliedVolatility,
        oi: p.openInterest,
        vol: p.volume,
        gamma: p.gamma,
        gex: p.gex,
        vanna: p.vanna,
        vex: p.vex
      })));
    }

    // Calculate derived metrics based on visible rows
    const sumAbsGex = baseRows.reduce((sum, row) => sum + Math.abs(row.gex), 0);
    
    const sortedByGamma = [...baseRows].sort((a, b) => Math.abs(b.gamma) - Math.abs(a.gamma));
    const gammaRankMap = new Map();
    sortedByGamma.forEach((row, index) => {
      gammaRankMap.set(`${row.strike}-${row.type}`, (row.gamma === null || row.gamma === undefined) ? null : index + 1);
    });

    const sortedByOi = [...baseRows].sort((a, b) => b.oi - a.oi);
    const oiRankMap = new Map();
    sortedByOi.forEach((row, index) => {
      oiRankMap.set(`${row.strike}-${row.type}`, (row.oi === null || row.oi === undefined) ? null : index + 1);
    });

    // Time to expiry (T in years)
    const now = new Date().getTime();
    const msPerDay = 1000 * 60 * 60 * 24;
    const DTE = selectedExp ? (new Date(selectedExp).getTime() - now) / msPerDay : 0.5;
    const T = Math.max(DTE, 0.5) / 365;
    const r = 0.05; // 5% risk-free rate assumption

    const computedRows = baseRows.map(row => {
      const distance = data.spot ? Math.abs(data.spot - row.strike) : 0;
      const contribution = sumAbsGex === 0 ? 0 : Math.abs(row.gex) / sumAbsGex;
      
      let vanna = 0;
      let vega = 0;
      let d1 = 0, d2 = 0, pdf = 0, vex = 0;
      let sigma = row.iv;
      
      if (sigma > 1) {
        sigma = sigma / 100;
      }
      let ivNormalized = sigma;

      if (sigma > 0 && data.spot > 0) {
        d1 = (Math.log(data.spot / row.strike) + (r + Math.pow(sigma, 2) / 2) * T) / (sigma * Math.sqrt(T));
        d2 = d1 - sigma * Math.sqrt(T);
        pdf = Math.exp(-0.5 * Math.pow(d1, 2)) / Math.sqrt(2 * Math.PI);
        vega = data.spot * pdf * Math.sqrt(T);
        vanna = -(vega * d2) / (data.spot * sigma);
        if (!Number.isFinite(vanna)) vanna = 0;
        
        const vexPreScale = vanna * row.oi * data.spot;
        vex = vexPreScale;
        
        return {
          ...row,
          distance,
          contribution,
          gammaRank: gammaRankMap.get(`${row.strike}-${row.type}`),
          oiRank: oiRankMap.get(`${row.strike}-${row.type}`),
          vanna,
          vex
        };
      }
      
      return {
        ...row,
        distance,
        contribution,
        gammaRank: gammaRankMap.get(`${row.strike}-${row.type}`),
        oiRank: oiRankMap.get(`${row.strike}-${row.type}`),
        vanna,
        vex
      };
    });

    const netGexByStrike = new Map<number, number>();
    const netVexByStrike = new Map<number, number>();

    computedRows.forEach(r => {
      netGexByStrike.set(r.strike, (netGexByStrike.get(r.strike) || 0) + (r.gex || 0));
      netVexByStrike.set(r.strike, (netVexByStrike.get(r.strike) || 0) + (r.vex || 0));
    });

    const rowsWithNet = computedRows.map(r => ({
      ...r,
      netGex: netGexByStrike.get(r.strike) || 0,
      netVex: netVexByStrike.get(r.strike) || 0
    }));

    const sortedByVex = [...rowsWithNet].sort((a, b) => Math.abs(b.vex) - Math.abs(a.vex));
    const vexRankMap = new Map();
    sortedByVex.forEach((row, index) => {
      vexRankMap.set(`${row.strike}-${row.type}`, row.vex === 0 ? null : index + 1);
    });

    const finalRows = rowsWithNet.map(row => ({
      ...row,
      vexRank: vexRankMap.get(`${row.strike}-${row.type}`)
    }));

    // Sorting logic
    if (sortConfig !== null) {
      finalRows.sort((a, b) => {
        let aVal = (a as any)[sortConfig.key];
        let bVal = (b as any)[sortConfig.key];
        
        if (aVal === null || aVal === undefined) return 1;
        if (bVal === null || bVal === undefined) return -1;
        if (aVal < bVal) return sortConfig.direction === 'asc' ? -1 : 1;
        if (aVal > bVal) return sortConfig.direction === 'asc' ? 1 : -1;
        
        // Secondary sort: Strike (asc)
        if (a.strike !== b.strike) return a.strike - b.strike;
        // Tertiary sort: Type (CALL before PUT)
        return a.type.localeCompare(b.type);
      });
    } else {
      // Default sort by strike (asc), then by type (CALL before PUT)
      finalRows.sort((a, b) => {
        if (a.strike !== b.strike) return a.strike - b.strike;
        return a.type.localeCompare(b.type);
      });
    }

    return finalRows;
  }, [data, filterType, sortConfig, selectedExp, matrixStrikeWindow]);

  const { netVex, vannaFlip, medianVanna } = React.useMemo(() => {
    if (!data || !selectedExp) return { netVex: 0, vannaFlip: null, medianVanna: 0 };
    
    const now = new Date().getTime();
    const msPerDay = 1000 * 60 * 60 * 24;
    const DTE = selectedExp ? (new Date(selectedExp).getTime() - now) / msPerDay : 0.5;
    const T = Math.max(DTE, 0.5) / 365;
    const r = 0.05;

    const allOptions = [...data.calls.map(c => ({...c, type: 'CALL'})), ...data.puts.map(p => ({...p, type: 'PUT'}))];
    
    let totalVex = 0;
    const strikeVexMap = new Map<number, number>();
    const vannaValues: number[] = [];

    allOptions.forEach(opt => {
      let sigma = opt.impliedVolatility;
      if (sigma > 1) {
        sigma = sigma / 100;
      }
      
      let vex = 0;
      if (sigma > 0 && data.spot > 0) {
        const d1 = (Math.log(data.spot / opt.strike) + (r + Math.pow(sigma, 2) / 2) * T) / (sigma * Math.sqrt(T));
        const d2 = d1 - sigma * Math.sqrt(T);
        const pdf = Math.exp(-0.5 * Math.pow(d1, 2)) / Math.sqrt(2 * Math.PI);
        const vega = data.spot * pdf * Math.sqrt(T);
        let vanna = -(vega * d2) / (data.spot * sigma);
        if (!Number.isFinite(vanna)) vanna = 0;
        
        const vexPreScale = vanna * opt.openInterest * data.spot;
        vex = vexPreScale;
        vannaValues.push(Math.abs(vanna));
      }
      totalVex += vex;
      strikeVexMap.set(opt.strike, (strikeVexMap.get(opt.strike) || 0) + vex);
    });

    vannaValues.sort((a, b) => a - b);
    let medVanna = 0;
    if (vannaValues.length > 0) {
      const mid = Math.floor(vannaValues.length / 2);
      medVanna = vannaValues.length % 2 !== 0 ? vannaValues[mid] : (vannaValues[mid - 1] + vannaValues[mid]) / 2;
    }

    const sortedStrikes = Array.from(strikeVexMap.keys()).sort((a, b) => a - b);
    let cumulativeVex = 0;
    let flipStrike: number | null = null;
    let previousSign = 0;

    for (const strike of sortedStrikes) {
      cumulativeVex += strikeVexMap.get(strike) || 0;
      const currentSign = cumulativeVex > 0 ? 1 : (cumulativeVex < 0 ? -1 : 0);
      if (previousSign !== 0 && currentSign !== 0 && currentSign !== previousSign) {
        flipStrike = strike;
        break;
      }
      previousSign = currentSign;
    }
    return { netVex: totalVex, vannaFlip: flipStrike, medianVanna: medVanna };
  }, [data, selectedExp]);

  const tableMatrixData = useMemo(() => {
    let result = matrixRawData;
    if (displayExpirations.length > 0) {
      result = result.filter(chain => displayExpirations.includes(chain.expiration));
    }
    const r = 0.05;
    const now = new Date().getTime();

    const getExposureValue = (contract: any, baseValue: number) => {
      if (matrixAggregation === "RAW") return baseValue;
      if (matrixAggregation === "DEALER") {
        let dealerBiasVal = 1;
        const occId = (() => {
          const dateStr = contract.expiration.replace(/-/g, "").slice(2);
          const typeStr = contract.type === "CALL" ? "C" : "P";
          const strikeStr = Math.round(contract.strike * 1000).toString().padStart(8, "0");
          return `${symbol}${dateStr}${typeStr}${strikeStr}`;
        })();

        if (dealerCache && dealerCache[occId]) {
          dealerBiasVal = dealerCache[occId].bias;
        } else if (symbol === "SPY" && contract.strike === 745 && contract.expiration.includes("2026-06-08")) {
          if (contract.type === "CALL") dealerBiasVal = (117 - 146) / 263;
          else if (contract.type === "PUT") dealerBiasVal = (1286 - 4257) / 5543;
        }
        return baseValue * dealerBiasVal;
      }
      return baseValue;
    };

    // Map result to inject computed VEX and apply Dealer Bias
    if (data?.spot) {
      result = result.map(chain => {
        let T = (new Date(chain.expiration).getTime() - now) / (1000 * 60 * 60 * 24 * 365);
        if (T <= 0) T = 0.0001;

        const processOpts = (opts: any[], type: "CALL" | "PUT") => opts.map(opt => {
          let vexVal = 0;
          let sigma = opt.impliedVolatility;
          if (sigma > 1) sigma /= 100;
          if (sigma > 0 && data.spot > 0) {
            const d1 = (Math.log(data.spot / opt.strike) + (r + Math.pow(sigma, 2) / 2) * T) / (sigma * Math.sqrt(T));
            const d2 = d1 - sigma * Math.sqrt(T);
            const pdf = Math.exp(-0.5 * Math.pow(d1, 2)) / Math.sqrt(2 * Math.PI);
            const vega = data.spot * pdf * Math.sqrt(T);
            let rawVanna = -(vega * d2) / (data.spot * sigma);
            if (!Number.isFinite(rawVanna)) rawVanna = 0;
            vexVal = rawVanna * opt.openInterest * data.spot;
          }
          const optWithType = { ...opt, type, expiration: chain.expiration };
          return { 
            ...optWithType, 
            gex: getExposureValue(optWithType, opt.gex || 0),
            vanna: getExposureValue(optWithType, vexVal)
          };
        });

        return {
          ...chain,
          calls: processOpts(chain.calls, "CALL"),
          puts: processOpts(chain.puts, "PUT")
        };
      });
    }

    if (matrixStrikeWindow > 0 && data?.spot) {
      result = result.map(chain => {
        const allStrikes = Array.from(new Set([...chain.calls, ...chain.puts].map((opt: any) => opt.strike))).sort((a, b) => a - b);
        if (allStrikes.length === 0) return { ...chain, gexMax: 1, vannaMax: 1 };
        let closestIdx = 0;
        let minDiff = Infinity;
        for (let i = 0; i < allStrikes.length; i++) {
          const diff = Math.abs(allStrikes[i] - data.spot!);
          if (diff < minDiff) {
            minDiff = diff;
            closestIdx = i;
          }
        }
        const startIdx = Math.max(0, closestIdx - matrixStrikeWindow);
        const endIdx = Math.min(allStrikes.length - 1, closestIdx + matrixStrikeWindow);
        const validStrikes = new Set(allStrikes.slice(startIdx, endIdx + 1));
        
        const validCalls = chain.calls.filter((c: any) => validStrikes.has(c.strike));
        const validPuts = chain.puts.filter((p: any) => validStrikes.has(p.strike));
        
        let gexMax = 0;
        let vannaMax = 0;
        validStrikes.forEach(strike => {
          const c = validCalls.find((o: any) => o.strike === strike);
          const p = validPuts.find((o: any) => o.strike === strike);
          const gexVal = Math.abs((c?.gex || 0) + (p?.gex || 0));
          const vannaVal = Math.abs((c?.vanna || 0) + (p?.vanna || 0));
          if (gexVal > gexMax) gexMax = gexVal;
          if (vannaVal > vannaMax) vannaMax = vannaVal;
        });

        return {
          ...chain,
          gexMax: gexMax || 1,
          vannaMax: vannaMax || 1,
          calls: validCalls,
          puts: validPuts
        };
      });
    } else if (data?.spot) {
       result = result.map(chain => {
        let gexMax = 0;
        let vannaMax = 0;
        const strikes = new Set([...chain.calls, ...chain.puts].map((opt: any) => opt.strike));
        strikes.forEach(strike => {
          const c = chain.calls.find((o: any) => o.strike === strike);
          const p = chain.puts.find((o: any) => o.strike === strike);
          const gexVal = Math.abs((c?.gex || 0) + (p?.gex || 0));
          const vannaVal = Math.abs((c?.vanna || 0) + (p?.vanna || 0));
          if (gexVal > gexMax) gexMax = gexVal;
          if (vannaVal > vannaMax) vannaMax = vannaVal;
        });
        return {
          ...chain,
          gexMax: gexMax || 1,
          vannaMax: vannaMax || 1
        };
       });
    }

    return result;
  }, [matrixRawData, matrixStrikeWindow, data?.spot, matrixAggregation, dealerCache, symbol, displayExpirations]);


  const filteredMatrixData = useMemo(() => {
    let result = matrixRawData;
    if (selectedExp) {
      result = result.filter(chain => chain.expiration === selectedExp);
    }
    if (matrixStrikeWindow > 0 && data?.spot) {
      result = result.map(chain => {
        const allStrikes = Array.from(new Set([...chain.calls, ...chain.puts].map((opt: any) => opt.strike))).sort((a, b) => a - b);
        if (allStrikes.length === 0) return chain;
        let closestIdx = 0;
        let minDiff = Infinity;
        for (let i = 0; i < allStrikes.length; i++) {
          const diff = Math.abs(allStrikes[i] - data.spot!);
          if (diff < minDiff) {
            minDiff = diff;
            closestIdx = i;
          }
        }
        const startIdx = Math.max(0, closestIdx - matrixStrikeWindow);
        const endIdx = Math.min(allStrikes.length - 1, closestIdx + matrixStrikeWindow);
        const validStrikes = new Set(allStrikes.slice(startIdx, endIdx + 1));
        return {
          ...chain,
          calls: chain.calls.filter((c: any) => validStrikes.has(c.strike)),
          puts: chain.puts.filter((p: any) => validStrikes.has(p.strike))
        };
      });
    }
    return result;
  }, [matrixRawData, selectedExp, matrixStrikeWindow, data?.spot]);

  const matrixGlobalStats = useMemo(() => {
    if (viewMode !== "matrix" || filteredMatrixData.length === 0 || !data?.spot) return null;
    
    let king = { strike: 0, val: 0 };
    const allOpts: any[] = [];
    const r = 0.05;
    const now = new Date().getTime();

    filteredMatrixData.forEach(chain => {
      let T = (new Date(chain.expiration).getTime() - now) / (1000 * 60 * 60 * 24 * 365);
      if (T <= 0) T = 0.0001;
      chain.calls.forEach((c: any) => {
        allOpts.push({...c, type: 'CALL', T});
      });
      chain.puts.forEach((p: any) => {
        allOpts.push({...p, type: 'PUT', T});
      });
    });

    const strikeMap = new Map<number, { call: number, put: number }>();
    allOpts.forEach(opt => {
      if (!strikeMap.has(opt.strike)) strikeMap.set(opt.strike, { call: 0, put: 0 });
      const s = strikeMap.get(opt.strike)!;
      if (opt.type === 'CALL') s.call += (opt.gex || 0);
      else s.put += (opt.gex || 0);
    });

    const consoleData: any[] = [];
    let rawTotal = 0;
    let netTotal = 0;
    
    let positiveCells = 0;
    let negativeCells = 0;
    let neutralCells = 0;

    strikeMap.forEach((vals, strike) => {
        const raw = vals.call + vals.put;
        const net = vals.call + vals.put;
        
        let aggVal = 0;
        if (matrixAggregation === 'RAW') aggVal = raw;
        else if (matrixAggregation === 'DEALER') aggVal = net;
        
        if (aggVal > 0) positiveCells++;
        else if (aggVal < 0) negativeCells++;
        else neutralCells++;
        
        if (Math.abs(aggVal) > Math.abs(king.val)) king = { strike, val: aggVal };
        consoleData.push({ strike, raw, net });
    });

    allOpts.forEach(opt => {
        const val = opt.gex || 0;
        rawTotal += val;
        netTotal += val;
    });

    let tGex = 0;
    if (matrixAggregation === 'RAW') tGex = rawTotal;
    else if (matrixAggregation === 'DEALER') tGex = netTotal;

    const get_net_gex_at_S = (S_test: number) => {
      let gex_sum = 0;
      allOpts.forEach(opt => {
        const sigma = Math.max(opt.impliedVolatility, 0.01);
        const d1 = (Math.log(S_test / opt.strike) + (r + 0.5 * sigma**2) * opt.T) / (sigma * Math.sqrt(opt.T));
        const pdf = Math.exp(-0.5 * d1**2) / Math.sqrt(2.0 * Math.PI);
        const gamma = pdf / (S_test * sigma * Math.sqrt(opt.T));
        let val = 0;
        if(opt.type === 'CALL') val = gamma * opt.openInterest * (S_test ** 2);
        else val = -gamma * opt.openInterest * (S_test ** 2);
        
        gex_sum += val;
      });
      return gex_sum;
    };

    let gamma_flip = null;
    const spot = data.spot;
    const spot_min = spot * 0.8;
    const spot_max = spot * 1.2;
    const steps = 40;
    const step_size = (spot_max - spot_min) / steps;
    
    let s_prev = spot_min;
    let gex_prev = get_net_gex_at_S(s_prev);
    
    for (let i = 1; i <= steps; i++) {
      const s_curr = spot_min + i * step_size;
      const gex_curr = get_net_gex_at_S(s_curr);
      if ((gex_prev < 0 && gex_curr >= 0) || (gex_prev > 0 && gex_curr <= 0)) {
        let low_s = s_prev;
        let high_s = s_curr;
        for (let j = 0; j < 8; j++) {
          const mid_s = (low_s + high_s) / 2.0;
          const gex_mid = get_net_gex_at_S(mid_s);
          if (gex_mid === 0) { low_s = mid_s; break; }
          else if ((gex_prev < 0 && gex_mid < 0) || (gex_prev > 0 && gex_mid > 0)) low_s = mid_s;
          else high_s = mid_s;
        }
        gamma_flip = (low_s + high_s) / 2.0;
        break;
      }
      s_prev = s_curr;
gex_prev = gex_curr;
    }

    return { totalNetGex: tGex, kingNode: king.strike > 0 ? king.strike : null, gammaFlip: gamma_flip, rawTotal, netTotal, positiveCells, negativeCells, neutralCells };
  }, [filteredMatrixData, viewMode, matrixAggregation, data?.spot]);
  // GEX / VEX Scenario Engine Interpretation V4.3
  const analysisSnapshot = useMemo(() => {
    if (!data || !data.spot || filteredMatrixData.length === 0) return null;
    
    const spot = data.spot;
    const activeExp = selectedExp || (displayExpirations.length > 0 ? displayExpirations[0] : "");
    if (!activeExp) return null;
    
    const activeChain = filteredMatrixData.find(chain => chain.expiration === activeExp) || filteredMatrixData[0];
    if (!activeChain) return null;

    const strikesSet = new Set<number>();
    activeChain.calls.forEach((c: any) => strikesSet.add(c.strike));
    activeChain.puts.forEach((p: any) => strikesSet.add(p.strike));
    const strikesSorted = Array.from(strikesSet).sort((a, b) => a - b);
    
    if (strikesSorted.length === 0) return null;
    
    // Helper to calculate dealer exposure value
    const getExposureValue = (contract: any, baseValue: number) => {
      if (exposureMode === "RAW") return baseValue;
      let dealerBiasVal = 1;
      const occId = (() => {
        const dateStr = activeExp.replace(/-/g, "").slice(2);
        const typeStr = contract.type === "CALL" ? "C" : "P";
        const strikeStr = Math.round(contract.strike * 1000).toString().padStart(8, "0");
        return `${symbol}${dateStr}${typeStr}${strikeStr}`;
      })();

      if (dealerCache && dealerCache[occId]) {
        dealerBiasVal = dealerCache[occId].bias;
      } else if (symbol === "SPY" && contract.strike === 745 && activeExp.includes("2026-06-08")) {
        if (contract.type === "CALL") dealerBiasVal = (117 - 146) / 263;
        else if (contract.type === "PUT") dealerBiasVal = (1286 - 4257) / 5543;
      }
      return baseValue * dealerBiasVal;
    };

    const r = 0.05;
    const now = new Date().getTime();
    let T = (new Date(activeExp).getTime() - now) / (1000 * 60 * 60 * 24 * 365);
    if (T <= 0) T = 0.0001;

    // Calculate VEX exposure
    const calculateVex = (opt: any, type: "CALL" | "PUT") => {
      let vexVal = 0;
      let sigma = opt.impliedVolatility;
      if (sigma > 1) sigma /= 100;
      if (sigma > 0 && spot > 0) {
        const d1 = (Math.log(spot / opt.strike) + (r + Math.pow(sigma, 2) / 2) * T) / (sigma * Math.sqrt(T));
        const d2 = d1 - sigma * Math.sqrt(T);
        const pdf = Math.exp(-0.5 * Math.pow(d1, 2)) / Math.sqrt(2 * Math.PI);
        const vega = spot * pdf * Math.sqrt(T);
        let vanna = -(vega * d2) / (spot * sigma);
        if (!Number.isFinite(vanna)) vanna = 0;
        vexVal = vanna * opt.openInterest * spot;
      }
      return getExposureValue({ ...opt, type, expiration: activeExp }, vexVal);
    };

    const calculateGex = (opt: any, type: "CALL" | "PUT") => {
      return getExposureValue({ ...opt, type, expiration: activeExp }, opt.gex || 0);
    };

    const strikeData = strikesSorted.map(strike => {
      const call = activeChain.calls.find((c: any) => c.strike === strike);
      const put = activeChain.puts.find((p: any) => p.strike === strike);
      
      const cGex = call ? calculateGex(call, "CALL") : 0;
      const pGex = put ? calculateGex(put, "PUT") : 0;
      const cVex = call ? calculateVex(call, "CALL") : 0;
      const pVex = put ? calculateVex(put, "PUT") : 0;
      
      return {
        strike,
        gex: cGex + pGex,
        vex: cVex + pVex,
        distanceToSpot: strike - spot
      };
    });

    // Formatting helpers
    const formatSignVal = (val: number) => {
      const absVal = Math.abs(val);
      const sign = val >= 0 ? "+" : "\u2212";
      if (absVal >= 1.0e9) return `${sign}${(absVal / 1.0e9).toFixed(1).replace(/\.0$/, "")}B`;
      if (absVal >= 1.0e6) return `${sign}${(absVal / 1.0e6).toFixed(0)}M`;
      if (absVal >= 1.0e3) return `${sign}${(absVal / 1.0e3).toFixed(0)}K`;
      return `${sign}${absVal.toFixed(0)}`;
    };

    // Node Identification (Paso 1)
    let kingNode = strikeData[0];
    let maxAbsGex = 0;
    strikeData.forEach(sd => {
      const absGex = Math.abs(sd.gex);
      if (absGex > maxAbsGex) {
        maxAbsGex = absGex;
        kingNode = sd;
      }
    });

    let maxPosNode = strikeData.find(sd => sd.gex > 0) || null;
    strikeData.forEach(sd => {
      if (sd.gex > 0 && (!maxPosNode || sd.gex > maxPosNode.gex)) {
        maxPosNode = sd;
      }
    });

    let maxNegNode = strikeData.find(sd => sd.gex < 0) || null;
    strikeData.forEach(sd => {
      if (sd.gex < 0 && (!maxNegNode || sd.gex < maxNegNode.gex)) {
        maxNegNode = sd;
      }
    });

    // Visibility
    const threshold = maxAbsGex * 0.10;
    const visibleNodes = strikeData.filter(sd => Math.abs(sd.gex) >= threshold || Math.abs(sd.strike - spot) <= 5);
    const visibleStrikesSorted = [...visibleNodes].sort((a, b) => a.strike - b.strike);

    // GEX & VEX aggregates
    let totalNetGex = 0;
    let totalNetVex = 0;
    strikeData.forEach(sd => {
      totalNetGex += sd.gex;
      totalNetVex += sd.vex;
    });

    // 1. Dominancia (V3: <20% -> Difuso, 20-40% -> Normal, 40-60% -> Concentrado, >60% -> Frágil)
    const sumAbsVisibleGex = visibleNodes.reduce((sum, vn) => sum + Math.abs(vn.gex), 0);
    const dominanceScore = sumAbsVisibleGex > 0 ? (Math.abs(kingNode.gex) / sumAbsVisibleGex) * 100 : 0;
    let dominanceLabel = "Normal";
    if (dominanceScore < 20) dominanceLabel = "Difuso";
    else if (dominanceScore <= 40) dominanceLabel = "Normal";
    else if (dominanceScore <= 60) dominanceLabel = "Concentrado";
    else dominanceLabel = "Frágil";

    const structureType = (dominanceLabel === "Concentrado" || dominanceLabel === "Frágil") ? "estructura concentrada" : "estructura distribuida";
    const kingSignWordReal = kingNode.gex >= 0 ? "positivo" : "negativo";

    // 2 & 3. Escenarios
    const visibleUp = visibleStrikesSorted.filter(s => s.strike > spot);
    const visibleDown = visibleStrikesSorted.filter(s => s.strike < spot).reverse(); // closest to spot first

    // Upper scenario: Absorción superior
    const triggerUp = visibleUp[0]?.strike || Math.ceil(spot);
    let targetRangeUp = "";
    const positiveStrikesAbove = strikeData.filter(sd => sd.strike > spot && sd.gex > 0).sort((a, b) => a.strike - b.strike);
    
    let validUpNodes = [];
    if (positiveStrikesAbove.length > 0) {
      validUpNodes.push(positiveStrikesAbove[0]);
      for (let i = 1; i < positiveStrikesAbove.length; i++) {
        if (validUpNodes.length >= 3) break;
        const current = positiveStrikesAbove[i];
        const prev = validUpNodes[validUpNodes.length - 1];
        if (current.strike - prev.strike <= 3) {
          validUpNodes.push(current);
        } else {
          break;
        }
      }
    }

    if (validUpNodes.length >= 2) {
      targetRangeUp = `Absorción hasta ${validUpNodes[validUpNodes.length - 1].strike}`;
    } else if (validUpNodes.length === 1) {
      targetRangeUp = `${validUpNodes[0].strike}`;
    } else {
      targetRangeUp = `Vacío`;
    }

    // Lower scenario: Si pierde triggerDown -> vacío, con interacción en nextVisible
    const triggerDown = visibleDown[0]?.strike || Math.floor(spot);
    let targetRangeDown = ""; // vacío
    let interactionDown = triggerDown - 5;
    
    // Find the first gap > 1 strike between consecutive visible nodes below spot
    let foundGap = false;
    for (let i = 0; i < visibleDown.length - 1; i++) {
      const currentVisible = visibleDown[i].strike;
      const nextVisible = visibleDown[i + 1].strike;
      if (currentVisible - nextVisible > 1) {
        interactionDown = nextVisible;
        const gapStart = nextVisible + 1;
        const gapEnd = currentVisible - 1;
        if (gapStart === gapEnd) {
          targetRangeDown = `${gapStart}`;
        } else {
          targetRangeDown = `${gapStart}–${gapEnd}`;
        }
        foundGap = true;
        break;
      }
    }
    
    if (!foundGap) {
      const lastVisible = visibleDown[visibleDown.length - 1]?.strike || triggerDown;
      interactionDown = lastVisible - 5;
      const gapStart = interactionDown + 1;
      const gapEnd = lastVisible - 1;
      if (gapStart === gapEnd) {
        targetRangeDown = `${gapStart}`;
      } else {
        targetRangeDown = `${gapStart}–${gapEnd}`;
      }
    }

    // 4. Fuerza Relativa (VEX Pressure)
    const vexPressureVal = Math.abs(totalNetVex) / Math.max(1, Math.abs(totalNetGex)) * 100;
    let vexPressureInterpret = "Precio domina";
    if (vexPressureVal < 10) vexPressureInterpret = "Precio domina";
    else if (vexPressureVal <= 30) vexPressureInterpret = "Mixto";
    else vexPressureInterpret = "Vol domina";

    // 5. Mapa estructural
    const lowerBound = visibleStrikesSorted[0]?.strike || Math.floor(spot - 10);
    const upperBound = visibleStrikesSorted[visibleStrikesSorted.length - 1]?.strike || Math.ceil(spot + 10);
    const widthPts = upperBound - lowerBound;
    const spotPositionPercent = Math.round(((spot - lowerBound) / Math.max(1, widthPts)) * 100);

    // V4.3 Densidad: 81% -> Compacta, 60-80 -> Balanceada, <60 -> Dispersa
    const strikesInRangeCount = strikesSorted.filter(st => st >= lowerBound && st <= upperBound).length;
    const visibleInRangeCount = visibleNodes.filter(vn => vn.strike >= lowerBound && vn.strike <= upperBound).length;
    const densityPercent = strikesInRangeCount > 0 ? (visibleInRangeCount / strikesInRangeCount) * 100 : 0;
    let densityClass = "Dispersa";
    if (densityPercent >= 80) densityClass = "Compacta";
    else if (densityPercent >= 60) densityClass = "Balanceada";
    else densityClass = "Dispersa";
    const densityText = `${visibleInRangeCount}/${strikesInRangeCount} (${densityPercent.toFixed(1)}%) [${densityClass}]`;

    // 6. Absorción cercanos (within +-5 strikes of spot)
    const nearbyNodes = strikeData.filter(sd => Math.abs(sd.strike - spot) <= 5);
    const nearbyPositiveSum = nearbyNodes.filter(sd => sd.gex > 0).reduce((sum, sd) => sum + sd.gex, 0);
    const nearbyNegativeSum = nearbyNodes.filter(sd => sd.gex < 0).reduce((sum, sd) => sum + Math.abs(sd.gex), 0);
    let absorptionLabel = "Media";
    const totalNearby = nearbyPositiveSum + nearbyNegativeSum;
    if (totalNearby > 0) {
      const positiveRatio = nearbyPositiveSum / totalNearby;
      if (positiveRatio > 0.6) {
        absorptionLabel = "Alta";
      } else if (positiveRatio < 0.4) {
        absorptionLabel = "Baja";
      } else {
        absorptionLabel = "Media";
      }
    }

    // Spot Drift and Snapshot Compare
    const getSpotDriftAndPersist = () => {
      if (typeof window === "undefined") {
        return {
          driftInfo: { text: `${spot.toFixed(1)} to ${spot.toFixed(1)} \u0394+0.0`, value: 0, classLabel: "Estable" },
          persistenceInfo: { text: "King estable 1 snapshots 1m (Reciente)", count: 1 }
        };
      }
      const key = `snapshots_v3_${symbol}_${activeExp}`;
      let saved = [];
      try {
        saved = JSON.parse(localStorage.getItem(key) || "[]");
      } catch(e) {}
      
      let prevSpot = spot;
      if (saved.length > 0) {
        prevSpot = saved[saved.length - 1].spot;
      }
      
      const drift = spot - prevSpot;
      const driftFormattedVal = drift >= 0 ? `+${drift.toFixed(1)}` : `${drift.toFixed(1)}`;
      const driftText = `${prevSpot.toFixed(1)} to ${spot.toFixed(1)} \u0394${driftFormattedVal}`;
      
      const absDrift = Math.abs(drift);
      let driftClass = "Estable";
      if (absDrift < 0.5) {
        driftClass = "Estable";
      } else if (absDrift >= 0.5 && absDrift <= 2) {
        driftClass = "Activo";
      } else {
        driftClass = "Expansivo";
      }
      
      // Persist Stats
      const currentSnapshot = {
        timestamp: Date.now(),
        spot: spot,
        king: kingNode.strike,
        net: totalNetGex
      };
      
      let updated = [...saved];
      if (saved.length === 0) {
        updated.push(currentSnapshot);
      } else {
        const last = saved[saved.length - 1];
        const ageMs = Date.now() - last.timestamp;
        if (last.king !== currentSnapshot.king || Math.abs(last.spot - currentSnapshot.spot) > 0.2 || ageMs > 60000) {
          updated.push(currentSnapshot);
        }
      }
      
      if (updated.length > 5) {
        updated = updated.slice(updated.length - 5);
      }
      
      try {
        localStorage.setItem(key, JSON.stringify(updated));
      } catch(e) {}
      
      let consecutiveKingCount = 1;
      let prevKing = null;
      const lastKing = currentSnapshot.king;
      let durationMs = 0;
      
      for (let i = updated.length - 2; i >= 0; i--) {
        if (updated[i].king === lastKing) {
          consecutiveKingCount++;
          durationMs = Date.now() - updated[i].timestamp;
        } else {
          prevKing = updated[i].king;
          break;
        }
      }
      
      const durationMin = Math.max(1, Math.round(durationMs / 60000));
      
      let persistClass = "Reciente";
      if (consecutiveKingCount < 3) {
        persistClass = "Reciente";
      } else if (consecutiveKingCount <= 10) {
        persistClass = "Estable";
      } else {
        persistClass = "Persistente";
      }

      let persistText = "";
      if (prevKing !== null) {
        const delta = lastKing - prevKing;
        const deltaSign = delta >= 0 ? "+" : "";
        persistText = `King: ${lastKing} from ${prevKing} (\u0394${deltaSign}${delta}) ${consecutiveKingCount} snapshots ${durationMin}m (${persistClass})`;
      } else {
        persistText = `King estable ${consecutiveKingCount} snapshots ${durationMin}m (${persistClass})`;
      }
      
      return {
        driftInfo: { text: driftText, value: drift, classLabel: driftClass },
        persistenceInfo: { text: persistText, count: consecutiveKingCount }
      };
    };

    const driftAndPersist = getSpotDriftAndPersist();
    const driftInfo = driftAndPersist.driftInfo;
    const persistenceInfo = driftAndPersist.persistenceInfo;

    // Compresión logic
    const strongBeforeSpot = visibleDown[0]?.strike || Math.floor(spot - 2);
    const strongAfterSpot = visibleUp[0]?.strike || Math.ceil(spot + 2);
    const compressWidth = strongAfterSpot - strongBeforeSpot;
    const idxBefore = strikesSorted.indexOf(strongBeforeSpot);
    const idxAfter = strikesSorted.indexOf(strongAfterSpot);
    const compressWidthStrikes = (idxBefore !== -1 && idxAfter !== -1) ? (idxAfter - idxBefore) : compressWidth;
    const compressionRange = (compressWidthStrikes < 3 || compressWidth < 3) ? "Sin compresión relevante (0)" : `${strongBeforeSpot}–${strongAfterSpot}`;

    // V4 Distancia al King
    const kingDist = spot - kingNode.strike;
    const kingDistSign = kingDist >= 0 ? "+" : "";
    const kingDistValText = `${kingDistSign}${kingDist.toFixed(1)}`;
    const absKingDist = Math.abs(kingDist);
    let kingDistClass = "Lejos";
    if (absKingDist <= 3) kingDistClass = "Cerca";
    else if (absKingDist <= 8) kingDistClass = "Media";
    else kingDistClass = "Lejos";
    
    const kingDistText = `Spot ${spot.toFixed(1)} | King ${kingNode.strike} | Distancia ${kingDistValText} (${kingDistClass})`;

    // V4.3 Zonas GEX (Filtrar ruido: minLevelWeight = 1% del King)
    const kingGexAbs = Math.abs(kingNode.gex);
    const minWeightThreshold = kingGexAbs * 0.01;

    // Resistances: positive GEX nodes above spot, filtered by threshold
    const filteredResNodes = strikeData
      .filter(sd => sd.strike > spot && sd.gex > 0 && Math.abs(sd.gex) >= minWeightThreshold)
      .sort((a, b) => Math.abs(b.gex) - Math.abs(a.gex) || a.strike - b.strike);

    const resistances = filteredResNodes.slice(0, 3).map((sd, index) => {
      const weight = (Math.abs(sd.gex) / Math.max(1, kingGexAbs)) * 100;
      return {
        label: `R${index + 1}`,
        strike: sd.strike,
        formatted: formatSignVal(sd.gex),
        weight: parseFloat(weight.toFixed(1))
      };
    });

    // Supports: positive GEX nodes below spot, filtered by threshold
    const filteredSuppNodes = strikeData
      .filter(sd => sd.strike < spot && sd.gex > 0 && Math.abs(sd.gex) >= minWeightThreshold)
      .sort((a, b) => Math.abs(b.gex) - Math.abs(a.gex) || b.strike - a.strike);

    const supports = filteredSuppNodes.slice(0, 3).map((sd, index) => {
      const weight = (Math.abs(sd.gex) / Math.max(1, kingGexAbs)) * 100;
      return {
        label: `S${index + 1}`,
        strike: sd.strike,
        formatted: formatSignVal(sd.gex),
        weight: parseFloat(weight.toFixed(1))
      };
    });

    // Risk V4.5
    const vexRatio = Math.abs(totalNetVex) / Math.max(1, Math.abs(totalNetGex));
    let rawRiskScore = Math.max(0.1, dominanceScore * vexRatio);
    
    // Penalizador por concentración
    const kingWeight = Math.min(Math.abs(kingNode.gex) / Math.max(Math.abs(totalNetGex), 1), 2);
    let riskScoreUnclamped = rawRiskScore * (1 + (kingWeight - 1) * 0.2);
    
    // Normalizar 0-1
    const riskScore = Math.min(1, Math.max(0, riskScoreUnclamped / 100));
    
    let riskLabel = "Bajo";
    if (riskScore < 0.2) riskLabel = "Bajo";
    else if (riskScore <= 0.5) riskLabel = "Medio";
    else riskLabel = "Alto";
    const riskDesc = `Dominancia: ${dominanceScore.toFixed(1)}%, VEX: ${vexPressureVal.toFixed(1)}%, Interpretar: estructura ${dominanceLabel.toLowerCase()}.`;

    // 6. Sesgo estructural
    const visiblePositives = visibleNodes.filter(n => n.gex > 0);
    const visibleNegatives = visibleNodes.filter(n => n.gex < 0);
    const sumPos = visiblePositives.reduce((sum, n) => sum + n.gex, 0);
    const sumNeg = visibleNegatives.reduce((sum, n) => sum + Math.abs(n.gex), 0);
    const sumAbsVis = visibleNodes.reduce((sum, n) => sum + Math.abs(n.gex), 0);
    const bias = sumAbsVis > 0 ? (sumPos - sumNeg) / sumAbsVis : 0;
    const biasPercent = bias * 100;
    
    let biasLabel = "Neutral";
    const absBiasPercent = Math.abs(biasPercent);
    if (absBiasPercent > 50) {
      biasLabel = "Dominante";
    } else if (biasPercent >= 20 && biasPercent <= 50) {
      biasLabel = "Positivo";
    } else if (biasPercent >= -50 && biasPercent <= -20) {
      biasLabel = "Negativo";
    } else {
      biasLabel = "Neutral";
    }

    // 9. Layout nuevo V4.3
    const blockHeader = `${symbol} • Spot ${spot.toFixed(1)} • Exp ${activeExp}`;

    const blockEstado = `Dominancia: ${dominanceScore.toFixed(0)}% (${dominanceLabel})
Relación: Spot ${spot.toFixed(1)} | King ${kingNode.strike} | Dist ${kingDistValText}
Presión: ${vexPressureVal.toFixed(1)}% ${vexPressureInterpret}
Persistencia: ${persistenceInfo.text.replace(/snapshots?\s/, "snaps ")}`;

    const blockSesgo = `Sesgo: ${biasPercent.toFixed(1)}% (${biasLabel})`;

    const blockEscenarios = `SUPERIOR
${triggerUp} → ${targetRangeUp}

INFERIOR
${triggerDown} → ${targetRangeDown} → ${interactionDown}`;

    const spotTranslation = spotPositionPercent < 33 ? "Inferior" : spotPositionPercent > 66 ? "Superior" : "Central";
    const compTranslation = compressionRange !== "Sin compresión relevante (0)" ? "Sí" : "No";

    const blockMapa = `Estructura: ${lowerBound}–${upperBound}
Spot: ${spotTranslation}
Densidad: ${densityPercent.toFixed(0)}% ${densityClass}
Compresión: ${compTranslation}`;

    const blockSoportesResistencias = `ZONAS SUPERIORES
${resistances.map(r => `${r.strike.toString().padEnd(6)} ${r.formatted}`).join("\n") || "Ninguna"}

ZONAS INFERIORES
${supports.map(s => `${s.strike.toString().padEnd(6)} ${s.formatted}`).join("\n") || "Ninguno"}`;

    const textOutput = `${blockHeader}

ESTADO
${blockEstado}

SESGO
${blockSesgo}

ESCENARIOS
${blockEscenarios}

MAPA
${blockMapa}

ZONAS
${blockSoportesResistencias}`;

    return {
      text: textOutput,
      context: {
        symbol,
        spot,
        exp: activeExp,
        king: kingNode.strike,
        formattedKingGex: formatSignVal(kingNode.gex),
        gex: totalNetGex,
        vex: totalNetVex,
        formattedGex: formatSignVal(totalNetGex),
        formattedVex: formatSignVal(totalNetVex)
      },
      dominance: {
        score: dominanceScore,
        label: dominanceLabel,
        structureType
      },
      pressure: {
        val: vexPressureVal,
        interpret: vexPressureInterpret
      },
      bias: {
        val: bias,
        percent: biasPercent,
        label: biasLabel
      },
      scenarios: {
        triggerUp,
        targetRangeUp,
        triggerDown,
        targetRangeDown,
        interactionDown,
        compressA: strongBeforeSpot,
        compressB: strongAfterSpot,
        compressionRange
      },
      map: {
        lowerBound,
        upperBound,
        widthPts,
        spotPositionPercent,
        densityPercent,
        densityText,
        densityClass
      },
      absorption: {
        label: absorptionLabel
      },
      persistence: {
        text: persistenceInfo.text
      },
      kingDistance: {
        spot,
        king: kingNode.strike,
        valText: kingDistValText,
        classLabel: kingDistClass,
        text: kingDistText
      },
      risk: {
        score: riskScore,
        label: riskLabel,
        desc: riskDesc
      },
      levels: {
        resistances,
        supports
      },
      spotDrift: {
        text: driftInfo.text,
        classLabel: driftInfo.classLabel,
        value: driftInfo.value
      }
    };
  }, [filteredMatrixData, data, selectedExp, displayExpirations, exposureMode, dealerCache, symbol]);

  const dealerAnalysis = analysisSnapshot;

  // Validation: Visual = Texto. Si difieren ↓ mostrar warning en consola.
  useEffect(() => {
    if (!analysisSnapshot) return;
    
    const textOutput = analysisSnapshot.text;
    const errors: string[] = [];
    
    // Validate Dominancia
    const visualDom = `${analysisSnapshot.dominance.score.toFixed(1)}%`;
    if (!textOutput.includes(`Dominancia: ${visualDom}`)) {
      errors.push(`Dominancia mismatch: Visual ${visualDom} vs Text`);
    }
    
    // Validate Spot Drift
    const visualDrift = analysisSnapshot.spotDrift.text;
    if (!textOutput.includes(`Spot Drift: ${visualDrift}`)) {
      errors.push(`Spot Drift mismatch: Visual ${visualDrift} vs Text`);
    }
    
    // Validate Presión
    const visualPres = `${analysisSnapshot.pressure.val.toFixed(1)}%`;
    if (!textOutput.includes(`Presión: ${visualPres}`)) {
      errors.push(`Presión mismatch: Visual ${visualPres} vs Text`);
    }
    
    // Validate Sesgo
    const visualBias = `${analysisSnapshot.bias.percent.toFixed(1)}%`;
    if (!textOutput.includes(`Sesgo: ${visualBias}`)) {
      errors.push(`Sesgo mismatch: Visual ${visualBias} vs Text`);
    }
    
    // Validate Persistencia
    const visualPersist = analysisSnapshot.persistence.text;
    if (!textOutput.includes(`Persistencia: ${visualPersist}`)) {
      errors.push(`Persistencia mismatch: Visual ${visualPersist} vs Text`);
    }

    if (errors.length > 0) {
      console.warn("WARNING: Discrepancy between Visual and Text views in Dealer Analysis Snapshot:", errors);
    }
  }, [analysisSnapshot]);

  const toggleMatrixExp = (exp: string) => {
    if (matrixExpMode === "SINGLE") {
      setMatrixSelectedExps([exp]);
      setSelectedExp(exp);
      fetchOptions(symbol, exp);
    } else {
      setMatrixSelectedExps(prev => 
        prev.includes(exp) ? prev.filter(e => e !== exp) : [...prev, exp]
      );
    }
  };

  const formatStatValue = (val: number) => {
    const absVal = Math.abs(val);
    const sign = val >= 0 ? "+" : "−";
    if (absVal >= 1.0e9) return `${sign}$${(absVal / 1.0e9).toFixed(1)}B`;
    if (absVal >= 1.0e6) return `${sign}$${(absVal / 1.0e6).toFixed(1)}M`;
    if (absVal >= 1.0e3) return `${sign}$${(absVal / 1.0e3).toFixed(0)}K`;
    return `${sign}$${absVal.toFixed(0)}`;
  };

  return (
    <div className={styles.container}>
      {/* Header */}
      <header className={styles.header} style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', margin: '0.5rem 1rem 1rem 1rem', padding: '0.75rem 1rem', background: 'rgba(10, 16, 35, 0.45)', backdropFilter: 'blur(12px)', border: '1px solid rgba(255, 255, 255, 0.05)', borderRadius: '12px' }}>
        
        {/* ROW 1: Title and Status */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%', paddingBottom: '0.5rem', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <div className={styles.glowDot} />
            <h1 className={styles.title} style={{ margin: 0 }}>EXPOSURE Dashboard</h1>
          </div>

          {/* Status / Active Exps aligned Right */}
          <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
            {((viewMode === 'chain' && selectedExp) || (viewMode === 'matrix' && matrixSelectedExps.length > 0)) && (
              <div className={styles.connectionStatus} style={{ color: "#c084fc", background: "rgba(192, 132, 252, 0.08)", padding: "0.2rem 0.6rem", borderRadius: "6px", border: "1px solid rgba(192, 132, 252, 0.2)", fontSize: "0.75rem", display: 'flex', alignItems: 'center' }}>
                <Calendar size={14} style={{ marginRight: 6 }} />
                <b>{viewMode === 'matrix' ? (matrixSelectedExps.length === 1 ? matrixSelectedExps[0] : `Multi (${matrixSelectedExps.length})`) : selectedExp}</b>
              </div>
            )}
            <div className={styles.connectionStatus} style={{ justifyContent: 'center', background: error ? "rgba(255, 42, 109, 0.08)" : "rgba(0, 230, 118, 0.08)", padding: "0.2rem 0.6rem", borderRadius: "6px", border: error ? "1px solid rgba(255, 42, 109, 0.2)" : "1px solid rgba(0, 230, 118, 0.2)", fontSize: "0.75rem", display: 'flex', alignItems: 'center' }}>
              <Activity size={12} style={{ marginRight: 6, color: error ? "#ff2a6d" : "#00e676" }} />
              <b style={{ color: error ? "#ff2a6d" : "#00e676" }}>{error ? "Offline" : "Live"}</b>
            </div>
            {lastUpdated && <span style={{ fontSize: '0.7rem', color: '#94a3b8', whiteSpace: 'nowrap' }}>{lastUpdated.toLocaleTimeString()}</span>}
          </div>
        </div>

        {/* ROW 2: Toolbars & Controls */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1.5rem', alignItems: 'center', width: '100%' }}>
          
          {/* Group 1: Ticker Search */}
          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
            <div className={styles.selectWrapper}>
              <select value={symbol} onChange={(e) => { setSymbol(e.target.value); setSelectedExp(""); setMatrixRawData([]); }} className={styles.select} style={{ padding: "0.3rem 1.6rem 0.3rem 0.6rem", fontSize: "0.8rem", minHeight: "auto", fontWeight: 700 }}>
                <option value="SPY">SPY</option>
                <option value="QQQ">QQQ</option>
                <option value="AAPL">AAPL</option>
                <option value="AMZN">AMZN</option>
                <option value="GOOGL">GOOGL</option>
                <option value="META">META</option>
                <option value="MSFT">MSFT</option>
                <option value="NVDA">NVDA</option>
                <option value="TSLA">TSLA</option>
              </select>
              <ChevronDown size={14} className={styles.selectIcon} style={{ right: '0.4rem' }} />
            </div>
          </div>

          {/* Group 2: View Modes */}
          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
            <div className={styles.modeToggles} style={{ marginTop: 0, padding: '2px', height: 'auto', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '6px' }}>
              <button className={`${styles.modeBtn} ${viewMode === 'chain' ? styles.activeMode : ''}`} onClick={() => setViewMode('chain')} style={{ padding: '0.3rem 0.75rem', fontSize: '0.8rem' }}><Columns size={14}/> Chain</button>
              <button className={`${styles.modeBtn} ${viewMode === 'matrix' ? styles.activeMode : ''}`} onClick={() => setViewMode('matrix')} style={{ padding: '0.3rem 0.75rem', fontSize: '0.8rem' }}><Grid size={14}/> Matrix</button>
            </div>
            <div className={styles.exposureTypeToggle} style={{ margin: 0, padding: '2px', background: 'rgba(255,255,255,0.05)', borderRadius: '6px', display: 'flex', border: '1px solid rgba(255,255,255,0.1)' }}>
              <button className={`${styles.expTypeBtn} ${exposureMode === 'RAW' ? styles.activeExpType : ''}`} onClick={() => setExposureMode('RAW')} style={{ padding: '0.3rem 0.75rem', fontSize: '0.8rem' }}>{viewMode === 'chain' ? 'RAW' : 'NET'}</button>
              <button className={`${styles.expTypeBtn} ${exposureMode === 'DEALER' ? styles.activeExpType : ''}`} onClick={() => setExposureMode('DEALER')} style={{ padding: '0.3rem 0.75rem', fontSize: '0.8rem' }}>DEALER</button>
            </div>
          </div>

          {/* Group 3: Matrix Controls (Dynamic) */}
          {viewMode === "matrix" && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flex: 1 }}>
              <div style={{ width: '1px', height: '24px', background: 'rgba(255,255,255,0.1)' }} />
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <span style={{ fontSize: '0.8rem', color: '#94a3b8' }}>Window:</span>
                <select value={matrixStrikeWindow} onChange={e => setMatrixStrikeWindow(Number(e.target.value) as any)} style={{ background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.1)', color: '#e2e8f0', padding: '0.2rem 0.4rem', borderRadius: '4px', fontSize: '0.8rem' }}>
                  <option value={10}>±10</option>
                  <option value={20}>±20</option>
                  <option value={30}>±30</option>
                  <option value={0}>Full</option>
                </select>
              </div>
              <button onClick={() => setMatrixDisplayFormat(matrixDisplayFormat === "HEATMAP" ? "TABLE" : "HEATMAP")} style={{ background: 'transparent', border: '1px solid rgba(255,255,255,0.2)', color: '#fff', padding: '0.2rem 0.6rem', borderRadius: '4px', fontSize: '0.8rem', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                {matrixDisplayFormat === "HEATMAP" ? <Grid size={14} /> : <Columns size={14} />}
                {matrixDisplayFormat === "HEATMAP" ? "View Table" : "View Map"}
              </button>
              
              {/* Expiration Pills for Matrix */}
              {matrixDisplayFormat === "HEATMAP" && displayExpirations.length > 0 && (
                <div style={{ display: 'flex', gap: '0.3rem', alignItems: 'center', flexWrap: 'wrap', marginLeft: 'auto' }}>
                  {displayExpirations.map(exp => (
                    <button key={exp} onClick={() => { setSelectedExp(exp); handleExpirationChange(exp); }} style={{ background: selectedExp === exp ? 'rgba(56, 189, 248, 0.15)' : 'rgba(255,255,255,0.03)', border: selectedExp === exp ? '1px solid #38bdf8' : '1px solid rgba(255,255,255,0.1)', color: selectedExp === exp ? '#fff' : '#94a3b8', padding: '0.2rem 0.6rem', borderRadius: '4px', fontSize: '0.75rem', cursor: 'pointer' }}>
                      {exp.substring(5)}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

        </div>
      </header>

      {refreshStats && (
        <div style={{
          position: 'fixed', top: '20px', left: '50%', transform: 'translateX(-50%)',
          background: 'rgba(10, 16, 35, 0.95)', border: '1px solid #38bdf8', padding: '1rem',
          borderRadius: '8px', zIndex: 9999, color: 'white', display: 'flex', flexDirection: 'column', gap: '0.5rem',
          boxShadow: '0 0 20px rgba(56, 189, 248, 0.2)'
        }}>
          <h3 style={{ margin: 0, fontSize: '0.9rem', color: '#38bdf8' }}>Dealer Cache</h3>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', fontSize: '0.8rem' }}>
            <div><span style={{ color: '#94a3b8' }}>UW:</span> {refreshStats.uw}</div>
            <div><span style={{ color: '#94a3b8' }}>Dealer:</span> {refreshStats.dealer}</div>
            <div style={{ gridColumn: '1 / -1' }}><span style={{ color: '#94a3b8' }}>Time:</span> {refreshStats.duration.toFixed(1)}s</div>
          </div>
        </div>
      )}



      {viewMode === "matrix" ? (
        <>
        {matrixDisplayFormat === "TABLE" ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
            <div style={{ background: 'rgba(10, 16, 35, 0.6)', border: '1px solid rgba(255,255,255,0.15)', borderRadius: '8px', overflow: 'hidden' }}>
              <div style={{ padding: '1rem', borderBottom: '1px solid rgba(255,255,255,0.15)' }}>
                <h3 style={{ margin: 0, color: '#fbbf24', display: 'flex', alignItems: 'center', gap: '0.5rem' }}><Zap size={16} /> GEX Matrix Data Table</h3>
                <p style={{ margin: 0, fontSize: '0.75rem', color: '#94a3b8', marginTop: '0.2rem' }}>Price Hedging Exposure (GEX) by strikes (rows) vs expirations (columns)</p>
              </div>
              <div style={{ overflowX: 'auto', maxHeight: '600px' }} className="custom-scrollbar">
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.75rem', color: '#e2e8f0', border: '1px solid rgba(255,255,255,0.15)' }}>
                  <thead style={{ position: 'sticky', top: 0, zIndex: 10 }}>
                    <tr style={{ background: 'rgba(15, 23, 42, 0.95)' }}>
                      <th style={{ padding: '0.5rem', textAlign: 'left', border: '1px solid rgba(255,255,255,0.15)', position: 'sticky', left: 0, background: 'rgba(15, 23, 42, 1)', zIndex: 11, width: '80px', minWidth: '80px', whiteSpace: 'nowrap' }}>Strike</th>
                      {tableMatrixData.map(d => <th key={d.expiration} style={{ padding: '0.5rem', textAlign: 'right', border: '1px solid rgba(255,255,255,0.15)' }}>{d.expiration}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {Array.from(new Set(tableMatrixData.flatMap(d => [...d.calls, ...d.puts].map(o => o.strike)))).sort((a,b) => b - a).map(strike => (
                      <tr key={strike}>
                        <td style={{ padding: '0.5rem', textAlign: 'left', fontWeight: 'bold', border: '1px solid rgba(255,255,255,0.15)', position: 'sticky', left: 0, background: strike === data?.spot ? 'rgba(56, 189, 248, 0.3)' : 'rgba(15, 23, 42, 0.95)', width: '80px', minWidth: '80px', whiteSpace: 'nowrap' }}>{strike}</td>
                        {tableMatrixData.map(chain => {
                          const c = chain.calls.find((o: any) => o.strike === strike);
                          const p = chain.puts.find((o: any) => o.strike === strike);
                          const val = (c?.gex || 0) + (p?.gex || 0);
                          const isKing = Math.abs(val) === (chain as any).gexMax && (chain as any).gexMax > 1;
                          const intensity = Math.min(1, Math.max(0, Math.abs(val) / (chain as any).gexMax));
                          const bgColor = val > 0 ? `rgba(0, 230, 118, ${intensity})` : val < 0 ? `rgba(255, 42, 109, ${intensity})` : 'transparent';
                          const textColor = intensity > 0.6 && !isKing ? '#000' : '#fff';
                          
                          let cellStyle: React.CSSProperties = { 
                            padding: '0.5rem', 
                            textAlign: 'right', 
                            background: bgColor, 
                            color: val === 0 ? '#94a3b8' : textColor,
                            border: '1px solid rgba(255,255,255,0.05)'
                          };

                          if (isKing) {
                            cellStyle.border = "2px solid #fff";
                            cellStyle.boxShadow = "0 0 10px rgba(255, 255, 255, 0.5) inset";
                            cellStyle.fontWeight = "bold";
                          }

                          return (
                            <td key={chain.expiration} style={cellStyle}>
                              {val === 0 ? '0' : formatGex(val)}
                              {isKing && <span style={{ marginLeft: '6px', fontSize: '0.55rem', background: '#fbbf24', color: '#000', padding: '1px 3px', borderRadius: '3px', verticalAlign: 'middle' }}>KING</span>}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div style={{ background: 'rgba(10, 16, 35, 0.6)', border: '1px solid rgba(255,255,255,0.15)', borderRadius: '8px', overflow: 'hidden', marginBottom: '2rem' }}>
              <div style={{ padding: '1rem', borderBottom: '1px solid rgba(255,255,255,0.15)' }}>
                <h3 style={{ margin: 0, color: '#c084fc', display: 'flex', alignItems: 'center', gap: '0.5rem' }}><Layers size={16} /> VEX Matrix Data Table</h3>
                <p style={{ margin: 0, fontSize: '0.75rem', color: '#94a3b8', marginTop: '0.2rem' }}>IV Hedging Exposure (VEX) by strikes (rows) vs expirations (columns)</p>
              </div>
              <div style={{ overflowX: 'auto', maxHeight: '600px' }} className="custom-scrollbar">
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.75rem', color: '#e2e8f0', border: '1px solid rgba(255,255,255,0.15)' }}>
                  <thead style={{ position: 'sticky', top: 0, zIndex: 10 }}>
                    <tr style={{ background: 'rgba(15, 23, 42, 0.95)' }}>
                      <th style={{ padding: '0.5rem', textAlign: 'left', border: '1px solid rgba(255,255,255,0.15)', position: 'sticky', left: 0, background: 'rgba(15, 23, 42, 1)', zIndex: 11, width: '80px', minWidth: '80px', whiteSpace: 'nowrap' }}>Strike</th>
                      {tableMatrixData.map(d => <th key={d.expiration} style={{ padding: '0.5rem', textAlign: 'right', border: '1px solid rgba(255,255,255,0.15)' }}>{d.expiration}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {Array.from(new Set(tableMatrixData.flatMap(d => [...d.calls, ...d.puts].map(o => o.strike)))).sort((a,b) => b - a).map(strike => (
                      <tr key={strike}>
                        <td style={{ padding: '0.5rem', textAlign: 'left', fontWeight: 'bold', border: '1px solid rgba(255,255,255,0.15)', position: 'sticky', left: 0, background: strike === data?.spot ? 'rgba(56, 189, 248, 0.3)' : 'rgba(15, 23, 42, 0.95)', width: '80px', minWidth: '80px', whiteSpace: 'nowrap' }}>{strike}</td>
                        {tableMatrixData.map(chain => {
                          const c = chain.calls.find((o: any) => o.strike === strike);
                          const p = chain.puts.find((o: any) => o.strike === strike);
                          const val = (c?.vanna || 0) + (p?.vanna || 0);
                          const isKing = Math.abs(val) === (chain as any).vannaMax && (chain as any).vannaMax > 1;
                          const intensity = Math.min(1, Math.max(0, Math.abs(val) / (chain as any).vannaMax));
                          const bgColor = val > 0 ? `rgba(6, 182, 212, ${intensity})` : val < 0 ? `rgba(217, 70, 239, ${intensity})` : 'transparent';
                          const textColor = intensity > 0.6 && !isKing ? '#000' : '#fff';

                          let cellStyle: React.CSSProperties = { 
                            padding: '0.5rem', 
                            textAlign: 'right', 
                            background: bgColor, 
                            color: val === 0 ? '#94a3b8' : textColor,
                            border: '1px solid rgba(255,255,255,0.05)'
                          };

                          if (isKing) {
                            cellStyle.border = "2px solid #fff";
                            cellStyle.boxShadow = "0 0 10px rgba(255, 255, 255, 0.5) inset";
                            cellStyle.fontWeight = "bold";
                          }

                          return (
                            <td key={chain.expiration} style={cellStyle}>
                              {val === 0 ? '0' : formatGex(val)}
                              {isKing && <span style={{ marginLeft: '6px', fontSize: '0.55rem', background: '#c084fc', color: '#fff', padding: '1px 3px', borderRadius: '3px', verticalAlign: 'middle' }}>KING</span>}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        ) : (
        <div className={styles.dualMatrixGrid}>
          {/* GEX Panel */}
          <div className={styles.matrixPanel}>
            <div className={styles.panelHeader}>
              <div>
                <div className={styles.panelTitle}>⚡ GEX Matrix</div>
                <div className={styles.panelSubtitle}>Price Hedging Exposure</div>
              </div>
              {gexStats && (
                <div className={styles.panelStats}>
                  <div className={styles.panelStatItem}>
                    <span className={styles.panelStatLabel}>King Node</span>
                    <span className={styles.panelStatValue} style={{color: '#fbbf24'}}>{gexStats.kingNode?.strike}</span>
                  </div>
                  <div className={styles.panelStatItem}>
                    <span className={styles.panelStatLabel}>Net Exposure</span>
                    <span className={styles.panelStatValue} style={{color: (gexStats.kingNode?.val || 0) >= 0 ? '#00e676' : '#ff2a6d'}}>
                      {formatStatValue(gexStats.kingNode?.val || 0)}
                    </span>
                  </div>
                  <div className={styles.panelStatItem}>
                    <span className={styles.panelStatLabel}>Visible Nodes</span>
                    <span className={styles.panelStatValue}>{gexStats.visibleNodes}</span>
                  </div>
                </div>
              )}
            </div>
            <GammaMatrix 
              rawData={filteredMatrixData} 
              exposureType="GEX"
              aggregation={matrixAggregation}
              spot={data?.spot || 0}
              symbol={symbol}
              relevantOnly={matrixRelevantOnly}
              colorTheme="GEX"
              alignColorScaleWithMax={undefined}
              hoveredStrike={hoveredStrike}
              onHoverStrike={setHoveredStrike}
              selectedNode={selectedNode}
              onSelectNode={setSelectedNode}
              scrollRef={gexScrollRef}
              onScroll={e => {
                if (isSyncingRef.current === "VEX") return;
                isSyncingRef.current = "GEX";
                if (vexScrollRef.current) {
                  vexScrollRef.current.scrollTop = e.currentTarget.scrollTop;
                  vexScrollRef.current.scrollLeft = e.currentTarget.scrollLeft;
                }
                setTimeout(() => { isSyncingRef.current = null; }, 50);
              }}
              onStatsUpdate={stats => {
                setGexStats((prev: any) => ({...prev, ...stats}));
              }}
              dealerCache={dealerCache}
            />
          </div>

          {/* VEX Panel */}
          <div className={styles.matrixPanel}>
            <div className={styles.panelHeader}>
              <div>
                <div className={styles.panelTitle}>🌀 VEX Matrix</div>
                <div className={styles.panelSubtitle}>IV Hedging Exposure</div>
              </div>
              {vexStats && (
                <div className={styles.panelStats}>
                  <div className={styles.panelStatItem}>
                    <span className={styles.panelStatLabel}>King Node</span>
                    <span className={styles.panelStatValue} style={{color: '#c084fc'}}>{vexStats.kingNode?.strike}</span>
                  </div>
                  <div className={styles.panelStatItem}>
                    <span className={styles.panelStatLabel}>Net Exposure</span>
                    <span className={styles.panelStatValue} style={{color: (vexStats.kingNode?.val || 0) >= 0 ? '#06b6d4' : '#d946ef'}}>
                      {formatStatValue(vexStats.kingNode?.val || 0)}
                    </span>
                  </div>
                  <div className={styles.panelStatItem}>
                    <span className={styles.panelStatLabel}>Visible Nodes</span>
                    <span className={styles.panelStatValue}>{vexStats.visibleNodes}</span>
                  </div>
                </div>
              )}
            </div>
            <GammaMatrix 
              rawData={filteredMatrixData} 
              exposureType="VEX"
              aggregation={matrixAggregation}
              spot={data?.spot || 0}
              symbol={symbol}
              relevantOnly={matrixRelevantOnly}
              colorTheme="VEX"
              alignColorScaleWithMax={undefined}
              hoveredStrike={hoveredStrike}
              onHoverStrike={setHoveredStrike}
              selectedNode={selectedNode}
              onSelectNode={setSelectedNode}
              scrollRef={vexScrollRef}
              onScroll={e => {
                if (isSyncingRef.current === "GEX") return;
                isSyncingRef.current = "VEX";
                if (gexScrollRef.current) {
                  gexScrollRef.current.scrollTop = e.currentTarget.scrollTop;
                  gexScrollRef.current.scrollLeft = e.currentTarget.scrollLeft;
                }
                setTimeout(() => { isSyncingRef.current = null; }, 50);
              }}
              onStatsUpdate={stats => {
                setVexStats((prev: any) => ({...prev, ...stats}));
              }}
              dealerCache={dealerCache}
            />
          </div>

          {/* Third Interpretive Panel */}
          <div className={styles.matrixPanel}>
            <div className={styles.panelHeader}>
              <div>
                <div className={styles.panelTitle}>📝 Análisis del Dealer</div>
                <div className={styles.panelSubtitle}>Interpretación del mercado</div>
              </div>
              {dealerAnalysis && (
                <div style={{ display: "flex", gap: "0.25rem", background: "rgba(255,255,255,0.03)", padding: "2px", borderRadius: "6px", border: "1px solid rgba(255,255,255,0.05)" }}>
                  <button 
                    onClick={() => setAnalysisTab("visual")}
                    style={{ 
                      background: analysisTab === "visual" ? "rgba(255,255,255,0.08)" : "transparent",
                      border: "none", color: analysisTab === "visual" ? "#fff" : "#94a3b8",
                      padding: "0.2rem 0.5rem", borderRadius: "4px", fontSize: "0.65rem", cursor: "pointer",
                      display: "flex", alignItems: "center", gap: "0.25rem" 
                    }}
                  >
                    <Eye size={10} /> Visual
                  </button>
                  <button 
                    onClick={() => setAnalysisTab("text")}
                    style={{ 
                      background: analysisTab === "text" ? "rgba(255,255,255,0.08)" : "transparent",
                      border: "none", color: analysisTab === "text" ? "#fff" : "#94a3b8",
                      padding: "0.2rem 0.5rem", borderRadius: "4px", fontSize: "0.65rem", cursor: "pointer",
                      display: "flex", alignItems: "center", gap: "0.25rem" 
                    }}
                  >
                    <FileText size={10} /> Texto
                  </button>
                </div>
              )}
            </div>
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '0.75rem', overflowY: 'auto', marginTop: '0.5rem' }}>
              {!dealerAnalysis ? (
                <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '200px' }}>
                  <p style={{ color: '#94a3b8', fontStyle: 'italic', fontSize: '0.85rem' }}>Esperando texto interpretativo...</p>
                </div>
              ) : analysisTab === "visual" ? (
                <div style={{ display: "flex", flexDirection: "column", gap: "0.8rem" }} className="animate-fade-in">
                  
                  {/* Context Grid */}
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "0.4rem" }}>
                    <div style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.05)", padding: "0.4rem 0.5rem", borderRadius: "6px", display: "flex", flexDirection: "column" }}>
                      <span style={{ fontSize: "0.6rem", color: "#94a3b8", textTransform: "uppercase" }}>King GEX</span>
                      <span style={{ fontSize: "0.9rem", fontWeight: 700, color: "#fbbf24", fontFamily: "monospace" }}>{dealerAnalysis.context.king}</span>
                      <span style={{ fontSize: "0.6rem", color: "#94a3b8", fontFamily: "monospace" }}>{dealerAnalysis.context.formattedKingGex}</span>
                    </div>
                    <div style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.05)", padding: "0.4rem 0.5rem", borderRadius: "6px", display: "flex", flexDirection: "column" }}>
                      <span style={{ fontSize: "0.6rem", color: "#94a3b8", textTransform: "uppercase" }}>Net GEX</span>
                      <span style={{ fontSize: "0.9rem", fontWeight: 700, color: dealerAnalysis.context.gex >= 0 ? "#00e676" : "#ff2a6d", fontFamily: "monospace" }}>{dealerAnalysis.context.formattedGex}</span>
                    </div>
                    <div style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.05)", padding: "0.4rem 0.5rem", borderRadius: "6px", display: "flex", flexDirection: "column" }}>
                      <span style={{ fontSize: "0.6rem", color: "#94a3b8", textTransform: "uppercase" }}>Net VEX</span>
                      <span style={{ fontSize: "0.9rem", fontWeight: 700, color: dealerAnalysis.context.vex >= 0 ? "#06b6d4" : "#d946ef", fontFamily: "monospace" }}>{dealerAnalysis.context.formattedVex}</span>
                    </div>
                    {/* Relationship row */}
                    <div style={{ gridColumn: "span 3", background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.05)", padding: "0.4rem 0.5rem", borderRadius: "6px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <span style={{ fontSize: "0.65rem", color: "#94a3b8", textTransform: "uppercase" }}>Relación Spot/King</span>
                      <span style={{ fontSize: "0.75rem", fontWeight: 600, color: "#fff", fontFamily: "monospace" }}>
                        Distancia: <strong style={{ color: "#fbbf24" }}>{dealerAnalysis.kingDistance.valText}</strong> ({dealerAnalysis.kingDistance.classLabel})
                      </span>
                    </div>
                  </div>

                  {/* Reading Section (Lectura) */}
                  <div style={{ background: "rgba(0,0,0,0.15)", border: "1px solid rgba(255,255,255,0.03)", padding: "0.6rem 0.75rem", borderRadius: "8px", display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                    
                    {/* Dominancia */}
                    <div style={{ display: "flex", flexDirection: "column", gap: "0.2rem" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.7rem" }}>
                        <span style={{ color: "#94a3b8", textTransform: "uppercase", fontWeight: 600 }}>Dominancia (King)</span>
                        <span style={{ color: "#fff", fontWeight: 700, fontFamily: "monospace" }}>
                          {dealerAnalysis.dominance.score.toFixed(1)}% ({dealerAnalysis.dominance.label})
                        </span>
                      </div>
                      <div style={{ height: "4px", background: "rgba(255,255,255,0.05)", borderRadius: "2px", overflow: "hidden", display: "flex" }}>
                        <div style={{ 
                          width: `${dealerAnalysis.dominance.score}%`, 
                          background: dealerAnalysis.dominance.label === "Difuso" ? "#38bdf8" : 
                                      dealerAnalysis.dominance.label === "Normal" ? "#34d399" : 
                                      dealerAnalysis.dominance.label === "Concentrado" ? "#fbbf24" : "#f87171" 
                        }} />
                      </div>
                    </div>

                    {/* Fuerza Relativa */}
                    <div style={{ display: "flex", flexDirection: "column", gap: "0.2rem" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.7rem" }}>
                        <span style={{ color: "#94a3b8", textTransform: "uppercase", fontWeight: 600 }}>Presión VEX/GEX</span>
                        <span style={{ color: "#fff", fontWeight: 700, fontFamily: "monospace" }}>
                          {dealerAnalysis.pressure.val.toFixed(1)}% ({dealerAnalysis.pressure.interpret})
                        </span>
                      </div>
                      <div style={{ height: "4px", background: "rgba(255,255,255,0.05)", borderRadius: "2px", overflow: "hidden" }}>
                        <div style={{ 
                          width: `${Math.min(100, dealerAnalysis.pressure.val)}%`, 
                          background: dealerAnalysis.pressure.interpret === "Precio domina" ? "#34d399" : 
                                      dealerAnalysis.pressure.interpret === "Mixto" ? "#fbbf24" : "#a855f7" 
                        }} />
                      </div>
                    </div>

                    {/* Sesgo Estructural */}
                    <div style={{ display: "flex", flexDirection: "column", gap: "0.2rem" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.7rem" }}>
                        <span style={{ color: "#94a3b8", textTransform: "uppercase", fontWeight: 600 }}>Sesgo Estructural</span>
                        <span style={{ color: "#fff", fontWeight: 700, fontFamily: "monospace" }}>
                          {dealerAnalysis.bias.percent.toFixed(1)}% ({dealerAnalysis.bias.label})
                        </span>
                      </div>
                      <div style={{ height: "6px", background: "rgba(255,255,255,0.05)", borderRadius: "3px", overflow: "hidden", position: "relative" }}>
                        {/* Center line indicator */}
                        <div style={{ position: "absolute", left: "50%", top: 0, bottom: 0, width: "1px", background: "rgba(255,255,255,0.3)", zIndex: 1 }} />
                        {/* Fill bar */}
                        <div style={{ 
                          position: "absolute",
                          left: dealerAnalysis.bias.percent >= 0 ? "50%" : `calc(50% - ${Math.min(50, Math.abs(dealerAnalysis.bias.percent) / 2)}%)`,
                          width: `${Math.min(50, Math.abs(dealerAnalysis.bias.percent) / 2)}%`,
                          height: "100%",
                          background: dealerAnalysis.bias.percent >= 0 ? "#34d399" : "#ff2a6d"
                        }} />
                      </div>
                      <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.55rem", color: "#64748b", marginTop: "2px", textTransform: "uppercase" }}>
                        <span>Negativo</span>
                        <span>Neutral</span>
                        <span>Positivo</span>
                      </div>
                    </div>

                    {/* Persistencia */}
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderTop: "1px solid rgba(255,255,255,0.05)", paddingTop: "0.4rem", fontSize: "0.7rem" }}>
                      <span style={{ color: "#94a3b8", textTransform: "uppercase", fontWeight: 600 }}>Persistencia</span>
                      <span style={{ color: "#cbd5e1", fontFamily: "monospace", display: "flex", alignItems: "center", gap: "0.25rem" }}>
                        <span style={{ width: "6px", height: "6px", borderRadius: "50%", background: "#38bdf8", display: "inline-block" }}></span>
                        {dealerAnalysis.persistence.text}
                      </span>
                    </div>
                  </div>

                  {/* Scenarios Section */}
                  <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                    
                    {/* Recovery */}
                    <div style={{ background: "rgba(52, 211, 153, 0.04)", border: "1px solid rgba(52, 211, 153, 0.15)", padding: "0.5rem 0.6rem", borderRadius: "6px" }}>
                      <div style={{ fontSize: "0.75rem", fontWeight: 600, color: "#34d399", display: "flex", alignItems: "center", gap: "0.25rem" }}>
                        <span>▲ Escenario Superior</span>
                        <span style={{ background: "rgba(52, 211, 153, 0.1)", color: "#34d399", padding: "1px 4px", borderRadius: "4px", fontSize: "0.6rem", fontFamily: "monospace" }}>
                          Recupera {dealerAnalysis.scenarios.triggerUp}
                        </span>
                      </div>
                      <div style={{ fontSize: "0.75rem", color: "#cbd5e1", marginTop: "0.2rem", lineHeight: 1.3 }}>
                        Si recupera {dealerAnalysis.scenarios.triggerUp} podría interactuar con zona de absorción <strong style={{ color: "#fff", fontFamily: "monospace" }}>{dealerAnalysis.scenarios.targetRangeUp}</strong>.
                      </div>
                    </div>

                    {/* Losing */}
                    <div style={{ background: "rgba(248, 113, 113, 0.04)", border: "1px solid rgba(248, 113, 113, 0.15)", padding: "0.5rem 0.6rem", borderRadius: "6px" }}>
                      <div style={{ fontSize: "0.75rem", fontWeight: 600, color: "#f87171", display: "flex", alignItems: "center", gap: "0.25rem" }}>
                        <span>▼ Escenario Inferior</span>
                        <span style={{ background: "rgba(248, 113, 113, 0.1)", color: "#f87171", padding: "1px 4px", borderRadius: "4px", fontSize: "0.6rem", fontFamily: "monospace" }}>
                          Pierde {dealerAnalysis.scenarios.triggerDown}
                        </span>
                      </div>
                      <div style={{ fontSize: "0.75rem", color: "#cbd5e1", marginTop: "0.2rem", lineHeight: 1.3 }}>
                        Si pierde {dealerAnalysis.scenarios.triggerDown} podría perder absorción hasta zona <strong style={{ color: "#fff", fontFamily: "monospace" }}>{dealerAnalysis.scenarios.targetRangeDown}</strong>, con siguiente interacción en <strong style={{ color: "#fff", fontFamily: "monospace" }}>{dealerAnalysis.scenarios.interactionDown}</strong>.
                      </div>
                    </div>

                    {/* Risk Rating */}
                    <div style={{ background: dealerAnalysis.risk.label === "Alto" ? "rgba(239, 68, 68, 0.04)" : dealerAnalysis.risk.label === "Medio" ? "rgba(251, 191, 36, 0.04)" : "rgba(56, 189, 248, 0.04)", border: dealerAnalysis.risk.label === "Alto" ? "1px solid rgba(239, 68, 68, 0.15)" : dealerAnalysis.risk.label === "Medio" ? "1px solid rgba(251, 191, 36, 0.15)" : "1px solid rgba(56, 189, 248, 0.15)", padding: "0.5rem 0.6rem", borderRadius: "6px" }}>
                      <div style={{ fontSize: "0.75rem", fontWeight: 600, color: dealerAnalysis.risk.label === "Alto" ? "#ef4444" : dealerAnalysis.risk.label === "Medio" ? "#fbbf24" : "#38bdf8" }}>
                        ⚠️ Riesgo Estructural: {dealerAnalysis.risk.score.toFixed(2)} ({dealerAnalysis.risk.label})
                      </div>
                      <div style={{ fontSize: "0.75rem", color: "#cbd5e1", marginTop: "0.2rem" }}>
                        {dealerAnalysis.risk.desc}
                      </div>
                    </div>
                  </div>

                  {/* Niveles GEX Section */}
                  <div style={{ background: "rgba(255,255,255,0.01)", border: "1px solid rgba(255,255,255,0.05)", padding: "0.5rem 0.6rem", borderRadius: "8px", display: "flex", flexDirection: "column", gap: "0.4rem" }}>
                    <div style={{ fontSize: "0.7rem", fontWeight: 700, color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.5px" }}>Niveles GEX (Zonas superiores & inferiores)</div>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.5rem" }}>
                      {/* Zonas superiores */}
                      <div style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
                        <span style={{ fontSize: "0.6rem", color: "#f87171", textTransform: "uppercase", fontWeight: 600 }}>Zonas superiores</span>
                        {dealerAnalysis.levels.resistances.map((r: any, idx: number) => (
                          <div key={idx} style={{ background: "rgba(248, 113, 113, 0.03)", border: "1px solid rgba(248, 113, 113, 0.08)", padding: "0.3rem", borderRadius: "4px", display: "flex", justifyContent: "space-between", fontSize: "0.7rem", fontFamily: "monospace" }}>
                            <span style={{ color: "#f87171", fontWeight: 600 }}>{r.label}: {r.strike}</span>
                            <span style={{ color: "#cbd5e1" }}>{r.formatted} ({r.weight.toFixed(1)}% King)</span>
                          </div>
                        ))}
                        {dealerAnalysis.levels.resistances.length === 0 && (
                          <span style={{ fontSize: "0.65rem", color: "#64748b", fontStyle: "italic" }}>Ninguna</span>
                        )}
                      </div>
                      {/* Zonas inferiores */}
                      <div style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
                        <span style={{ fontSize: "0.6rem", color: "#34d399", textTransform: "uppercase", fontWeight: 600 }}>Zonas inferiores</span>
                        {dealerAnalysis.levels.supports.map((s: any, idx: number) => (
                          <div key={idx} style={{ background: "rgba(52, 211, 153, 0.03)", border: "1px solid rgba(52, 211, 153, 0.08)", padding: "0.3rem", borderRadius: "4px", display: "flex", justifyContent: "space-between", fontSize: "0.7rem", fontFamily: "monospace" }}>
                            <span style={{ color: "#34d399", fontWeight: 600 }}>{s.label}: {s.strike}</span>
                            <span style={{ color: "#cbd5e1" }}>{s.formatted} ({s.weight.toFixed(1)}% King)</span>
                          </div>
                        ))}
                        {dealerAnalysis.levels.supports.length === 0 && (
                          <span style={{ fontSize: "0.65rem", color: "#64748b", fontStyle: "italic" }}>Ninguno</span>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Estado Estructural */}
                  <div style={{ background: "rgba(255,255,255,0.01)", border: "1px solid rgba(255,255,255,0.05)", padding: "0.5rem 0.6rem", borderRadius: "8px", display: "flex", flexDirection: "column", gap: "0.4rem" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: "0.7rem" }}>
                      <span style={{ color: "#94a3b8", textTransform: "uppercase", fontWeight: 600 }}>Mapa Estructural</span>
                      <span style={{ color: "#fff", fontWeight: 600, fontFamily: "monospace" }}>
                        {dealerAnalysis.map.lowerBound}–{dealerAnalysis.map.upperBound} ({dealerAnalysis.map.widthPts} pts) | Densidad: {dealerAnalysis.map.densityText}
                      </span>
                    </div>

                    {/* Spot position relative to bounds */}
                    <div style={{ display: "flex", flexDirection: "column", gap: "0.2rem" }}>
                      <div style={{ height: "14px", background: "rgba(255,255,255,0.03)", borderRadius: "4px", border: "1px solid rgba(255,255,255,0.05)", position: "relative", overflow: "hidden" }}>
                        <span style={{ position: "absolute", left: "4px", top: "1px", fontSize: "0.55rem", color: "#64748b", fontFamily: "monospace" }}>
                          {dealerAnalysis.map.lowerBound}
                        </span>
                        <span style={{ position: "absolute", right: "4px", top: "1px", fontSize: "0.55rem", color: "#64748b", fontFamily: "monospace" }}>
                          {dealerAnalysis.map.upperBound}
                        </span>
                        <div style={{ 
                          position: "absolute", 
                          left: `${Math.max(0, Math.min(100, dealerAnalysis.map.spotPositionPercent))}%`, 
                          top: 0, 
                          bottom: 0, 
                          width: "2px", 
                          background: "#38bdf8", 
                          boxShadow: "0 0 4px #38bdf8",
                          zIndex: 2 
                        }} />
                        <span style={{ 
                          position: "absolute", 
                          left: `calc(${Math.max(0, Math.min(100, dealerAnalysis.map.spotPositionPercent))}% + 4px)`, 
                          top: "1px", 
                          fontSize: "0.55rem", 
                          color: "#38bdf8", 
                          fontFamily: "monospace",
                          fontWeight: 600,
                          transform: dealerAnalysis.map.spotPositionPercent > 80 ? "translateX(-110%)" : "none"
                        }}>
                          Spot: {dealerAnalysis.context.spot.toFixed(0)} ({dealerAnalysis.map.spotPositionPercent}%)
                        </span>
                      </div>
                    </div>

                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.5rem", borderTop: "1px solid rgba(255,255,255,0.05)", paddingTop: "0.4rem" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: "0.7rem" }}>
                        <span style={{ color: "#94a3b8" }}>Absorción:</span>
                        <span style={{ 
                          fontWeight: 700, 
                          color: dealerAnalysis.absorption.label === "Alta" ? "#34d399" : 
                                 dealerAnalysis.absorption.label === "Media" ? "#fbbf24" : "#f87171" 
                        }}>
                          {dealerAnalysis.absorption.label}
                        </span>
                      </div>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: "0.7rem" }}>
                        <span style={{ color: "#94a3b8" }}>Compresión:</span>
                        <span style={{ color: "#fff", fontWeight: 600, fontFamily: "monospace" }}>
                          {dealerAnalysis.scenarios.compressionRange}
                        </span>
                      </div>
                    </div>
                  </div>

                </div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", height: "100%", gap: "0.5rem", background: "#0f172a", borderRadius: "8px", border: "1px solid rgba(255,255,255,0.05)", overflowY: "auto", position: "relative" }} className="animate-fade-in">
                  <div style={{ position: "absolute", top: "12px", right: "12px", zIndex: 10 }}>
                    <button 
                      onClick={() => {
                        navigator.clipboard.writeText(dealerAnalysis.text);
                        setCopied(true);
                        setTimeout(() => setCopied(false), 2000);
                      }}
                      style={{ 
                        background: "rgba(255,255,255,0.1)", border: "1px solid rgba(255,255,255,0.2)",
                        color: "#fff", padding: "0.4rem 0.7rem", borderRadius: "6px", fontSize: "0.75rem",
                        cursor: "pointer", display: "flex", alignItems: "center", gap: "0.3rem", transition: "all 0.2s" 
                      }}
                    >
                      {copied ? <Check size={12} style={{ color: "#34d399" }} /> : <Copy size={12} />}
                      {copied ? "Copiado" : "Copiar"}
                    </button>
                  </div>
                  
                  <div style={{ 
                    maxWidth: "90ch", margin: "0 auto", padding: "1.5rem", width: "100%",
                    fontSize: "100%", fontFamily: "system-ui, -apple-system, sans-serif", color: "#e2e8f0",
                    display: "flex", flexDirection: "column", gap: "12px", lineHeight: "1.4"
                  }}>
                    {/* Nivel 1 */}
                    <div style={{ fontSize: "1.3em", fontWeight: 800, color: "#fff", borderBottom: "1px solid rgba(255,255,255,0.1)", paddingBottom: "8px", letterSpacing: "-0.5px" }}>
                      {dealerAnalysis.context.symbol} • Spot {dealerAnalysis.context.spot.toFixed(1)} • Exp {dealerAnalysis.context.exp}
                    </div>

                    {/* ESTADO */}
                    <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                      <div style={{ fontWeight: 600, color: "#fff", letterSpacing: "1px", fontSize: "1.1em", textTransform: "uppercase" }}>ESTADO</div>
                      <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: "6px" }}>
                        <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
                          <span style={{ color: "#94a3b8", fontSize: "0.9em" }}>Dominancia:</span>
                          <span style={{ color: "#f8fafc", fontWeight: 500 }}>{dealerAnalysis.dominance.score.toFixed(0)}% ({dealerAnalysis.dominance.label})</span>
                        </div>
                        <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
                          <span style={{ color: "#94a3b8", fontSize: "0.9em" }}>Relación:</span>
                          <span style={{ color: "#f8fafc", fontWeight: 500 }}>Spot {dealerAnalysis.context.spot.toFixed(1)} &nbsp; King {dealerAnalysis.context.king} &nbsp; Dist {dealerAnalysis.kingDistance.valText}</span>
                        </div>
                        <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
                          <span style={{ color: "#94a3b8", fontSize: "0.9em" }}>Presión:</span>
                          <span style={{ color: "#f8fafc", fontWeight: 500 }}>{dealerAnalysis.pressure.val.toFixed(1)}% {dealerAnalysis.pressure.interpret}</span>
                        </div>
                        <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
                          <span style={{ color: "#94a3b8", fontSize: "0.9em" }}>Persistencia:</span>
                          <span style={{ color: "#f8fafc", fontWeight: 500 }}>{dealerAnalysis.persistence.text.replace(/snapshots?\s/, "snaps ")}</span>
                        </div>
                      </div>
                    </div>

                    {/* SESGO */}
                    <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                      <div style={{ fontWeight: 600, color: "#fff", letterSpacing: "1px", fontSize: "1.1em", textTransform: "uppercase" }}>SESGO</div>
                      <div style={{ color: "#f8fafc", fontWeight: 500 }}>
                        Sesgo: {dealerAnalysis.bias.percent.toFixed(1)}% ({dealerAnalysis.bias.label})
                      </div>
                    </div>

                    {/* ESCENARIOS */}
                    <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                      <div style={{ fontWeight: 600, color: "#fff", letterSpacing: "1px", fontSize: "1.1em", textTransform: "uppercase" }}>ESCENARIOS</div>
                      <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                        {/* Superior */}
                        <div style={{ background: "rgba(52, 211, 153, 0.05)", border: "1px solid rgba(52, 211, 153, 0.2)", borderRadius: "6px", padding: "8px 12px", display: "flex", alignItems: "center", gap: "12px" }}>
                          <div style={{ fontSize: "0.85em", color: "#34d399", fontWeight: 700, letterSpacing: "0.5px", minWidth: "80px" }}>SUPERIOR</div>
                          <div style={{ color: "#f8fafc", fontWeight: 500, fontFamily: "monospace", fontSize: "1em" }}>{dealerAnalysis.scenarios.triggerUp} → {dealerAnalysis.scenarios.targetRangeUp}</div>
                        </div>
                        {/* Inferior */}
                        <div style={{ background: "rgba(248, 113, 113, 0.05)", border: "1px solid rgba(248, 113, 113, 0.2)", borderRadius: "6px", padding: "8px 12px", display: "flex", alignItems: "center", gap: "12px" }}>
                          <div style={{ fontSize: "0.85em", color: "#f87171", fontWeight: 700, letterSpacing: "0.5px", minWidth: "80px" }}>INFERIOR</div>
                          <div style={{ color: "#f8fafc", fontWeight: 500, fontFamily: "monospace", fontSize: "1em" }}>{dealerAnalysis.scenarios.triggerDown} → {dealerAnalysis.scenarios.targetRangeDown} → {dealerAnalysis.scenarios.interactionDown}</div>
                        </div>
                      </div>
                    </div>

                    {/* MAPA */}
                    <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                      <div style={{ fontWeight: 600, color: "#fff", letterSpacing: "1px", fontSize: "1.1em", textTransform: "uppercase" }}>MAPA</div>
                      <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                          <span style={{ color: "#94a3b8", fontSize: "0.9em", minWidth: "90px" }}>Estructura:</span>
                          <span style={{ color: "#f8fafc", fontWeight: 500 }}>{dealerAnalysis.map.lowerBound}–{dealerAnalysis.map.upperBound}</span>
                        </div>
                        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                          <span style={{ color: "#94a3b8", fontSize: "0.9em", minWidth: "90px" }}>Spot:</span>
                          <span style={{ color: "#f8fafc", fontWeight: 500 }}>{dealerAnalysis.map.spotPositionPercent < 33 ? "Inferior" : dealerAnalysis.map.spotPositionPercent > 66 ? "Superior" : "Central"}</span>
                        </div>
                        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                          <span style={{ color: "#94a3b8", fontSize: "0.9em", minWidth: "90px" }}>Densidad:</span>
                          <span style={{ color: "#f8fafc", fontWeight: 500 }}>{`${dealerAnalysis.map.densityPercent.toFixed(0)}% ${dealerAnalysis.map.densityClass}`}</span>
                        </div>
                        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                          <span style={{ color: "#94a3b8", fontSize: "0.9em", minWidth: "90px" }}>Compresión:</span>
                          <span style={{ color: "#f8fafc", fontWeight: 500 }}>{dealerAnalysis.scenarios.compressionRange !== "Sin compresión relevante (0)" ? "Sí" : "No"}</span>
                        </div>
                      </div>
                    </div>

                    {/* ZONAS */}
                    <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                      <div style={{ fontWeight: 600, color: "#fff", letterSpacing: "1px", fontSize: "1.1em", textTransform: "uppercase" }}>ZONAS</div>
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "24px" }}>
                        <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                          <div style={{ fontSize: "0.85em", color: "#f87171", fontWeight: 700, letterSpacing: "0.5px" }}>ZONAS SUPERIORES</div>
                          <table style={{ width: "100%", borderCollapse: "collapse", fontFamily: "monospace", fontSize: "1em", color: "#f8fafc" }}>
                            <tbody>
                              {dealerAnalysis.levels.resistances.map((r: any, idx: number) => (
                                <tr key={idx}>
                                  <td style={{ color: "#f87171", padding: "2px 0" }}>{r.strike}</td>
                                  <td style={{ textAlign: "right", padding: "2px 0" }}>{r.formatted}</td>
                                </tr>
                              ))}
                              {dealerAnalysis.levels.resistances.length === 0 && <tr><td colSpan={2} style={{ color: "#94a3b8", padding: "2px 0" }}>Ninguna</td></tr>}
                            </tbody>
                          </table>
                        </div>
                        <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                          <div style={{ fontSize: "0.85em", color: "#34d399", fontWeight: 700, letterSpacing: "0.5px" }}>ZONAS INFERIORES</div>
                          <table style={{ width: "100%", borderCollapse: "collapse", fontFamily: "monospace", fontSize: "1em", color: "#f8fafc" }}>
                            <tbody>
                              {dealerAnalysis.levels.supports.map((s: any, idx: number) => (
                                <tr key={idx}>
                                  <td style={{ color: "#34d399", padding: "2px 0" }}>{s.strike}</td>
                                  <td style={{ textAlign: "right", padding: "2px 0" }}>{s.formatted}</td>
                                </tr>
                              ))}
                              {dealerAnalysis.levels.supports.length === 0 && <tr><td colSpan={2} style={{ color: "#94a3b8", padding: "2px 0" }}>Ninguno</td></tr>}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    </div>

                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
        )}
        </>
      ) : (
        <>
          {/* Expirations Selector */}
          {displayExpirations.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', marginBottom: '1rem', background: 'rgba(0,0,0,0.2)', padding: '1rem', borderRadius: '8px' }}>
              <div style={{ width: '100%', marginBottom: '0.5rem', color: '#94a3b8', fontSize: '0.75rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                Select Expiration Date ({displayExpirations.length} Available)
              </div>
              {displayExpirations.map((exp) => (
                <button
                  key={exp}
                  onClick={() => handleExpirationChange(exp)}
                  style={{ 
                    background: selectedExp === exp ? 'rgba(56, 189, 248, 0.15)' : 'rgba(255,255,255,0.03)',
                    border: selectedExp === exp ? '1px solid #38bdf8' : '1px solid rgba(255,255,255,0.1)',
                    color: selectedExp === exp ? '#fff' : '#94a3b8',
                    padding: '0.3rem 0.6rem', borderRadius: '4px', fontSize: '0.75rem', cursor: 'pointer',
                    fontWeight: selectedExp === exp ? 600 : 400
                  }}
                >
                  {exp}
                </button>
              ))}
            </div>
          )}

      {/* Main Content (Table) */}
      <main className={`${styles.tableContainer} glass-panel animate-fade-in`}>
        <div className={styles.tableHeaderRow}>
          <h2 className={styles.tableTitle}>
            Option Chain: {symbol} @ {selectedExp || "..."}
          </h2>
          
          <div className={styles.filterControls}>
            <button 
              onClick={() => setFilterType("ALL")}
              className={`${styles.filterBtn} ${filterType === "ALL" ? styles.activeFilter : ""}`}
            >
              ALL
            </button>
            <button 
              onClick={() => setFilterType("CALL")}
              className={`${styles.filterBtn} ${filterType === "CALL" ? styles.activeFilter : ""}`}
            >
              CALLS
            </button>
            <button 
              onClick={() => setFilterType("PUT")}
              className={`${styles.filterBtn} ${filterType === "PUT" ? styles.activeFilter : ""}`}
            >
              PUTS
            </button>
          </div>
        </div>



        {loading && !data ? (
          <div className={styles.loadingWrapper}>
            <RefreshCw size={36} className={`${styles.spin} ${styles.statIcon}`} />
            <span className={styles.loadingText}>Loading options chain & calculating Gamma Exposure (GEX)...</span>
          </div>
        ) : error ? (
          <div className={styles.errorBox}>
            <AlertTriangle size={24} style={{ flexShrink: 0 }} />
            <div>
              <h4 className={styles.errorTitle}>Integration Error</h4>
              <p className={styles.errorDesc}>{error}</p>
            </div>
          </div>
        ) : rows.length === 0 ? (
          <div className={styles.emptyState}>
            <p>No option contracts found for the selected parameters.</p>
          </div>
        ) : (
          <div className={styles.tableWrapper}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Strike</th>
                  <th>Type</th>
                  <th>Gamma</th>
                  <th>GEX (Exposure)</th>
                  <th onClick={() => requestSort('vanna')} style={{ cursor: 'pointer' }}>Vanna {sortConfig?.key === 'vanna' ? (sortConfig.direction === 'asc' ? '↑' : '↓') : ''}</th>
                  <th onClick={() => requestSort('vex')} style={{ cursor: 'pointer' }}>VEX {sortConfig?.key === 'vex' ? (sortConfig.direction === 'asc' ? '↑' : '↓') : ''}</th>
                  {exposureMode === 'DEALER' && <th style={{ textAlign: "center" }}>Dealer Bias</th>}
                  <th>Implied Vol (IV)</th>
                  <th>Open Interest (OI)</th>
                  <th>Volume (VOL)</th>
                  <th style={{ textAlign: "right" }}>Contribution</th>
                  <th style={{ textAlign: "center" }}>Distance</th>
                  <th>GEX Rank</th>
                  <th style={{ textAlign: "center" }}>VEX Rank</th>
                  <th>OI Rank</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row, index) => {
                  const isKingNode = data?.kingNode === row.strike;
                  let dealerBiasVal = 1;
                  let biasDisplay = "";
                  let biasTooltip = "";
                  let isTestMode = false;
                  let dealerSource = "";

                  const occId = (() => {
                    const dateStr = selectedExp.replace(/-/g, "").slice(2);
                    const typeStr = row.type === "CALL" ? "C" : "P";
                    const strikeStr = Math.round(row.strike * 1000).toString().padStart(8, "0");
                    return `${symbol}${dateStr}${typeStr}${strikeStr}`;
                  })();

                  if (dealerCache && dealerCache[occId]) {
                    isTestMode = true;
                    dealerSource = dealerCache[occId].source;
                    dealerBiasVal = dealerCache[occId].bias;
                    biasDisplay = `${(dealerBiasVal * 100).toFixed(1)}%`;
                    biasTooltip = `${symbol} ${row.strike}${row.type === 'CALL' ? 'C' : 'P'} ${selectedExp.slice(5)}\nContract Reconstruction\n\n${dealerCache[occId].buy} BUY\n${dealerCache[occId].sell} SELL\nOI ${dealerCache[occId].lastOI}`;
                  } else if (symbol === "SPY" && row.strike === 745 && selectedExp.includes("2026-06-08")) {
                    dealerSource = "HARDCODE";
                    if (row.type === "CALL") {
                      isTestMode = true;
                      dealerBiasVal = (117 - 146) / 263;
                      biasDisplay = "-11.0%";
                      biasTooltip = "SPY 745C 06/08\nContract Reconstruction\n\n117 BUY\n146 SELL\nOI 263";
                    } else if (row.type === "PUT") {
                      isTestMode = true;
                      dealerBiasVal = (1286 - 4257) / 5543;
                      biasDisplay = "-53.6%";
                      biasTooltip = "SPY 745P 06/08\nContract Reconstruction\n\n1286 BUY\n4257 SELL\nOI 5543";
                    }
                  }

                  const displayGex = exposureMode === 'DEALER' ? row.gex * dealerBiasVal : row.gex;
                  const displayVex = exposureMode === 'DEALER' ? row.vex * dealerBiasVal : row.vex;

                  return (
                    <tr 
                      key={`${row.strike}-${row.type}-${index}`}
                      style={{ 
                        background: isKingNode ? "rgba(192, 132, 252, 0.05)" : undefined,
                        borderLeft: isKingNode ? "4px solid #c084fc" : undefined
                      }}
                    >
                      <td className={styles.strikeCol}>
                        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                          {row.strike.toFixed(2)}
                          {isKingNode && (
                            <span 
                              style={{ 
                                fontSize: "0.6rem", 
                                background: "#c084fc", 
                                color: "#000", 
                                padding: "0.1rem 0.3rem", 
                                borderRadius: "3px", 
                                fontWeight: 800 
                              }}
                              title="King Node - Strike with highest absolute GEX"
                            >
                              KING
                            </span>
                          )}
                        </div>
                      </td>
                      <td>
                        <span className={`${styles.pill} ${row.type === "CALL" ? styles.callPill : styles.putPill}`}>
                          {row.type}
                        </span>
                      </td>
                      <td className={styles.mono} style={{ color: "#cbd5e1" }}>
                        {row.gamma.toFixed(5)}
                      </td>
                      <td style={getGexCellStyle(displayGex, row.type)}>
                        {formatGex(displayGex)}
                      </td>
                      <td className={styles.mono} style={{ color: "#cbd5e1" }}>
                        {Math.abs(row.vanna) >= 0.01 ? row.vanna.toFixed(4) : row.vanna.toFixed(6)}
                      </td>
                      <td style={{ 
                        color: displayVex > 0 ? "#00e676" : displayVex < 0 ? "#ff2a6d" : "#cbd5e1",
                        fontWeight: 700 
                      }} className={styles.mono}>
                        {formatGex(displayVex)}
                      </td>
                      {exposureMode === 'DEALER' && (
                        <td style={{ textAlign: 'center' }}>
                          {isTestMode ? (
                            <div 
                              title={biasTooltip}
                              style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.2rem' }}
                            >
                              <span style={{ color: dealerBiasVal > 0 ? '#34d399' : dealerBiasVal < 0 ? '#f472b6' : '#94a3b8', fontWeight: 'bold' }}>{biasDisplay}</span>
                            </div>
                          ) : (
                            <span style={{ color: '#94a3b8' }}>100%</span>
                          )}
                        </td>
                      )}

                      <td className={styles.mono} style={{ color: "#a1a1aa" }}>
                        {(row.iv * 100).toFixed(2)}%
                      </td>
                      <td className={styles.mono} style={{ color: "#cbd5e1" }}>
                        {row.oi.toLocaleString()}
                      </td>
                      <td className={styles.mono} style={{ color: "#cbd5e1" }}>
                        {row.vol.toLocaleString()}
                      </td>
                      <td style={{ textAlign: "right", color: "#cbd5e1" }} className={styles.mono}>
                        {(row.contribution * 100).toFixed(2)}%
                      </td>
                      <td style={{ 
                        textAlign: "center", 
                        color: row.distance < 5 ? "#00e676" : row.distance < 15 ? "#fbbf24" : "#94a3b8" 
                      }} className={styles.mono}>
                        {row.distance.toFixed(2)}
                      </td>
                      <td>
                        {row.gammaRank !== null && row.gammaRank !== undefined ? (
                          <span style={{ 
                            background: row.gammaRank === 1 ? "rgba(239, 68, 68, 0.2)" : row.gammaRank === 2 ? "rgba(249, 115, 22, 0.2)" : row.gammaRank === 3 ? "rgba(251, 191, 36, 0.2)" : "rgba(148, 163, 184, 0.2)", 
                            color: row.gammaRank === 1 ? "#ef4444" : row.gammaRank === 2 ? "#f97316" : row.gammaRank === 3 ? "#fbbf24" : "#cbd5e1", 
                            padding: "0.2rem 0.4rem", 
                            borderRadius: "4px", 
                            fontSize: "0.8rem", 
                            fontWeight: "bold" 
                          }}>
                            #{row.gammaRank}
                          </span>
                        ) : "-"}
                      </td>
                      <td style={{ textAlign: "center" }}>
                        {row.vexRank !== null && row.vexRank !== undefined ? (
                          <span style={{ 
                            background: row.vexRank === 1 ? "rgba(239, 68, 68, 0.2)" : row.vexRank === 2 ? "rgba(249, 115, 22, 0.2)" : row.vexRank === 3 ? "rgba(251, 191, 36, 0.2)" : "rgba(148, 163, 184, 0.2)", 
                            color: row.vexRank === 1 ? "#ef4444" : row.vexRank === 2 ? "#f97316" : row.vexRank === 3 ? "#fbbf24" : "#cbd5e1", 
                            padding: "0.2rem 0.4rem", 
                            borderRadius: "4px", 
                            fontSize: "0.8rem", 
                            fontWeight: "bold" 
                          }}>
                            #{row.vexRank}
                          </span>
                        ) : "-"}
                      </td>
                      <td>
                        {row.oiRank !== null && row.oiRank !== undefined ? (
                          <span style={{ 
                            background: row.oiRank === 1 ? "rgba(239, 68, 68, 0.2)" : row.oiRank === 2 ? "rgba(249, 115, 22, 0.2)" : row.oiRank === 3 ? "rgba(251, 191, 36, 0.2)" : "rgba(148, 163, 184, 0.2)", 
                            color: row.oiRank === 1 ? "#ef4444" : row.oiRank === 2 ? "#f97316" : row.oiRank === 3 ? "#fbbf24" : "#cbd5e1", 
                            padding: "0.2rem 0.4rem", 
                            borderRadius: "4px", 
                            fontSize: "0.8rem", 
                            fontWeight: "bold" 
                          }}>
                            #{row.oiRank}
                          </span>
                        ) : "-"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </main>
      </>
      )}


    </div>
  );
}
