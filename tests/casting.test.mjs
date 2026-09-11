import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

globalThis.Hooks = { once() {} };
globalThis.game = { i18n: { localize: x => x, format: (x, d) => `${x}:${JSON.stringify(d)}` } };
globalThis.ui = { notifications: { warn() {}, error() {} } };
const mod = await import("../scripts/main.mjs");
const systemPath = process.env.DND5E_SOURCE
  ?? "C:/Users/Sionnach/Documents/FoundryVTT-WindowsPortable-14.364/Data/systems/dnd5e/dnd5e.mjs";
const source = readFileSync(systemPath, "utf8");

// Execute the installed system's real methods in a small environment, rather than duplicate their logic.
function nativeMethod(name) {
  const start = source.indexOf(`async ${name}(`);
  assert.ok(start >= 0, `Native method ${name} exists`);
  const end = source.indexOf("/* -------------------------------------------- */", start);
  return source.slice(start, end).trim();
}
const config = {
  DND5E: {
    spellcasting: { spell: { exclusive: {}, getSpellSlotKey: n => `spell${n}` },
      pact: { exclusive: {}, isSingleLevel: true } },
    spellLevels: { 0: "Cantrip", 1: "1st", 2: "2nd", 3: "3rd" }, activityActivationTypes: {}
  }
};
const context = vm.createContext({
  game, CONFIG: config, StringField$15: class { constructor(data) { Object.assign(this, data); } },
  NumberField$E: class {}, simplifyBonus: Number, ConsumptionError: Error, ui,
  foundry: { utils: { mergeObject: (a, b) => Object.assign(a, b) } }
});
vm.runInContext('String.prototype.capitalize = function() { return this[0].toUpperCase() + this.slice(1); };', context);
const NativeDialog = vm.runInContext(`(class { ${nativeMethod("_prepareScalingContext")} })`, context);
const NativeConsumer = vm.runInContext(`(class { ${nativeMethod("_prepareUsageUpdates")} })`, context);

function fixture(enabled = true, level = 0) {
  const item = { type: "spell", name: "Fire Bolt", system: { level, method: "spell" },
    getFlag: (scope, key) => scope === mod.MODULE_ID && key === "enabled" ? enabled : undefined };
  const actor = { system: { spells: {
    spell1: { level: 1, type: "spell", label: "1st", value: 2, max: 4 },
    spell2: { level: 2, type: "spell", label: "2nd", value: 0, max: 2 },
    pact: { level: 3, type: "pact", label: "3rd", value: 1, max: 1 }
  } } };
  const activity = { item, actor, requiresSpellSlot: true, isSpell: true,
    activation: {}, consumption: { spellSlot: true, targets: [], scaling: {} }, getRollData: () => ({}) };
  return { item, actor, activity };
}
async function dialogFor(slot = "spell0", empty = false) {
  const { item, actor, activity } = fixture();
  if (empty) for (const slot of Object.values(actor.system.spells)) slot.value = 0;
  const Dialog = mod.getDialogClass(NativeDialog);
  const dialog = Object.assign(new Dialog(), { item, actor, activity,
    config: { scaling: 0, spell: { slot }, consume: { spellSlot: true } }, _shouldDisplay: () => true });
  return dialog._prepareScalingContext({}, {});
}

test("only checked cantrips gain scaling eligibility; leveled spells keep native result", () => {
  class Spell { get canScale() { return this.level > 0; } }
  mod.enableSpellScaling(Spell);
  for (const [enabled, level, expected] of [[false, 0, false], [true, 0, true], [false, 1, true]]) {
    const data = Object.assign(new Spell(), { parent: fixture(enabled, level).item, level });
    assert.equal(data.canScale, expected);
  }
});
test("unchecked cantrip usage is untouched", () => {
  const usage = { scaling: false }, dialog = { applicationClass: NativeDialog };
  mod.prepareUse(fixture(false).activity, usage, dialog);
  assert.deepEqual(usage, { scaling: false });
  assert.equal(dialog.applicationClass, NativeDialog);
});
test("checked cast config uses native dialog subclass and free default", () => {
  const usage = { scaling: 0, spell: { slot: "spell0" } }, dialog = { applicationClass: NativeDialog };
  mod.prepareUse(fixture().activity, usage, dialog);
  assert.ok(dialog.applicationClass.prototype instanceof NativeDialog);
  assert.equal(usage.spell.slot, "spell0");
});
test("native dialog offers free, normal, and pact slots; spent slots stay disabled", async () => {
  const result = await dialogFor();
  assert.equal(result.spellSlots.value, "spell0");
  assert.deepEqual(Array.from(result.spellSlots.options, o => o.value), ["spell0", "spell1", "spell2", "pact"]);
  assert.equal(result.spellSlots.options.find(o => o.value === "spell2").disabled, true);
});
test("changing the native selection preserves a paid slot", async () => {
  assert.equal((await dialogFor("pact")).spellSlots.value, "pact");
});
test("exhausted slots still allow a free cantrip without no-slots warning", async () => {
  const result = await dialogFor("spell1", true);
  assert.equal(result.spellSlots.value, "spell0");
  assert.equal(result.notes.length, 0);
});
for (const [slot, expected] of [["spell0", {}], ["spell1", { "system.spells.spell1.value": 1 }],
  ["pact", { "system.spells.pact.value": 0 }]]) {
  test(`native consumer handles ${slot}`, async () => {
    const { activity } = fixture();
    const usage = { spell: { slot }, consume: { spellSlot: true } };
    mod.prepareConsumption(activity, usage);
    const consumer = Object.assign(new NativeConsumer(), activity);
    const updates = await consumer._prepareUsageUpdates(usage);
    assert.deepEqual({ ...updates.actor }, expected);
  });
}
test("native consumer rejects exhausted slots", async () => {
  const consumer = Object.assign(new NativeConsumer(), fixture().activity);
  const result = await consumer._prepareUsageUpdates({ spell: { slot: "spell2" }, consume: { spellSlot: true } });
  assert.equal(result, false);
});
test("explicit no-consumption override is respected", async () => {
  const { activity } = fixture();
  const usage = { spell: { slot: "pact" }, consume: false };
  mod.prepareConsumption(activity, usage);
  assert.deepEqual({ ...(await Object.assign(new NativeConsumer(), activity)._prepareUsageUpdates(usage)).actor }, {});
});
test("invalid paid slot is rejected before consumption", () => {
  assert.equal(mod.prepareConsumption(fixture().activity, { spell: { slot: "bad" }, consume: true }), false);
});
