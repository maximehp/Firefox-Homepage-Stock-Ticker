const DEFAULT_SYMBOLS = ["AAPL", "MSFT", "NVDA", "AMZN", "SPY"];
const PREF_SYMBOLS = "userChromeJS.bottomStocks.symbols";

const CACHE_MS = 5 * 60 * 1000;
const MAX_SYMBOLS = 20;

const { classes: Cc, interfaces: Ci } = Components;

let cache = {
  key: "",
  quotes: [],
  lastUpdated: 0,
  inFlight: null,
  token: 0,
};

function getPrefs() {
  return Cc["@mozilla.org/preferences-service;1"].getService(Ci.nsIPrefBranch);
}

function normalizeSymbol(symbol) {
  return String(symbol || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9.-]/g, "");
}

function getStoredSymbols() {
  try {
    const raw = getPrefs().getStringPref(PREF_SYMBOLS, "");
    if (!raw) {
      return DEFAULT_SYMBOLS.slice();
    }

    const parsed = JSON.parse(raw);

    if (!Array.isArray(parsed)) {
      throw new Error("invalid symbols pref");
    }

    const symbols = parsed
      .map(normalizeSymbol)
      .filter(Boolean)
      .slice(0, MAX_SYMBOLS);

    return symbols;
  } catch (error) {
    return DEFAULT_SYMBOLS.slice();
  }
}

function setStoredSymbols(symbols) {
  const normalized = symbols
    .map(normalizeSymbol)
    .filter(Boolean)
    .slice(0, MAX_SYMBOLS);
  const nextSymbols = normalized.length ? normalized : [];

  getPrefs().setStringPref(PREF_SYMBOLS, JSON.stringify(nextSymbols));
  cache.token += 1;
  cache.key = "";
  cache.lastUpdated = 0;
  cache.quotes = [];
  cache.inFlight = null;
  return nextSymbols;
}

function getEntries() {
  return getStoredSymbols().map(symbol => ({
    label: symbol,
    stooq: symbol.toLowerCase() + ".us",
  }));
}

function formatCsvNumber(value) {
  if (value === "N/D" || value == null || value === "") {
    return null;
  }

  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

async function fetchQuote(entry) {
  const url = "https://stooq.com/q/l/?s=" + entry.stooq + "&i=d";

  try {
    const response = await fetch(url, { cache: "no-store" });
    const text = (await response.text()).trim();
    const [symbol, date, time, open, high, low, close, volume] = text.split(",");
    const openNumber = formatCsvNumber(open);
    const closeNumber = formatCsvNumber(close);

    if (!symbol || closeNumber == null) {
      return { symbol: entry.label, href: "https://stooq.com/q/?s=" + entry.stooq, error: "no-data" };
    }

    const changePercent = openNumber ? ((closeNumber - openNumber) / openNumber) * 100 : 0;

    return {
      symbol: entry.label,
      href: "https://stooq.com/q/?s=" + entry.stooq,
      price: closeNumber,
      changePercent,
      sessionDate: date,
      sessionTime: time,
      volume: formatCsvNumber(volume),
    };
  } catch (error) {
    return { symbol: entry.label, href: "https://stooq.com/q/?s=" + entry.stooq, error: "network" };
  }
}

async function getQuotes() {
  const entries = getEntries();
  const key = entries.map(entry => entry.label).join(",");

  if (cache.inFlight) {
    return cache.inFlight;
  }

  if (cache.key === key && cache.lastUpdated && Date.now() - cache.lastUpdated < CACHE_MS) {
    return cache;
  }

  cache.inFlight = (async () => {
    const token = cache.token;
    cache.key = key;
    const quotes = await Promise.all(entries.map(fetchQuote));

    if (token !== cache.token || cache.key !== key) {
      cache.inFlight = null;
      return cache;
    }

    cache.quotes = quotes;
    cache.lastUpdated = Date.now();
    cache.inFlight = null;
    return cache;
  })().catch(error => {
    cache.inFlight = null;
    throw error;
  });

  return cache.inFlight;
}

function removeSymbol(index) {
  const symbols = getStoredSymbols();

  if (index < 0 || index >= symbols.length) {
    return symbols;
  }

  symbols.splice(index, 1);
  return setStoredSymbols(symbols);
}

function addSymbol(symbol) {
  const normalized = normalizeSymbol(symbol);

  if (!normalized) {
    return getStoredSymbols();
  }

  const symbols = getStoredSymbols().filter(entry => entry !== normalized);
  symbols.push(normalized);
  return setStoredSymbols(symbols);
}

function moveSymbol(fromIndex, toIndex) {
  const symbols = getStoredSymbols();

  if (
    fromIndex < 0 ||
    fromIndex >= symbols.length ||
    toIndex < 0 ||
    toIndex >= symbols.length ||
    fromIndex === toIndex
  ) {
    return symbols;
  }

  const [moved] = symbols.splice(fromIndex, 1);
  symbols.splice(toIndex, 0, moved);
  return setStoredSymbols(symbols);
}

export class UCBottomStocksParent extends JSWindowActorParent {
  receiveMessage(message) {
    switch (message.name) {
      case "RequestQuotes":
        return getQuotes();
      case "RemoveSymbol":
        removeSymbol(message.data?.index);
        return getQuotes();
      case "AddSymbol":
        addSymbol(message.data?.symbol);
        return getQuotes();
      case "MoveSymbol":
        moveSymbol(message.data?.fromIndex, message.data?.toIndex);
        return getQuotes();
    }

    return null;
  }
}
