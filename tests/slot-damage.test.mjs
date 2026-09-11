import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { wrapScaledFormula, wrapProcessDamagePart, wrapDamageConfig, SLOT_FIELD, installSlotDamage } from "../scripts/slot-damage.mjs";

const source = readFileSync(process.env.DND5E_SOURCE ??
  "C:/Users/Sionnach/Documents/FoundryVTT-WindowsPortable-14.364/Data/systems/dnd5e/dnd5e.mjs", "utf8");
const start = source.indexOf("class DamageData extends");
const end = source.indexOf("const { ArrayField", start);
const nativeClass = source.slice(start, end);
// Use the installed system's actual formula and scaling methods. Stub model initialization only.
const context = vm.createContext({
  foundry: { abstract: { DataModel: class {
    constructor(data) { Object.assign(this, { number: 0, denomination: 0, bonus: "", custom: { enabled: false, formula: "" } }, data); }
  } } },
  Scaling: class {},
  // A minimal Roll adapter isolates that the native method multiplies the supplied formula by the chosen steps.
  Roll: class {
    constructor(formula) { this.formula = formula; }
    alter(factor) { this.formula = this.formula.replace(/\b\d+/g, (n, offset, text) => text[offset - 1] === "d" ? n : String(Number(n) * factor)); return this; }
  }
});
const DamageData = vm.runInContext(`(${nativeClass.trim()})`, context);
const original = DamageData.prototype.scaledFormula;
DamageData.prototype.scaledFormula = wrapScaledFormula(original);
function part({ level = 0, characterSteps = 1, add = true, mode = "whole", number = 1, formula = "", enabled = true, custom, denomination = 0 } = {}) {
  const data = new DamageData({ number: 1, denomination: 8, bonus: "3", scaling: { mode: "whole", number: 1, formula: "" },
    ...(custom ? { custom: { enabled: true, formula: custom } } : {}),
    [SLOT_FIELD]: { add, mode, number, formula, denomination }
  });
  data.parent = { item: { type: "spell", system: { level: 0 }, scalingIncrease: characterSteps,
    getFlag(scope, key) { return scope === "dnd5e" ? level : enabled; } } };
  return data;
}
test("free casts ignore slot settings, even replacement and huge slot increments", () => {
  assert.equal(part({ level: 0, add: false, number: 100 }).scaledFormula(1), "2d8 + 3");
});
test("first-level slots add one increment to character-scaled cantrip damage", () => {
  assert.equal(part({ level: 1 }).scaledFormula(1), "2d8 + 3 + 1d8");
});
test("replacement excludes base cantrip dice, its bonus, and character-level increments", () => {
  assert.equal(part({ level: 3, characterSteps: 3, add: false }).scaledFormula(3), "3d8");
});
test("additive mode combines independent character and slot scaling", () => {
  assert.equal(part({ level: 2, characterSteps: 3 }).scaledFormula(3), "4d8 + 3 + 2d8");
});
test("every-other-level increments occur at even slot levels", () => {
  for (let level = 1; level <= 9; level++) {
    const steps = Math.floor(level / 2);
    assert.equal(part({ level, mode: "half", number: 2 }).scaledFormula(1),
      "2d8 + 3" + (steps ? ` + ${steps * 2}d8` : ""));
  }
});
test("None adds no slot increment; replacement with None supplies no damage", () => {
  assert.equal(part({ level: 4, mode: "" }).scaledFormula(1), "2d8 + 3");
  assert.equal(part({ level: 4, mode: "", add: false }).scaledFormula(1), "");
});
test("slot dice and formula both use slot steps without duplicating base bonuses", () => {
  assert.equal(part({ level: 3, formula: "1d4 + 2" }).scaledFormula(1), "2d8 + 3 + 3d8 + 3d4 + 6");
});
test("custom base formulas scale leading dice and preserve flat bonuses", () => {
  assert.equal(part({ level: 2, custom: "2d6 + 5", add: false }).scaledFormula(1), "2d6");
  assert.equal(part({ level: 2, custom: "2d6 + 5" }).scaledFormula(1), "3d6 + 5 + 2d6");
});
test("formula-only slot scaling can add flat damage", () => {
  assert.equal(part({ level: 2, number: 0, formula: "3" }).scaledFormula(1), "2d8 + 3 + 6");
});
test("user example: first-level caster rolls 2d8 replacing, 3d8 adding, and 1d8 free", () => {
  const damage = part({ level: 1, characterSteps: 0, number: 2, add: false });
  damage.bonus = "";
  assert.equal(damage.scaledFormula(0), "2d8");
  damage[SLOT_FIELD].add = true;
  assert.equal(damage.scaledFormula(0), "1d8 + 2d8");
  damage[SLOT_FIELD].add = false;
  damage.parent.item.getFlag = scope => scope === "dnd5e" ? 0 : true;
  assert.equal(damage.scaledFormula(0), "1d8");
});
test("disabling cantrip upcasting returns the exact native result", () => {
  const damage = part({ level: 3, enabled: false, number: 99 });
  assert.equal(damage.scaledFormula(1), original.call(damage, 1));
});
test("repeated damage rolls never accumulate changes in the saved base damage", () => {
  const damage = part({ level: 5, characterSteps: 2 });
  assert.equal(damage.scaledFormula(2), "3d8 + 3 + 5d8");
  assert.equal(damage.scaledFormula(2), "3d8 + 3 + 5d8");
  assert.equal(damage.number, 1);
  assert.equal(damage.scaling.number, 1);
  assert.equal(damage.bonus, "3");
});
test("slot settings are added to cached embedded schemas and future damage schemas", () => {
  class SchemaField {
    constructor(fields) { this.fields = fields; }
    extendFields(fields) { Object.assign(this.fields, fields); }
  }
  class Field { constructor(options) { this.options = options; } }
  globalThis.foundry = { data: { fields: { SchemaField, StringField: Field, NumberField: Field, BooleanField: Field } } };
  globalThis.Hooks = { on() {} };
  class Model {
    static defineSchema() { return { number: new Field() }; }
    static schema = new SchemaField(this.defineSchema());
    scaledFormula() {}
  }
  const embedded = Object.assign(new SchemaField(Model.defineSchema()), { model: Model });
  const activity = { schema: new SchemaField({ damage: new SchemaField({ parts: { element: embedded } }) }) };
  installSlotDamage(Model, [activity]);
  assert.ok(Model.schema.fields[SLOT_FIELD]);
  assert.ok(embedded.fields[SLOT_FIELD]);
  assert.ok(Model.defineSchema()[SLOT_FIELD]);
  assert.equal(embedded.fields[SLOT_FIELD].fields.add.options.initial, true);
});

// Execute the installed system's actual damage processing and roll-list construction.
function nativeMethod(name) {
  const start = source.indexOf(`  ${name}(`);
  const end = source.indexOf("\n  }", start) + 4;
  return new Function("foundry", "CONFIG", `return ({${source.slice(start, end)}}).${name};`)(
    { utils: { deepClone: structuredClone, getProperty: () => "3" } },
    { DND5E: { itemProperties: {} } });
}
const nativeProcess = nativeMethod("_processDamagePart");
const nativeConfig = nativeMethod("getDamageConfig");
function typedRolls({ level = 1, add = true, type = "fire", mode = "whole", active = true, denomination = 0 } = {}) {
  globalThis.CONFIG = { DND5E: { damageTypes: { cold: {}, fire: {} } } };
  const damage = part({ level, characterSteps: 0, add, number: 2, mode, enabled: active, denomination });
  damage.bonus = "";
  damage.types = new Set(["cold"]);
  damage.types.first = () => "cold";
  damage[SLOT_FIELD].damageType = type;
  const activity = { item: damage.parent.item, damage: { parts: [damage] },
    getActionType: () => "rsak", getRollData: () => ({ scaling: 0 }),
    _processDamagePart: wrapProcessDamagePart(nativeProcess, original) };
  const saved = JSON.stringify(damage[SLOT_FIELD]);
  const getConfig = wrapDamageConfig(nativeConfig);
  const rolls = getConfig.call(activity).rolls;
  assert.deepEqual(getConfig.call(activity).rolls, rolls, "repeated rolls are stable");
  assert.equal(JSON.stringify(damage[SLOT_FIELD]), saved);
  assert.deepEqual([...damage.types], ["cold"]);
  return rolls;
}

test("typed additive slot cast keeps 1d8 cold and 2d8 fire as distinct native rolls", () => {
  const rolls = typedRolls();
  assert.deepEqual(rolls.map(r => [r.parts, r.options.type, r.options.types]), [
    [["1d8", "3"], "cold", ["cold"]], [["2d8"], "fire", ["fire"]]
  ]);
});
test("typed replacement uses only slot damage and retains actor bonus once", () => {
  const rolls = typedRolls({ add: false });
  assert.equal(rolls.length, 1);
  assert.deepEqual(rolls[0].parts, ["2d8", "3"]);
  assert.equal(rolls[0].options.type, "fire");
});
test("free casts ignore the slot damage type", () => {
  const rolls = typedRolls({ level: 0, add: false });
  assert.equal(rolls.length, 1);
  assert.deepEqual(rolls[0].parts, ["1d8", "3"]);
  assert.equal(rolls[0].options.type, "cold");
});
test("blank or unavailable slot types preserve the existing combined roll", () => {
  for (const type of ["", "removed-type"]) {
    const rolls = typedRolls({ type });
    assert.equal(rolls.length, 1);
    assert.deepEqual(rolls[0].parts, ["1d8 + 2d8", "3"]);
    assert.equal(rolls[0].options.type, "cold");
  }
});
test("no slot increment creates no extra typed roll", () => {
  for (const mode of ["", "half"]) {
    const rolls = typedRolls({ mode });
    assert.equal(rolls.length, 1);
    assert.equal(rolls[0].options.type, "cold");
  }
});
test("disabled cantrips ignore the slot type", () => {
  const rolls = typedRolls({ active: false });
  assert.equal(rolls.length, 1);
  assert.equal(rolls[0].options.type, "cold");
});

test("slot die size applies independently in additive, replacement, and free casts", () => {
  for (const denomination of [4, 6, 8, 10, 12, 20, 100]) {
    assert.equal(part({ level: 2, number: 2, denomination }).scaledFormula(1), `2d8 + 3 + 4d${denomination}`);
    assert.equal(part({ level: 2, number: 2, denomination, add: false }).scaledFormula(1), `4d${denomination}`);
    assert.equal(part({ level: 0, number: 2, denomination, add: false }).scaledFormula(1), "2d8 + 3");
  }
});
test("different die sizes retain distinct damage types in native rolls", () => {
  const rolls = typedRolls({ denomination: 6 });
  assert.deepEqual(rolls.map(r => [r.parts, r.options.type]), [
    [["1d8", "3"], "cold"], [["2d6"], "fire"]
  ]);
  const replacement = typedRolls({ denomination: 10, add: false });
  assert.deepEqual(replacement.map(r => [r.parts, r.options.type]), [[["2d10", "3"], "fire"]]);
  assert.deepEqual(typedRolls({ denomination: 6, type: "" })[0].parts, ["1d8 + 2d6", "3"]);
});
test("slot die override works with custom base formulas and every-other-level scaling", () => {
  assert.equal(part({ level: 4, mode: "half", number: 2, denomination: 10, custom: "2d6 + 5", formula: "1d4 + 2" }).scaledFormula(1),
    "3d6 + 5 + 4d10 + 2d4 + 4");
});
