const DEFAULT_SYMBOLS = ["AAPL", "MSFT", "NVDA", "AMZN", "SPY"];
const PREF_SYMBOLS = "userChromeJS.bottomStocks.symbols";

const CACHE_MS = 5 * 60 * 1000;
const MAX_SYMBOLS = 20;

const { classes: Cc, interfaces: Ci } = Components;

let cache = {
  key: "",
  quotes: [],
  lastUpdated: 0,
  requestId: 0,
  inFlight: null,
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
  cache.requestId += 1;
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

function formatStooqDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}${month}${day}`;
}

function getYahooChartUrl(symbol) {
  return (
    "https://query1.finance.yahoo.com/v8/finance/chart/" +
    encodeURIComponent(symbol) +
    "?interval=5m&range=1d"
  );
}

function getYahooQuoteHref(symbol) {
  return "https://finance.yahoo.com/quote/" + encodeURIComponent(symbol);
}

function formatSessionDateParts(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  const seconds = String(date.getSeconds()).padStart(2, "0");

  return {
    date: `${year}-${month}-${day}`,
    time: `${hours}:${minutes}:${seconds}`,
  };
}

async function fetchYahooQuote(entry) {
  const response = await fetch(getYahooChartUrl(entry.label), { cache: "no-store" });
  if (!response.ok) {
    throw new Error("yahoo-http-" + response.status);
  }

  const payload = await response.json();
  const result = payload?.chart?.result?.[0];
  const meta = result?.meta;
  const price = formatCsvNumber(meta?.regularMarketPrice);
  const previousClose = formatCsvNumber(meta?.previousClose);

  if (price == null || previousClose == null) {
    throw new Error("yahoo-no-data");
  }

  const session = meta?.regularMarketTime
    ? formatSessionDateParts(new Date(meta.regularMarketTime * 1000))
    : { date: null, time: null };

  return {
    symbol: entry.label,
    href: getYahooQuoteHref(entry.label),
    price,
    changePercent: previousClose ? ((price - previousClose) / previousClose) * 100 : null,
    sessionDate: session.date,
    sessionTime: session.time,
    volume: formatCsvNumber(meta?.regularMarketVolume),
  };
}

async function fetchStooqQuote(entry) {
  const endDate = new Date();
  const startDate = new Date(endDate);
  startDate.setDate(startDate.getDate() - 14);
  const url =
    "https://stooq.com/q/d/l/?s=" +
    entry.stooq +
    "&d1=" +
    formatStooqDate(startDate) +
    "&d2=" +
    formatStooqDate(endDate) +
    "&i=d";

  try {
    const response = await fetch(url, { cache: "no-store" });
    const text = (await response.text()).trim();
    const rows = text
      .split(/\r?\n/)
      .slice(1)
      .map(line => line.trim())
      .filter(Boolean);

    if (!rows.length) {
      return { symbol: entry.label, href: getYahooQuoteHref(entry.label), error: "no-data" };
    }

    const latestRow = rows.at(-1).split(",");
    const previousRow = rows.length > 1 ? rows.at(-2).split(",") : null;
    const [date, _open, _high, _low, close, volume] = latestRow;
    const closeNumber = formatCsvNumber(close);
    const previousCloseNumber = previousRow ? formatCsvNumber(previousRow[4]) : null;

    if (!date || closeNumber == null) {
      return { symbol: entry.label, href: getYahooQuoteHref(entry.label), error: "no-data" };
    }

    const changePercent = previousCloseNumber
      ? ((closeNumber - previousCloseNumber) / previousCloseNumber) * 100
      : null;

    return {
      symbol: entry.label,
      href: getYahooQuoteHref(entry.label),
      price: closeNumber,
      changePercent,
      sessionDate: date,
      sessionTime: null,
      volume: formatCsvNumber(volume),
    };
  } catch (error) {
    return { symbol: entry.label, href: getYahooQuoteHref(entry.label), error: "network" };
  }
}

async function fetchQuote(entry) {
  try {
    return await fetchYahooQuote(entry);
  } catch (error) {
    return fetchStooqQuote(entry);
  }
}

function createPayload(key = cache.key, quotes = cache.quotes, lastUpdated = cache.lastUpdated) {
  return {
    key,
    quotes: quotes.slice(),
    lastUpdated,
  };
}

async function getQuotes(options = {}) {
  const force = !!options.force;
  const entries = getEntries();
  const key = entries.map(entry => entry.label).join(",");

  if (!force && cache.inFlight?.key === key) {
    return cache.inFlight.promise;
  }

  if (!force && cache.key === key && cache.lastUpdated && Date.now() - cache.lastUpdated < CACHE_MS) {
    return createPayload();
  }

  const requestId = ++cache.requestId;
  const promise = (async () => {
    const quotes = await Promise.all(entries.map(fetchQuote));

    if (requestId !== cache.requestId) {
      return getQuotes();
    }

    cache.key = key;
    cache.quotes = quotes;
    cache.lastUpdated = Date.now();
    return createPayload(key, quotes, cache.lastUpdated);
  })();

  cache.inFlight = {
    key,
    requestId,
    promise,
  };

  try {
    return await promise;
  } finally {
    if (cache.inFlight?.requestId === requestId) {
      cache.inFlight = null;
    }
  }
}

function refreshQuotes() {
  cache.lastUpdated = 0;
  return getQuotes({ force: true });
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
      case "RefreshQuotes":
        return refreshQuotes();
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
