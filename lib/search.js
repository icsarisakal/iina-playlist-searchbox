function normalize(value) {
  return String(value || "")
    .toLocaleLowerCase("tr")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

function basename(path) {
  let raw = String(path || "");
  if (raw.indexOf("file://") === 0) raw = raw.slice(7);
  const clean = raw.split("?")[0].replace(/\/+$/, "");
  const parts = clean.split(/[/\\]/);
  const last = parts[parts.length - 1] || "";
  try {
    return decodeURIComponent(last);
  } catch (err) {
    return last;
  }
}

function stripExtension(name) {
  return String(name || "").replace(/\.[a-z0-9]{1,5}$/i, "");
}

function parseFilename(filename) {
  const base = stripExtension(basename(filename));
  const stripped = base.replace(/^\d{1,3}(\s*[-._]\s*|\s+)/, "").trim();
  const parts = stripped.split(/\s+[-–—]\s+/);
  if (parts.length >= 2) {
    return {
      artist: parts[0].trim(),
      title: parts.slice(1).join(" - ").trim(),
    };
  }
  return { artist: "", title: stripped };
}

function isRemote(filename) {
  return /^(https?|ftp|rtmp|rtsp|mms|udp):/i.test(String(filename || ""));
}

function hashPath(path) {
  let hash = 2166136261;
  const text = String(path || "");
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16);
}

function asText(value) {
  if (value == null) return "";
  if (Array.isArray(value)) {
    return value
      .map(asText)
      .filter(Boolean)
      .join(", ");
  }
  return String(value).trim();
}

function pickTag(tags, keys) {
  if (!tags || typeof tags !== "object") return "";
  const lower = {};
  const names = Object.keys(tags);
  for (let i = 0; i < names.length; i++) {
    const key = names[i].toLowerCase().replace(/-/g, "_");
    const val = asText(tags[names[i]]);
    if (!lower[key] && val && val.toLowerCase() !== "(null)") lower[key] = val;
  }
  for (let i = 0; i < keys.length; i++) {
    if (lower[keys[i]]) return lower[keys[i]];
  }
  return "";
}

const ARTIST_KEYS = ["artist", "album_artist", "albumartist", "artist_name", "artistsort"];
const TITLE_KEYS = ["title", "tracktitle", "song"];
const ALBUM_KEYS = ["album"];

function tagsFromObject(tags) {
  return {
    artist: pickTag(tags, ARTIST_KEYS),
    title: pickTag(tags, TITLE_KEYS),
    album: pickTag(tags, ALBUM_KEYS),
  };
}

function tagsFromFfprobe(payload) {
  const buckets = [];
  if (payload && payload.format && payload.format.tags) {
    buckets.push(payload.format.tags);
  }
  const streams = payload && payload.streams ? payload.streams : [];
  for (let i = 0; i < streams.length; i++) {
    if (streams[i] && streams[i].tags) buckets.push(streams[i].tags);
  }
  const merged = {};
  for (let i = 0; i < buckets.length; i++) {
    const tags = buckets[i];
    const names = Object.keys(tags);
    for (let j = 0; j < names.length; j++) {
      const key = names[j].toLowerCase().replace(/-/g, "_");
      if (merged[key] == null || merged[key] === "") merged[key] = tags[names[j]];
    }
  }
  return tagsFromObject(merged);
}

function parseMdls(stdout) {
  const text = String(stdout || "");
  const result = { artist: "", title: "", album: "" };
  const keyMap = {
    kMDItemTitle: "title",
    kMDItemAuthors: "artist",
    kMDItemAlbum: "album",
  };
  const keys = Object.keys(keyMap);
  for (let i = 0; i < keys.length; i++) {
    const key = keys[i];
    const match = text.match(
      new RegExp(key + "\\s*=\\s*([\\s\\S]*?)(?=\\nkMDItem[A-Za-z]+\\s*=|$)")
    );
    if (!match) continue;
    let raw = match[1].trim();
    if (!raw || raw === "(null)") continue;
    if (raw.charAt(0) === "(") {
      const names = [];
      const re = /"([^"]*)"/g;
      let item;
      while ((item = re.exec(raw))) names.push(item[1]);
      raw = names.join(", ");
    } else if (raw.charAt(0) === '"' && raw.charAt(raw.length - 1) === '"') {
      raw = raw.slice(1, -1);
    }
    raw = raw.trim();
    if (raw) result[keyMap[key]] = raw;
  }
  return result;
}

function parseQuery(rawQuery) {
  const raw = String(rawQuery || "").trim();
  const match = raw.match(/^(artist|title|album)\s*:\s*(.*)$/i);
  if (match) {
    return { field: match[1].toLowerCase(), body: match[2] };
  }
  return { field: "all", body: raw };
}

function haystack(item, field) {
  if (field === "artist") return normalize(item.artist);
  if (field === "title") return normalize(item.title);
  if (field === "album") return normalize(item.album);
  return normalize(
    [item.artist, item.title, item.album, stripExtension(basename(item.filename))].join(" ")
  );
}

function matches(item, rawQuery) {
  const parsed = parseQuery(rawQuery);
  const tokens = normalize(parsed.body).split(/\s+/).filter(Boolean);
  if (!tokens.length) return true;
  const hay = haystack(item, parsed.field);
  for (let i = 0; i < tokens.length; i++) {
    if (hay.indexOf(tokens[i]) === -1) return false;
  }
  return true;
}

function rank(item, rawQuery) {
  const parsed = parseQuery(rawQuery);
  const q = normalize(parsed.body);
  if (!q) return 0;
  const title = normalize(item.title);
  const artist = normalize(item.artist);
  if (title === q || artist === q) return 300;
  if (title.indexOf(q) === 0 || artist.indexOf(q) === 0) return 200;
  if (title.indexOf(q) !== -1) return 100;
  if (artist.indexOf(q) !== -1) return 90;
  return 1;
}

function filterItems(items, rawQuery) {
  const list = items || [];
  const empty = !String(rawQuery || "").trim();
  const out = [];
  for (let i = 0; i < list.length; i++) {
    if (matches(list[i], rawQuery)) out.push(list[i]);
  }
  if (empty) return out;
  out.sort(function (a, b) {
    const delta = rank(b, rawQuery) - rank(a, rawQuery);
    return delta !== 0 ? delta : a.index - b.index;
  });
  return out;
}

function mergeMeta(base, extra) {
  const next = {
    artist: (base && base.artist) || "",
    title: (base && base.title) || "",
    album: (base && base.album) || "",
  };
  if (extra) {
    if (extra.artist) next.artist = extra.artist;
    if (extra.title) next.title = extra.title;
    if (extra.album) next.album = extra.album;
  }
  return next;
}

module.exports = {
  normalize,
  basename,
  parseFilename,
  isRemote,
  hashPath,
  tagsFromObject,
  tagsFromFfprobe,
  parseMdls,
  parseQuery,
  matches,
  rank,
  filterItems,
  mergeMeta,
};
