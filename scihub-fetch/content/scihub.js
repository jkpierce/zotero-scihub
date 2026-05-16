"use strict";

// ── Configuration ──────────────────────────────────────────────────────────
var SCIHUB_DOMAINS = [
  "https://sci-hub.ru/",
  "https://sci-hub.se/",
  "https://sci-hub.st/",
  "https://sci-hub.ee/"
];
var DEFAULT_SCIHUB_URL = SCIHUB_DOMAINS[0];

// ── DOI Extraction ─────────────────────────────────────────────────────────

function getDoi(item) {
  var doiField = item.getField("DOI");
  if (doiField && typeof doiField === "string" && doiField.trim().length > 0) {
    return doiField.trim();
  }

  var extra = item.getField("extra");
  if (extra && typeof extra === "string") {
    var match = extra.match(/^DOI:\s*(.+)$/m);
    if (match) return match[1].trim();
  }

  var url = item.getField("url");
  if (url && typeof url === "string") {
    var match = url.match(/\bdoi\.org\b/i);
    if (match) {
      try {
        var urlObj = new URL(url);
        return decodeURIComponent(urlObj.pathname).replace(/^\//, "");
      } catch (e) {}
    }
  }

  return null;
}

function generateScihubUrl(doi, baseUrl) {
  if (!baseUrl) baseUrl = DEFAULT_SCIHUB_URL;
  return new URL(doi, baseUrl);
}

// ── File / Attachment Utilities ────────────────────────────────────────────

function itemHasFiles(item) {
  return new Promise(function(resolve) {
    var attachmentIds = item.getAttachments();
    if (!attachmentIds || attachmentIds.length === 0) {
      resolve(false);
      return;
    }

    var checkNext = function(i) {
      if (i >= attachmentIds.length) {
        resolve(false);
        return;
      }
      Zotero.Items.getAsync(attachmentIds[i]).then(function(attachment) {
        if (!attachment || !attachment.isAttachment()) {
          checkNext(i + 1);
          return;
        }
        var linkMode = attachment.attachmentLinkMode;
        if (linkMode === 0 || linkMode === 1) {
          resolve(true);
        } else {
          checkNext(i + 1);
        }
      }).catch(function() {
        checkNext(i + 1);
      });
    };
    checkNext(0);
  });
}

function urlToHttps(url) {
  var safeUrl = new URL(url.replace(/^\/\//, "https://"));
  safeUrl.protocol = "https";
  return safeUrl;
}

function attachRemotePDFToItem(pdfUrl, item) {
  return new Promise(function(resolve, reject) {
    var filename = pdfUrl.pathname.split("/").pop() || "article.pdf";
    if (!filename.toLowerCase().endsWith(".pdf")) filename += ".pdf";

    var importOptions = {
      libraryID: item.libraryID,
      url: pdfUrl.href,
      parentItemID: item.id,
      title: item.getField("title"),
      fileBaseName: filename,
      contentType: "application/pdf",
      referrer: "",
      cookieSandbox: null
    };
    Zotero.debug("scihub: importing PDF from " + pdfUrl.href + " for item " + item.id);
    Zotero.Attachments.importFromURL(importOptions).then(function(result) {
      Zotero.debug("scihub: import result: " + JSON.stringify(result));
      resolve(result);
    }).catch(function(err) {
      reject(err);
    });
  });
}

function showPopup(title, body, isError, timeout) {
  if (isError === undefined) isError = false;
  if (timeout === undefined) timeout = 5;
  var pw = new Zotero.ProgressWindow();
  if (isError) {
    pw.changeHeadline("Error", "chrome://zotero/skin/cross.png", "Sci-Hub: " + title);
  } else {
    pw.changeHeadline("Sci-Hub: " + title);
  }
  pw.addDescription(body);
  pw.show();
  pw.startCloseTimer(timeout * 1000);
}

// ── PDF URL Extraction ─────────────────────────────────────────────────────

function fetchPdfUrl(scihubUrl) {
  return new Promise(function(resolve) {
    Zotero.debug("scihub: fetching " + scihubUrl.href);

    Zotero.HTTP.request("GET", scihubUrl.href, {
      responseType: "document",
      headers: {
        "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
      }
    }).then(function(xhr) {
      var pdfUrl = null;
      if (xhr.responseXML) {
        var pdfEl = xhr.responseXML.querySelector("#pdf");
        if (pdfEl) {
          pdfUrl = pdfEl.getAttribute("src");
          Zotero.debug("scihub: found #pdf iframe src: " + pdfUrl);
        }
      }

      if (pdfUrl) {
        if (!pdfUrl.startsWith("http") && !pdfUrl.startsWith("//")) {
          pdfUrl = DEFAULT_SCIHUB_URL + pdfUrl;
        }
        resolve({ pdfUrl: pdfUrl });
        return;
      }

      if (xhr.responseXML) {
        var body = xhr.responseXML.querySelector("body");
        if (body) {
          var html = body.innerHTML || "";
          if (/Please try to search again using DOI|\u0441\u0442\u0430\u0442\u044c\u044f \u043d\u0435 \u043d\u0430\u0439\u0434\u0435\u043d\u0430 \u0432 \u0431\u0430\u0437\u0435/i.test(html)) {
            Zotero.debug("scihub: PDF not available at " + scihubUrl.href);
            resolve(null);
            return;
          }
        }
      }

      Zotero.debug("scihub: no #pdf iframe found, trying hidden browser");
      fetchPdfUrlViaBrowser(scihubUrl).then(function(result) {
        resolve(result);
      }).catch(function() {
        resolve(null);
      });
    }).catch(function(e) {
      Zotero.debug("scihub: HTTP error: " + e.message);
      fetchPdfUrlViaBrowser(scihubUrl).then(function(result) {
        resolve(result);
      }).catch(function() {
        resolve(null);
      });
    });
  });
}

function fetchPdfUrlViaBrowser(scihubUrl) {
  return new Promise(function(resolve) {
    var windows = Zotero.getMainWindows();
    if (!windows || windows.length === 0) {
      resolve(null);
      return;
    }

    var win = windows[0];
    var doc = win.document;
    var browser = doc.createXULElement("browser");
    browser.setAttribute("type", "content");
    browser.setAttribute("disableglobalhistory", "true");
    browser.style.display = "none";
    browser.style.width = "1px";
    browser.style.height = "1px";
    doc.documentElement.appendChild(browser);

    var timedOut = false;
    var timeoutId = win.setTimeout(function() {
      timedOut = true;
      try { browser.remove(); } catch (e) {}
      resolve(null);
    }, 45000);

    browser.addEventListener("load", function onLoad() {
      browser.removeEventListener("load", onLoad, true);
      if (timedOut) return;
      win.clearTimeout(timeoutId);

      win.setTimeout(function() {
        try {
          var cd = browser.contentDocument;
          if (cd) {
            var iframe = cd.getElementById("pdf");
            if (iframe) {
              var src = iframe.getAttribute("src");
              if (src) {
                try { browser.remove(); } catch (e) {}
                resolve({ pdfUrl: resolvePdfUrl(src, scihubUrl) });
                return;
              }
            }
            var html = cd.documentElement ? cd.documentElement.innerHTML : "";
            var url = extractPdfUrlFromHtml(html, scihubUrl);
            if (url) {
              try { browser.remove(); } catch (e) {}
              resolve({ pdfUrl: url });
              return;
            }
          }
        } catch (e) {}
        try { browser.remove(); } catch (e) {}
        resolve(null);
      }, 3000);
    }, true);

    try {
      browser.loadURI(scihubUrl.href, {
        triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal()
      });
    } catch (e) {
      try { browser.loadURI(scihubUrl.href); } catch (e2) { resolve(null); }
    }
  });
}

function extractPdfUrlFromHtml(html, scihubUrl) {
  if (!html) return null;
  var patterns = [
    /<iframe[^>]*\bid=["']pdf["'][^>]*\bsrc=["']([^"']+)["']/i,
    /<embed[^>]*\bsrc=["']([^"']+\.pdf[^"']*)["']/i,
    /<a[^>]*\bhref=["']([^"']*\/downloads\/[^"']+)["']/i,
    /src=["'](https?:\/\/[^"']*sci-hub[^"']*\/downloads\/[^"']+)["']/i,
    /<iframe[^>]*\bid=["']pdf["'][^>]*\bsrc=["'](\/\/[^"']+)["']/i,
    /location\.href\s*=\s*["']([^"']+\.pdf[^"']*)["']/i,
    /(https?:\/\/[^"'\s<>]+\.pdf[^"'\s<>]*)/i,
    /<object[^>]*\bdata=["']([^"']+\.pdf[^"']*)["']/i
  ];

  for (var i = 0; i < patterns.length; i++) {
    var match = html.match(patterns[i]);
    if (match) return resolvePdfUrl(match[1], scihubUrl);
  }
  return null;
}

function resolvePdfUrl(url, scihubUrl) {
  if (!url) return null;
  if (url.startsWith("//")) return "https:" + url;
  if (url.startsWith("http")) return url;
  return scihubUrl.origin + "/" + url.replace(/^\//, "");
}

// ── Core Download Logic ────────────────────────────────────────────────────

function updateItem(item) {
  return new Promise(function(resolve) {
    var doi = getDoi(item);
    if (!doi) { resolve(false); return; }

    itemHasFiles(item).then(function(hasFiles) {
      if (hasFiles) { resolve(true); return; }

      tryDomains(0);

      function tryDomains(d) {
        if (d >= SCIHUB_DOMAINS.length) { resolve(false); return; }
        var scihubUrl = new URL(doi, SCIHUB_DOMAINS[d]);

        fetchPdfUrl(scihubUrl).then(function(result) {
          if (result && result.pdfUrl) {
            Zotero.debug("scihub: attaching PDF from " + result.pdfUrl);
            var httpsUrl = urlToHttps(result.pdfUrl);
            attachRemotePDFToItem(httpsUrl, item).then(function() {
              resolve(true);
            }).catch(function() {
              tryDomains(d + 1);
            });
          } else {
            tryDomains(d + 1);
          }
        }).catch(function() {
          tryDomains(d + 1);
        });
      }
    });
  });
}

function updateItems(items) {
  return new Promise(function(resolve) {
    var successCount = 0;
    var failCount = 0;

    var pw = new Zotero.ProgressWindow({ closeOnClick: true });
    pw.changeHeadline("Sci-Hub: Downloading PDFs");
    pw.addDescription("Processing " + items.length + " items...");
    pw.show();

    var processNext = function(i) {
      if (i >= items.length) {
        pw.startCloseTimer(2000);
        showPopup("Done", "Downloaded: " + successCount + "\nFailed: " + failCount, false, 8);
        resolve();
        return;
      }

      var item = items[i];
      if (!item.isRegularItem()) {
        processNext(i + 1);
        return;
      }

      var title = item.getField("title") || "Untitled";
      var doi = getDoi(item);
      if (!doi) {
        Zotero.debug('scihub: no DOI for "' + title + '"');
        failCount++;
        processNext(i + 1);
        return;
      }

      pw.changeHeadline("Sci-Hub: [" + (i + 1) + "/" + items.length + "]");
      Zotero.debug('scihub: [' + (i + 1) + '/' + items.length + '] "' + title + '" (DOI: ' + doi + ')');

      updateItem(item).then(function(ok) {
        if (ok) { successCount++; } else { failCount++; }
        processNext(i + 1);
      }).catch(function() {
        failCount++;
        processNext(i + 1);
      });
    };
    processNext(0);
  });
}

// ── Entry Points ───────────────────────────────────────────────────────────

function downloadSelectedItems() {
  var pane = Zotero.getActiveZoteroPane();
  if (!pane) { showPopup("Error", "No active Zotero pane", true); return; }
  var items = pane.getSelectedItems();
  if (!items || items.length === 0) { showPopup("Info", "No items selected", true); return; }
  updateItems(items);
}

function downloadCollectionItems() {
  var pane = Zotero.getActiveZoteroPane();
  if (!pane) return;
  var collection = pane.getSelectedCollection(false);
  if (!collection) { showPopup("Info", "No collection selected", true); return; }
  var items = collection.getChildItems(false, false);
  updateItems(items);
}

function downloadAllItems() {
  var allItems = [];
  var libraries = Zotero.Libraries.getAll();
  var libIdx = 0;

  function nextLib() {
    if (libIdx >= libraries.length) {
      updateItems(allItems);
      return;
    }
    var libID = typeof libraries[libIdx] === "object" ? libraries[libIdx].libraryID : libraries[libIdx];
    libIdx++;
    Zotero.Items.getAll(libID).then(function(items) {
      allItems = allItems.concat(items);
      nextLib();
    }).catch(function(e) {
      Zotero.debug("scihub: error with library " + libID + ": " + e.message);
      nextLib();
    });
  }
  nextLib();
}

function downloadMissingPdfs() {
  var allItems = [];
  var libraries = Zotero.Libraries.getAll();
  var libIdx = 0;

  function collectNextLib() {
    if (libIdx >= libraries.length) {
      filterMissing(allItems);
      return;
    }
    var libID = typeof libraries[libIdx] === "object" ? libraries[libIdx].libraryID : libraries[libIdx];
    libIdx++;
    Zotero.Items.getAll(libID).then(function(items) {
      allItems = allItems.concat(items);
      collectNextLib();
    }).catch(function(e) {
      Zotero.debug("scihub: error with library " + libID + ": " + e.message);
      collectNextLib();
    });
  }

  function filterMissing(allItems) {
    var missing = [];
    var idx = 0;

    function checkItem() {
      if (idx >= allItems.length) {
        if (missing.length === 0) {
          showPopup("All Done!", "All items already have files attached.");
        } else {
          updateItems(missing);
        }
        return;
      }

      var item = allItems[idx];
      idx++;

      if (!item.isRegularItem()) { checkItem(); return; }
      var doi = getDoi(item);
      if (!doi) { checkItem(); return; }

      itemHasFiles(item).then(function(has) {
        if (!has) missing.push(item);
        checkItem();
      }).catch(function() {
        checkItem();
      });
    }
    checkItem();
  }

  collectNextLib();
}

// ── Deduplication ─────────────────────────────────────────────────────────

function removeDuplicateAttachments() {
  var allItems = [];
  var libraries = Zotero.Libraries.getAll();
  var libIdx = 0;

  function collectNextLib() {
    if (libIdx >= libraries.length) {
      findDups(allItems);
      return;
    }
    var libID = typeof libraries[libIdx] === "object" ? libraries[libIdx].libraryID : libraries[libIdx];
    libIdx++;
    Zotero.Items.getAll(libID).then(function(items) {
      allItems = allItems.concat(items);
      collectNextLib();
    }).catch(function() {
      collectNextLib();
    });
  }

  function findDups(allItems) {
    var removed = 0;
    var checked = 0;
    var toTrash = [];
    var idx = 0;

    function processItem() {
      if (idx >= allItems.length) {
        doTrash(toTrash, removed, checked);
        return;
      }

      var item = allItems[idx];
      idx++;
      if (!item.isRegularItem()) { processItem(); return; }

      var attachmentIds = item.getAttachments();
      if (!attachmentIds || attachmentIds.length < 2) { processItem(); return; }

      checked++;
      var fileAttachments = [];
      var attIdx = 0;

      function checkAttachment() {
        if (attIdx >= attachmentIds.length) {
          if (fileAttachments.length > 1) {
            fileAttachments.sort(function(a, b) { return a.dateAdded > b.dateAdded ? -1 : 1; });
            for (var j = 1; j < fileAttachments.length; j++) {
              toTrash.push(fileAttachments[j].id);
            }
          }
          processItem();
          return;
        }

        var id = attachmentIds[attIdx];
        attIdx++;
        Zotero.Items.getAsync(id).then(function(att) {
          if (att && att.isAttachment()) {
            var linkMode = att.attachmentLinkMode;
            if (linkMode === 0 || linkMode === 1 || linkMode === 2) {
              var filePath = att.getFilePath();
              if (filePath) {
                fileAttachments.push({
                  id: att.id,
                  dateAdded: att.getField("dateAdded"),
                  file: filePath,
                  linkMode: linkMode
                });
              }
            }
          }
          checkAttachment();
        }).catch(function() {
          checkAttachment();
        });
      }
      checkAttachment();
    }

    processItem();
  }

  function doTrash(toTrash, removed, checked) {
    if (toTrash.length === 0) {
      showPopup("Cleanup Complete", "Removed 0 duplicate attachments across " + checked + " items.\nFiles on disk were NOT deleted.");
      return;
    }

    var pw = new Zotero.ProgressWindow({ closeOnClick: true });
    pw.changeHeadline("Sci-Hub: Removing " + toTrash.length + " duplicates...");
    pw.show();

    var batchSize = 10;
    var batchIdx = 0;

    function trashBatch() {
      if (batchIdx >= toTrash.length) {
        pw.startCloseTimer(1000);
        showPopup("Cleanup Complete", "Removed " + removed + " duplicate attachments across " + checked + " items.\nFiles on disk were NOT deleted.");
        return;
      }

      var batch = toTrash.slice(batchIdx, batchIdx + batchSize);
      batchIdx += batchSize;
      pw.changeHeadline("Removing " + Math.min(batchIdx, toTrash.length) + "/" + toTrash.length);

      Zotero.Items.trashTx(batch).then(function() {
        removed += batch.length;
        trashBatch();
      }).catch(function(e) {
        Zotero.debug("scihub: trashTx error: " + e.message);
        // Try one at a time
        var singleIdx = 0;
        function trashSingle() {
          if (singleIdx >= batch.length) { trashBatch(); return; }
          Zotero.Items.trashTx([batch[singleIdx]]).then(function() {
            removed++;
            singleIdx++;
            trashSingle();
          }).catch(function() {
            singleIdx++;
            trashSingle();
          });
        }
        trashSingle();
      });
    }
    trashBatch();
  }

  collectNextLib();
}

// ── Plugin Class ───────────────────────────────────────────────────────────

var SciHubFetch = {
  initialized: false,

  _insertFTL: function(win) {
    try {
      if (win && win.MozXULElement && win.MozXULElement.insertFTLIfNeeded) {
        win.MozXULElement.insertFTLIfNeeded("scihub-fetch.ftl");
      }
    } catch (e) {}
  },

  startup: function() {
    return new Promise(function(resolve) {
      if (SciHubFetch.initialized) { resolve(); return; }
      SciHubFetch.initialized = true;
      Zotero.debug("scihub: starting up");

      var windows = Zotero.getMainWindows();
      for (var w = 0; w < windows.length; w++) {
        SciHubFetch._insertFTL(windows[w]);
      }

      try {
        Zotero.MenuManager.registerMenu({
          menuID: "scihub-item-menu",
          pluginID: "scihub-fetch@example.com",
          target: "main/library/item",
          menus: [{ menuType: "menuitem", l10nID: "scihub-download-selected", onCommand: downloadSelectedItems }]
        });

        Zotero.MenuManager.registerMenu({
          menuID: "scihub-collection-menu",
          pluginID: "scihub-fetch@example.com",
          target: "main/library/collection",
          menus: [{ menuType: "menuitem", l10nID: "scihub-download-collection", onCommand: downloadCollectionItems }]
        });

        Zotero.MenuManager.registerMenu({
          menuID: "scihub-tools-menu",
          pluginID: "scihub-fetch@example.com",
          target: "main/menubar/tools",
          menus: [{ menuType: "menuitem", l10nID: "scihub-download-all", onCommand: downloadAllItems }]
        });

        Zotero.MenuManager.registerMenu({
          menuID: "scihub-missing-menu",
          pluginID: "scihub-fetch@example.com",
          target: "main/menubar/file",
          menus: [{
            menuType: "submenu",
            l10nID: "scihub-fetch",
            menus: [
              { menuType: "menuitem", l10nID: "scihub-download-missing", onCommand: downloadMissingPdfs },
              { menuType: "separator" },
              { menuType: "menuitem", l10nID: "scihub-remove-duplicates", onCommand: removeDuplicateAttachments }
            ]
          }]
        });

        Zotero.debug("scihub: menus registered");
      } catch (e) {
        Zotero.debug("scihub: menu error: " + e.message);
      }
      resolve();
    });
  },

  onMainWindowLoad: function(params) {
    SciHubFetch._insertFTL(params.window);
  },

  shutdown: function() {
    return new Promise(function(resolve) {
      SciHubFetch.initialized = false;
      resolve();
    });
  }
};

Zotero.SciHubFetch = SciHubFetch;
