const assert = require("assert");
const search = require("../lib/search.js");

assert.strictEqual(search.basename("/Music/Radiohead - Karma Police.mp3"), "Radiohead - Karma Police.mp3");

const parsed = search.parseFilename("/a/01. Radiohead - Karma Police.flac");
assert.strictEqual(parsed.artist, "Radiohead");
assert.strictEqual(parsed.title, "Karma Police");

const enDash = search.parseFilename("Daft Punk – Get Lucky.m4a");
assert.strictEqual(enDash.artist, "Daft Punk");
assert.strictEqual(enDash.title, "Get Lucky");

assert.strictEqual(
  search.basename("/Music/100% Pure Love.mp3"),
  "100% Pure Love.mp3"
);
assert.strictEqual(
  search.parseFilename("file:///tmp/Artist%20-%20Song.mp3").title,
  "Song"
);
assert.ok(!search.isRemote("/Users/me/a.mp3"));

const mdls = search.parseMdls(
  [
    "kMDItemAlbum             = \"OK Computer\"",
    "kMDItemAuthors           = (",
    '    "Radiohead"',
    ")",
    'kMDItemTitle             = "Karma Police"',
  ].join("\n")
);
assert.strictEqual(mdls.artist, "Radiohead");
assert.strictEqual(mdls.title, "Karma Police");
assert.strictEqual(mdls.album, "OK Computer");

const ff = search.tagsFromFfprobe({
  format: { tags: { ARTIST: "Nile Rodgers", title: "from format" } },
  streams: [{ tags: { artist: "ignored if format set", TITLE: "Get Lucky" } }],
});
assert.strictEqual(ff.artist, "Nile Rodgers");
assert.strictEqual(ff.title, "from format");

const mpv = search.tagsFromObject({ Artist: "Sezen Aksu", TITLE: "Şımarık" });
assert.strictEqual(mpv.artist, "Sezen Aksu");
assert.strictEqual(mpv.title, "Şımarık");

const items = [
  { index: 0, filename: "/a.mp3", title: "Karma Police", artist: "Radiohead", album: "OK Computer" },
  { index: 1, filename: "/b.mp3", title: "Şımarık", artist: "Sezen Aksu", album: "" },
  { index: 2, filename: "/c.mp3", title: "Get Lucky", artist: "Daft Punk", album: "" },
];

assert.strictEqual(search.filterItems(items, "radiohead").length, 1);
assert.strictEqual(search.filterItems(items, "radiohead")[0].title, "Karma Police");
assert.strictEqual(search.filterItems(items, "şımarık").length, 1);
assert.strictEqual(search.filterItems(items, "artist:daft").length, 1);
assert.strictEqual(search.filterItems(items, "title:karma").length, 1);
assert.strictEqual(search.filterItems(items, "artist:radiohead get").length, 0);
assert.strictEqual(search.filterItems(items, "police computer").length, 1);

console.log("search tests passed");
