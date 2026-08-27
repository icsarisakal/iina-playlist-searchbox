const {
  console,
  event,
  standaloneWindow,
  playlist,
  menu,
  mpv,
  file,
  utils,
  preferences,
} = iina;

const search = require("./lib/search.js");

const CACHE_PATH = "@data/meta-cache.json";
const CACHE_VERSION = 1;
const PROBE_CONCURRENCY = 3;

let uiBound = false;
let uiReady = false;
let openOn = false;
let lastItems = [];
let lastQuery = "";
let cache = {};
let cacheDirty = false;
let probeToken = 0;
let hasFfprobe = null;
let pendingOpen = false;

function log() {
  const args = [];
  for (let i = 0; i < arguments.length; i++) args.push(arguments[i]);
  console.log(args.join(" "));
}

function loadCache() {
  try {
    if (!file.exists(CACHE_PATH)) return {};
    const data = JSON.parse(file.read(CACHE_PATH));
    if (!data || data.version !== CACHE_VERSION) return {};
    return data.entries || {};
  } catch (err) {
    log("cache read failed", err);
    return {};
  }
}

function saveCache() {
  if (!cacheDirty) return;
  try {
    file.write(
      CACHE_PATH,
      JSON.stringify({ version: CACHE_VERSION, entries: cache })
    );
    cacheDirty = false;
  } catch (err) {
    log("cache write failed", err);
  }
}

function remember(path, meta) {
  if (!path || search.isRemote(path)) return;
  const key = search.hashPath(path);
  const prev = cache[key] || {};
  const next = {
    artist: meta.artist || prev.artist || "",
    title: meta.title || prev.title || "",
    album: meta.album || prev.album || "",
  };
  if (
    next.artist === prev.artist &&
    next.title === prev.title &&
    next.album === prev.album
  ) {
    return;
  }
  cache[key] = next;
  cacheDirty = true;
}

function currentMpvMeta() {
  try {
    return search.tagsFromObject(mpv.getNative("metadata"));
  } catch (err) {
    return { artist: "", title: "", album: "" };
  }
}

function buildItems() {
  try {
    const list = playlist.list() || [];
    const playing = currentMpvMeta();
    const items = [];
    for (let i = 0; i < list.length; i++) {
      const item = list[i] || {};
      const parsed = search.parseFilename(item.filename);
      const stored = cache[search.hashPath(item.filename)] || {};
      let artist = "";
      let title = item.title || "";
      let album = "";
      if (item.isPlaying) {
        artist = playing.artist;
        title = playing.title || title;
        album = playing.album;
      }
      artist = artist || stored.artist || parsed.artist;
      title = title || stored.title || parsed.title;
      album = album || stored.album || "";
      items.push({
        index: i,
        filename: item.filename,
        title: title,
        artist: artist,
        album: album,
        isPlaying: !!item.isPlaying,
      });
    }
    return items;
  } catch (err) {
    log("buildItems failed", err);
    return [];
  }
}

function closeSearch() {
  openOn = false;
  lastQuery = "";
  pendingOpen = false;
  standaloneWindow.close();
}

function pushOpen(items) {
  standaloneWindow.postMessage("open", { items: items, query: lastQuery || "" });
}

function pushResults(items) {
  if (!openOn) return;
  standaloneWindow.postMessage("results", { items: items, query: lastQuery });
}

function showSearch() {
  lastItems = buildItems();
  lastQuery = "";
  const filtered = search.filterItems(lastItems, "");
  log("open search count=" + lastItems.length);
  if (lastItems[0]) {
    log("first=" + lastItems[0].artist + " | " + lastItems[0].title);
  }
  openOn = true;
  standaloneWindow.open();
  pushOpen(filtered);
  startProbe(lastItems);
}

function ensureUI() {
  if (uiBound) return;
  uiBound = true;
  standaloneWindow.loadFile("ui/search.html");
  standaloneWindow.setProperty({
    title: "Search Playlist",
    resizable: true,
  });
  standaloneWindow.setFrame(560, 460);
  standaloneWindow.onMessage("ready", function () {
    uiReady = true;
    log("search ui ready");
    if (pendingOpen) {
      pendingOpen = false;
      showSearch();
    }
  });
  standaloneWindow.onMessage("play", onPlay);
  standaloneWindow.onMessage("close", closeSearch);
  standaloneWindow.onMessage("query", onQuery);
}

function openSearch() {
  if (openOn) {
    closeSearch();
    return;
  }
  ensureUI();
  if (!uiReady) {
    pendingOpen = true;
    log("search ui not ready yet");
    return;
  }
  showSearch();
}

function onPlay(data) {
  if (data && typeof data.index === "number") {
    playlist.play(data.index);
  }
  closeSearch();
}

function onQuery(query) {
  lastQuery = String(query || "");
  pushResults(search.filterItems(lastItems, lastQuery));
}

function patchItem(index, meta) {
  for (let i = 0; i < lastItems.length; i++) {
    if (lastItems[i].index === index) {
      if (meta.artist) lastItems[i].artist = meta.artist;
      if (meta.title) lastItems[i].title = meta.title;
      if (meta.album) lastItems[i].album = meta.album;
      break;
    }
  }
  if (openOn) pushResults(search.filterItems(lastItems, lastQuery));
}

function probeMode() {
  return preferences.get("probeMode") || "mdls-ffprobe";
}

function ensureFfprobe() {
  if (hasFfprobe != null) return hasFfprobe;
  try {
    hasFfprobe = utils.fileInPath("ffprobe");
  } catch (err) {
    hasFfprobe = false;
  }
  return hasFfprobe;
}

async function execMdls(path) {
  const result = await utils.exec("/usr/bin/mdls", [
    "-name",
    "kMDItemTitle",
    "-name",
    "kMDItemAuthors",
    "-name",
    "kMDItemAlbum",
    path,
  ]);
  if (!result || result.status !== 0) return null;
  const meta = search.parseMdls(result.stdout);
  if (!meta.artist && !meta.title && !meta.album) return null;
  return meta;
}

async function execFfprobe(path) {
  if (!ensureFfprobe()) return null;
  const result = await utils.exec("ffprobe", [
    "-v",
    "error",
    "-print_format",
    "json",
    "-show_entries",
    "format_tags=title,artist,album,album_artist:stream_tags=title,artist,album,album_artist",
    path,
  ]);
  if (!result || result.status !== 0 || !result.stdout) return null;
  try {
    const meta = search.tagsFromFfprobe(JSON.parse(result.stdout));
    if (!meta.artist && !meta.title && !meta.album) return null;
    return meta;
  } catch (err) {
    return null;
  }
}

async function probeOne(item, mode) {
  if (!item || search.isRemote(item.filename)) return null;
  const key = search.hashPath(item.filename);
  if (cache[key] && (cache[key].artist || cache[key].title)) {
    return cache[key];
  }
  let meta = null;
  if (mode === "mdls" || mode === "mdls-ffprobe") {
    try {
      meta = await execMdls(item.filename);
    } catch (err) {
      meta = null;
    }
  }
  const needsFfprobe =
    mode === "mdls-ffprobe" && (!meta || !meta.artist || !meta.title);
  if (needsFfprobe) {
    try {
      const probed = await execFfprobe(item.filename);
      if (probed) meta = search.mergeMeta(meta, probed);
    } catch (err) {
      // ffprobe optional
    }
  }
  if (meta && (meta.artist || meta.title || meta.album)) {
    remember(item.filename, meta);
    return meta;
  }
  return null;
}

async function startProbe(items) {
  const mode = probeMode();
  if (mode === "filename") return;
  const token = ++probeToken;
  const pending = [];
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (search.isRemote(item.filename)) continue;
    const stored = cache[search.hashPath(item.filename)];
    if (stored && (stored.artist || stored.title)) continue;
    pending.push(item);
  }
  if (!pending.length) return;

  let cursor = 0;
  async function worker() {
    while (cursor < pending.length && token === probeToken) {
      const item = pending[cursor++];
      const meta = await probeOne(item, mode);
      if (token !== probeToken) return;
      if (meta) patchItem(item.index, meta);
    }
  }

  const workers = [];
  const n = Math.min(PROBE_CONCURRENCY, pending.length);
  for (let i = 0; i < n; i++) workers.push(worker());
  await Promise.all(workers);
  if (token === probeToken) saveCache();
}

function cachePlaying() {
  const list = playlist.list() || [];
  const current = list.filter(function (item) {
    return item.isPlaying;
  })[0];
  if (!current) return;
  const meta = currentMpvMeta();
  if (meta.artist || meta.title || meta.album) {
    remember(current.filename, meta);
    saveCache();
    if (openOn) {
      const playing = list.indexOf(current);
      if (playing >= 0) patchItem(playing, meta);
    }
  }
}

function addMenu() {
  const shortcut = preferences.get("shortcut") || "Meta+f";
  menu.removeAllItems();
  menu.addItem(
    menu.item("Search Playlist", openSearch, { keyBinding: shortcut })
  );
}

cache = loadCache();
addMenu();
event.on("iina.window-loaded", ensureUI);
event.on("iina.file-loaded", cachePlaying);
event.on("mpv.metadata.changed", cachePlaying);
event.on("mpv.playlist.changed", function () {
  if (!openOn) return;
  lastItems = buildItems();
  pushResults(search.filterItems(lastItems, lastQuery));
});
log("playlist searchbox loaded");
