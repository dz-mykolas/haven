// Builds the brand icon catalogue the API serves from Simple Icons (CC0).
// Output: apps/api/internal/brands/brands.json.gz, embedded in the Go binary,
// so icons are served by Haven itself without contacting any other service.
import { writeFileSync, readFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const icons = require("simple-icons");
const root = new URL("../node_modules/simple-icons/", import.meta.url);
const { version } = JSON.parse(readFileSync(new URL("package.json", root), "utf8"));
const data = JSON.parse(readFileSync(new URL("data/simple-icons.json", root), "utf8"));
const list = Array.isArray(data) ? data : data.icons;
const aka = new Map(list.map((entry) => [entry.title, entry.aliases?.aka ?? []]));

const catalogue = Object.values(icons)
  .filter((icon) => icon && icon.path && icon.slug)
  .map((icon) => ({
    slug: icon.slug,
    title: icon.title,
    hex: icon.hex,
    path: icon.path,
    aka: aka.get(icon.title) ?? [],
  }))
  .sort((a, b) => a.slug.localeCompare(b.slug));

const output = new URL("../apps/api/internal/brands/brands.json.gz", import.meta.url);
writeFileSync(output, gzipSync(JSON.stringify({ version, icons: catalogue }), { level: 9 }));
console.log(`Wrote ${catalogue.length} icons from simple-icons ${version}`);
