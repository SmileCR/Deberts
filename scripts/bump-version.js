// Піднімає APP_VERSION в index.html: дата і порядковий номер за сьогодні.
// Запуск перед комітом: node scripts/bump-version.js
const fs = require("fs");
const path = require("path");

const file = path.join(__dirname, "..", "index.html");
let html = fs.readFileSync(file, "utf8");
const m = html.match(/const APP_VERSION = "([^"]+)"/);
if (!m) throw new Error("APP_VERSION не знайдено в index.html");

const d = new Date();
const day = [d.getFullYear(), String(d.getMonth() + 1).padStart(2, "0"), String(d.getDate()).padStart(2, "0")].join(".");
const prev = m[1];
const n = prev.startsWith(day + "-") ? Number(prev.split("-").pop()) + 1 : 1;
const next = day + "-" + n;

html = html.replace(m[0], () => `const APP_VERSION = "${next}"`);
fs.writeFileSync(file, html);
console.log(prev + " -> " + next);
