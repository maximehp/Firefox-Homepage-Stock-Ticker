// skip 1st line
Services.console.logStringMessage("CONFIG JS LOADED");
lockPref("xpinstall.signatures.required", false);
lockPref("extensions.install_origins.enabled", false);

try {
  const utilsDir = Services.dirsvc.get("UChrm", Ci.nsIFile);
  utilsDir.append("utils");

  const manifest = utilsDir.clone();
  manifest.append("chrome.manifest");
  Components.manager.QueryInterface(Ci.nsIComponentRegistrar).autoRegister(manifest);

  const bootstrap = utilsDir.clone();
  bootstrap.append("BootstrapLoader.js");
  if (bootstrap.exists()) {
    Services.scriptloader.loadSubScript(Services.io.newFileURI(bootstrap).spec);
  }

  Services.console.logStringMessage("UCJS manifest registration OK");
} catch (ex) {
  Cu.reportError(ex);
  Services.console.logStringMessage("UCJS manifest registration FAILED: " + ex);
}

try {
  Services.scriptloader.loadSubScript("chrome://userchromejs/content/userChrome.jsm");
  Services.console.logStringMessage("UCJS userChrome.jsm loadSubScript OK");
} catch (ex) {
  Cu.reportError(ex);
  Services.console.logStringMessage("UCJS userChrome.jsm loadSubScript FAILED: " + ex);
}
