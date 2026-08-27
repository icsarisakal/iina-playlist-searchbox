const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync, spawnSync } = require("child_process");
const search = require("../lib/search.js");

const ffmpeg = spawnSync("ffmpeg", ["-version"], { encoding: "utf8" });
if (ffmpeg.status !== 0) {
  console.log("skip probe test: ffmpeg missing");
  process.exit(0);
}

const file = path.join(os.tmpdir(), "iina-searchbox-sample.mp3");
execFileSync(
  "ffmpeg",
  [
    "-y",
    "-f",
    "lavfi",
    "-i",
    "anullsrc=r=44100:cl=mono",
    "-t",
    "0.2",
    "-metadata",
    "artist=Radiohead",
    "-metadata",
    "title=Karma Police",
    "-metadata",
    "album=OK Computer",
    file,
  ],
  { stdio: "ignore" }
);

const raw = execFileSync(
  "ffprobe",
  [
    "-v",
    "error",
    "-print_format",
    "json",
    "-show_entries",
    "format_tags=title,artist,album,album_artist:stream_tags=title,artist,album,album_artist",
    file,
  ],
  { encoding: "utf8" }
);
const meta = search.tagsFromFfprobe(JSON.parse(raw));
assert.strictEqual(meta.artist, "Radiohead");
assert.strictEqual(meta.title, "Karma Police");
assert.strictEqual(meta.album, "OK Computer");
fs.unlinkSync(file);
console.log("probe tests passed");
