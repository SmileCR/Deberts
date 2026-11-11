// Тести підрахунку очок. Запуск: node --test tests/
// Функції беруться прямо з index.html, тож тест перевіряє той самий код, що йде в застосунок.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8").replace(/\r\n/g, "\n");

// Витягуємо function NAME(...) { ... } або const NAME = ... з html (з урахуванням дужок і рядків).
function extractFunction(name) {
  let start = html.indexOf("function " + name + "(");
  if (start >= 0) return sliceBalanced(start, "{", "}");
  start = html.indexOf("const " + name + " = ");
  if (start >= 0) return sliceBalanced(start, null, ";");
  throw new Error("not found: " + name);
}
function sliceBalanced(start, open, close) {
  let depth = 0, i = start, began = false;
  for (; i < html.length; i++) {
    const c = html[i];
    if (c === "\"" || c === "'" || c === "`") {
      const q = c; i++;
      while (i < html.length && html[i] !== q) { if (html[i] === "\\") i++; i++; }
      continue;
    }
    if (c === "{" || c === "(" || c === "[") { depth++; began = true; }
    else if (c === "}" || c === ")" || c === "]") { depth--; if (close === "}" && depth === 0 && c === "}") break; }
    else if (c === ";" && depth === 0 && began) break;
  }
  return html.slice(start, i + 1);
}

const NAMES = [
  "fmt", "defaultSettings", "isKharkivPreset", "playerNameFromList", "comboSum", "rawTotal",
  "calculateUnderTarget", "computeRound", "evaluateEnd", "validateRound", "applyRunRule", "emptyPerPlayer"
];
// Залежності, які потрібні функціям (у браузері їх дає сторінка).
const stubs = `
  const lsGet = (k, d) => d;
  const readPrefsSettings = () => ({});
  const defaultGame = () => ({ players: {}, rounds: [], settings: defaultSettings(), theme: "dark", setupDone: false });
`;
const code = stubs + NAMES.map(extractFunction).join("\n") + "\nreturn { " + NAMES.join(", ") + " };";
const api = new Function(code)();

const S = api.defaultSettings();
const P = (ids) => ids.map((id) => ({ id, displayName: id }));
const entry = (o = {}) => ({ trick: "", runCombo: null, marriage: false, capot: false, noTricks: false, ...o });
const form = (per, extra = {}) => ({ callerId: null, underTarget: false, perPlayer: per, debertsPlayerId: null, debertsConfirmed: false, ...extra });

test("комбінації: терц дає 20, марʼяж 20, серії не сумуються в одного гравця", () => {
  assert.equal(api.comboSum(entry({ runCombo: "terc" }), S.comboValues), 20);
  assert.equal(api.comboSum(entry({ marriage: true }), S.comboValues), 20);
  assert.equal(api.comboSum(entry({ runCombo: "sotnya", marriage: true }), S.comboValues), 120);
});

test("серія: рахується лише найбільша серед гравців, марʼяж не зачіпається", () => {
  const f = form({
    p1: entry({ trick: "40", runCombo: "poltinnik" }),          // 50
    p2: entry({ trick: "60", runCombo: "terc", marriage: true }) // терц 20 не рахується, марʼяж 20 рахується
  });
  const r = api.computeRound(f, P(["p1", "p2"]), S);
  assert.equal(r.finals.p1, 90, "полтинник 50 + 40 взяток");
  assert.equal(r.finals.p2, 80, "60 взяток + марʼяж 20, без терца");
});

test("серія: однакові найбільші рахуються обидві", () => {
  const f = form({ p1: entry({ trick: "10", runCombo: "terc" }), p2: entry({ trick: "10", runCombo: "terc" }) });
  const r = api.computeRound(f, P(["p1", "p2"]), S);
  assert.equal(r.finals.p1, 30);
  assert.equal(r.finals.p2, 30);
});

test("недобір: очки замовника переходять суперникам за правилом all_to_opponent", () => {
  const f = form({ p1: entry({ trick: "30" }), p2: entry({ trick: "120" }) }, { callerId: "p1", underTarget: true });
  const r = api.computeRound(f, P(["p1", "p2"]), S);
  assert.equal(r.finals.p1, 0, "замовник втрачає свої очки");
  assert.equal(r.finals.p2, 150, "суперник отримує 120 + 30");
  assert.ok(r.underTargetMessage && r.underTargetMessage.length > 0);
});

test("капот додає бонус, лижа віднімає штраф", () => {
  const on = { ...S, capotEnabled: true, capotBonus: 90 };
  const f = form({ p1: entry({ trick: "162", capot: true }), p2: entry({ trick: "0", noTricks: true }) });
  const r = api.computeRound(f, P(["p1", "p2"]), on);
  assert.equal(r.finals.p1, 252);
  assert.equal(r.finals.p2, -50);
});

test("кінець партії: перший, хто перетнув 1001 і має більше, виграє", () => {
  const rounds = [{ finals: { p1: 900, p2: 500 } }, { finals: { p1: 120, p2: 100 } }];
  const e = api.evaluateEnd(rounds, P(["p1", "p2"]), S);
  assert.equal(e.finished, true);
  assert.equal(e.winner, "p1");
  assert.equal(e.reason, "target");
});

test("кінець партії: однакова сума понад ціль — гра триває", () => {
  const rounds = [{ finals: { p1: 1001, p2: 1001 } }];
  const e = api.evaluateEnd(rounds, P(["p1", "p2"]), S);
  assert.equal(e.finished, false);
});

test("деберц дає миттєву перемогу, якщо увімкнено", () => {
  const rounds = [{ finals: { p1: 10, p2: 5 }, debertsPlayerId: "p2", debertsConfirmed: true }];
  const e = api.evaluateEnd(rounds, P(["p1", "p2"]), S);
  assert.equal(e.winner, "p2");
  assert.equal(e.reason, "deberts");
});

test("перевірка: сума очок взяток не може перевищувати ліміт раунду", () => {
  const f = form({ p1: entry({ trick: "100" }), p2: entry({ trick: "100" }) });
  const v = api.validateRound(f, P(["p1", "p2"]), S);
  assert.ok(v.errors.some((e) => e.includes("перевищує")));
});

test("перевірка: капот лише одному гравцю і без взяток у інших", () => {
  const on = { ...S, capotEnabled: true };
  const f = form({ p1: entry({ trick: "162", capot: true }), p2: entry({ trick: "5" }) });
  const v = api.validateRound(f, P(["p1", "p2"]), on);
  assert.ok(v.errors.some((e) => e.includes("капоті")));
});
