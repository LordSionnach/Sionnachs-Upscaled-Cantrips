import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { installSlotDamage, SLOT_FIELD } from "../scripts/slot-damage.mjs";

const core = "file:///C:/Users/Sionnach/Documents/FoundryVTT-WindowsPortable-14.364/App/resources/app/common/";
const fields = await import(`${core}data/fields.mjs`);
const { default: DataModel } = await import(`${core}abstract/data.mjs`);
// Foundry installs this Array convenience method in its browser bootstrap.
Object.defineProperty(Array.prototype, "filterJoin", { configurable: true, value(separator) { return this.filter(Boolean).join(separator); } });
globalThis.foundry = { abstract: { DataModel }, data: { fields }, utils: await import(`${core}utils/helpers.mjs`) };
globalThis.Hooks = { on() {} };

class DamagePart extends DataModel {
  static defineSchema() {
    return { number: new fields.NumberField({ initial: 1 }), denomination: new fields.NumberField({ initial: 8 }) };
  }
  scaledFormula() { return "1d8"; }
}
class AttackActivity extends DataModel {
  static defineSchema() {
    return { damage: new fields.SchemaField({ parts: new fields.ArrayField(new fields.EmbeddedDataField(DamagePart)) }) };
  }
}
// Cache embedded schemas before installing, matching the system's initialization order.
void AttackActivity.schema;
installSlotDamage(DamagePart, [AttackActivity]);

test("reproduces the original error using Foundry's real StringField validator", () => {
  const broken = new fields.StringField({ initial: "", choices: ["", "whole", "half"] });
  assert.ok(broken.validate(""), "Original field rejects the default None value");
});
test("existing/imported attack damage without module data constructs successfully", () => {
  const activity = new AttackActivity({ damage: { parts: [{ number: 1, denomination: 10 }] } });
  assert.equal(activity.damage.parts[0][SLOT_FIELD].mode, "");
  assert.equal(activity.damage.parts[0][SLOT_FIELD].damageType, "");
  assert.equal(activity.damage.parts[0][SLOT_FIELD].denomination, 0);
  assert.equal(activity.validate(), true);
});
test("adding an empty damage part initializes a valid None/empty formula configuration", () => {
  const activity = new AttackActivity({ damage: { parts: [{}] } });
  assert.equal(activity.damage.parts[0][SLOT_FIELD].formula, "");
  assert.equal(activity.validate(), true);
});
test("saved None settings validate and survive an activity update", () => {
  const activity = new AttackActivity({ damage: { parts: [{ [SLOT_FIELD]: { mode: "", formula: "", number: 1, add: true } }] } });
  activity.updateSource({ "damage.parts": [{ number: 2, [SLOT_FIELD]: { mode: "", formula: "" } }] });
  assert.equal(activity.damage.parts[0].number, 2);
  assert.equal(activity.validate(), true);
});
test("all scaling modes survive real schema serialization and reconstruction", () => {
  for (const mode of ["", "whole", "half"]) {
    const activity = new AttackActivity({ damage: { parts: [{ [SLOT_FIELD]: { mode, number: 2, formula: "1d4 + 2", add: false, damageType: "cold", denomination: 6 } }] } });
    const restored = new AttackActivity(activity.toObject());
    assert.equal(restored.damage.parts[0][SLOT_FIELD].mode, mode);
    assert.equal(restored.damage.parts[0][SLOT_FIELD].add, false);
    assert.equal(restored.damage.parts[0][SLOT_FIELD].damageType, "cold");
    assert.equal(restored.damage.parts[0][SLOT_FIELD].denomination, 6);
    assert.equal(restored.validate(), true);
  }
});

test("native damage model uses saved replacement mode after serialization", () => {
  const source = readFileSync("C:/Users/Sionnach/Documents/FoundryVTT-WindowsPortable-14.364/Data/systems/dnd5e/dnd5e.mjs", "utf8");
  const start = source.indexOf("class DamageData extends");
  const end = source.indexOf("const { ArrayField", start);
  const NativeDamage = new Function("foundry", "NumberField$s", "FormulaField", "SetField$q", "StringField$Q", "SchemaField$z", "BooleanField$y", "Scaling",
    `return (${source.slice(start, end).trim()});`)(foundry, fields.NumberField, fields.StringField, fields.SetField,
      fields.StringField, fields.SchemaField, fields.BooleanField, class {});
  installSlotDamage(NativeDamage);
  const item = { type: "spell", system: { level: 0 }, scalingIncrease: 3,
    getFlag(scope) { return scope === "dnd5e" ? 2 : true; } };
  const raw = { number: 1, denomination: 8, scaling: { mode: "whole", number: 1 },
    [SLOT_FIELD]: { mode: "whole", number: 1, add: false } };
  const parent = new AttackActivity({ damage: { parts: [] } });
  parent.item = item;
  const first = new NativeDamage(raw, { parent });
  const restored = new NativeDamage(first.toObject(), { parent });
  assert.equal(restored[SLOT_FIELD].add, false);
  assert.equal(restored.scaledFormula(3), "2d8");
});
