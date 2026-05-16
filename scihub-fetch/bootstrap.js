"use strict";

function log(msg) {
  msg = "scihub-fetch bootstrap: " + msg;
  if (Zotero && Zotero.debug) {
    Zotero.debug(msg);
  } else {
    dump(msg + "\n");
  }
}

var chromeHandle;

function install() {
  log("install");
}

function startup(data, reason) {
  return new Promise(function(resolve, reject) {
    try {
      var rootURI = data.rootURI;
      if (!rootURI && data.resourceURI) {
        rootURI = data.resourceURI.spec;
      }

      log("startup (" + reason + ")");

      var aomStartup = Cc["@mozilla.org/addons/addon-manager-startup;1"].getService(Ci.amIAddonManagerStartup);
      var manifestURI = Services.io.newURI(rootURI + "manifest.json");
      chromeHandle = aomStartup.registerChrome(manifestURI, [
        ["content", "scihub-fetch", "content/"],
        ["locale", "scihub-fetch", "en-US", "locale/en-US/"]
      ]);

      if (Zotero.SciHubFetch) {
        reject(new Error("Sci-Hub Fetch is already started"));
        return;
      }

      Services.scriptloader.loadSubScriptWithOptions(rootURI + "content/scihub.js", {
        charset: "utf-8",
        target: {
          Zotero: Zotero,
          rootURI: rootURI,
          setTimeout: setTimeout,
          clearTimeout: clearTimeout,
          setInterval: setInterval,
          clearInterval: clearInterval
        }
      });

      Zotero.SciHubFetch.startup().then(function() {
        log("startup done");
        resolve();
      }).catch(function(err) {
        log("startup async error: " + err);
        reject(err);
      });
    } catch (err) {
      Services.prompt.alert(null, "Sci-Hub Fetch", "startup failed: " + err + "\n" + (err.stack || ""));
      log(err + "\n" + (err.stack || ""));
      reject(err);
    }
  });
}

function onMainWindowLoad(winData) {
  log("onMainWindowLoad");
  if (Zotero.SciHubFetch) {
    Zotero.SciHubFetch.onMainWindowLoad(winData);
  }
}

function onMainWindowUnload(winData) {
  log("onMainWindowUnload");
  if (Zotero.SciHubFetch) {
    Zotero.SciHubFetch.onMainWindowUnload(winData);
  }
}

function shutdown(data, reason) {
  return new Promise(function(resolve) {
    try {
      log("shutdown");
      if (chromeHandle) {
        chromeHandle.destruct();
        chromeHandle = null;
      }
      if (Zotero.SciHubFetch) {
        Zotero.SciHubFetch.shutdown().then(function() {
          delete Zotero.SciHubFetch;
          log("shutdown done");
          resolve();
        }).catch(function(err) {
          log("shutdown error: " + err);
          resolve();
        });
      } else {
        log("shutdown done");
        resolve();
      }
    } catch (err) {
      log("shutdown error: " + err);
      resolve();
    }
  });
}

function uninstall() {
  log("uninstall");
}
