# zotero-scihub

Download all missing articles in your Zotero from Sci-Hub

Inspired by [zotero-scihub](https://github.com/ethanwillis/zotero-scihub)

A Zotero 9 plugin that scans all your citations, finds items without file attachments, and downloads PDFs from Sci-Hub using their DOIs.

## Features

- **Download Missing PDFs** - Scans your entire library and downloads PDFs for items without stored files
- **Batch Download** - Download PDFs for selected items, a collection, or your entire library
- **Right-click Integration** - Right-click items or collections to download PDFs from Sci-Hub
- **Deduplication** - Remove duplicate file attachments (keeps the newest, trashes extras)
- **Multi-domain Support** - Automatically tries multiple Sci-Hub domains (.ru, .se, .st, .ee)

## Installation

1. Download [`scihub-fetch-1.0.0.xpi`](scihub-fetch-1.0.0.xpi) from the repo root
2. Open Zotero -> **Tools -> Add-ons**
3. Click the gear icon -> **Install Add-on From File...**
4. Select the `.xpi` file
5. Restart Zotero

## Usage

After installation, you'll find Sci-Hub Fetch in several places:

| Location | Action |
|----------|--------|
| Right-click item | Download PDF from Sci-Hub |
| Right-click collection | Download PDFs from Sci-Hub |
| Tools menu | Download All PDFs from Sci-Hub |
| File -> Sci-Hub Fetch | Download Missing PDFs / Remove Duplicates |

### Quick Start

1. Go to **File -> Sci-Hub Fetch -> Download Missing PDFs from Sci-Hub**
2. The plugin scans all items, extracts DOIs, fetches PDFs from Sci-Hub, and attaches them to the corresponding Zotero entries
3. A progress window shows status, and a summary popup appears when complete

### Removing Duplicates

After downloading, some items may have duplicate attachments. Run **File -> Sci-Hub Fetch -> Remove Duplicate File Attachments** to clean them up (only Zotero entries are removed - files on disk are preserved).

## How It Works

1. Scans all items across all libraries
2. Extracts DOIs from the DOI field, Extra field (DOI: ...), or URL (doi.org)
3. Checks if the item already has a stored file attachment (skips linked URLs/bookmarks)
4. Fetches the corresponding Sci-Hub page to find the PDF URL
5. Downloads and attaches the PDF to the Zotero item

## Building from Source

```bash
cd scihub-fetch
zip -r ../scihub-fetch.xpi *
```

## License

GPL-3.0
