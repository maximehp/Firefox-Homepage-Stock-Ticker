// ==UserScript==
// @name           bottomStocks.uc.js
// @description    Adds a stock bar to the real about:newtab / about:home page
// @include        main
// ==/UserScript==

(() => {
  const ACTOR_NAME = "UCBottomStocks";
  const TARGETS = new Set(["about:newtab", "about:home"]);

  if (window.__ucBottomStocksSetup) {
    return;
  }
  window.__ucBottomStocksSetup = true;

  function log(message) {
    Services.console.logStringMessage("[bottomStocks] " + message);
  }

  function isTargetBrowser(browser) {
    const spec = browser?.currentURI?.spec;
    return TARGETS.has(spec);
  }

  function requestRender(browser, reason) {
    if (!isTargetBrowser(browser)) {
      return;
    }

    try {
      const actor = browser.browsingContext?.currentWindowGlobal?.getActor(ACTOR_NAME);
      actor?.sendAsyncMessage("Render", { reason });
      log(`requested render reason=${reason} spec=${browser.currentURI.spec}`);
    } catch (error) {
      Cu.reportError(error);
      log(`request render failed reason=${reason} error=${error}`);
    }
  }

  function scheduleRender(browser, reason, delay) {
    window.setTimeout(() => {
      requestRender(browser, reason);
    }, delay);
  }

  try {
    ChromeUtils.registerWindowActor(ACTOR_NAME, {
      parent: {
        esModuleURI: "chrome://userchromejs/content/BottomStocksParent.sys.mjs",
      },
      child: {
        esModuleURI: "chrome://userchromejs/content/BottomStocksChild.sys.mjs",
        events: {
          DOMContentLoaded: {},
          pageshow: { createActor: false },
        },
      },
      matches: ["about:newtab", "about:home"],
      messageManagerGroups: ["browsers"],
      allFrames: false,
    });
    log("window actor registered");
  } catch (error) {
    if (String(error).includes("already registered")) {
      log("window actor already registered");
    } else {
      Cu.reportError(error);
      log("window actor registration failed: " + error);
    }
  }

  const progressListener = {
    onLocationChange(browser, webProgress, request, location) {
      if (!TARGETS.has(location?.spec)) {
        return;
      }

      scheduleRender(browser, "location", 200);
      scheduleRender(browser, "location-late", 1200);
    },
  };

  gBrowser.addTabsProgressListener(progressListener);

  gBrowser.tabContainer.addEventListener("TabSelect", event => {
    const browser = gBrowser.getBrowserForTab(event.target);
    scheduleRender(browser, "tabselect", 100);
  });

  for (const browser of gBrowser.browsers) {
    scheduleRender(browser, "startup", 300);
    scheduleRender(browser, "startup-late", 1500);
  }

  window.addEventListener("unload", () => {
    try {
      gBrowser.removeTabsProgressListener(progressListener);
    } catch (error) {}
  }, { once: true });
})();
