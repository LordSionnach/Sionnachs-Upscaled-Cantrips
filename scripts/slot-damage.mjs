const ID = "sionnachs-upscaled-cantrips";
export const SLOT_FIELD = "sionnachSlotScaling";
const enabled = item => item?.type === "spell" && item.system.level === 0 && item.getFlag(ID, "enabled") === true;
const slotRoll = Symbol("sionnachSlotDamageRoll");
const slotDenomination = damage => Number(damage[SLOT_FIELD]?.denomination) || (damage.custom.enabled
  ? Number(damage.custom.formula?.match(/^\d+d(\d+)/)?.[1] ?? 0) : damage.denomination);

/** Keep differently typed slot dice in their own native damage roll. */
export function wrapProcessDamagePart(original, nativeFormula) {
  return function(damage, config, rollData, index = 0) {
    const roll = original.call(this, damage, config, rollData, index);
    const level = Number(this.item?.getFlag("dnd5e", "scaling") ?? 0);
    const settings = damage[SLOT_FIELD];
    const type = settings?.damageType;
    if (!enabled(this.item) || !(level >= 1 && level <= 9) || !type
      || !CONFIG.DND5E.damageTypes[type]) return roll;
    if (settings.add === false) {
      roll.options.type = type;
      roll.options.types = [type];
      return roll;
    }
    // Calculate the slot portion independently, without changing the saved part.
    const slot = new damage.constructor({
      number: 0, denomination: slotDenomination(damage),
      bonus: "", custom: { enabled: false, formula: "" },
      scaling: { mode: settings.mode, number: settings.number, formula: settings.formula }
    });
    const extra = nativeFormula.call(slot, level);
    if (!extra) return roll;
    const combined = damage.scaledFormula(config.scaling ?? rollData.scaling);
    const base = nativeFormula.call(damage, this.item.scalingIncrease);
    // Native actor/activity bonuses remain on the original damage roll, exactly once.
    if (combined) roll.parts.splice(0, 1, ...(base ? [base] : []));
    const extraRoll = { data: { ...roll.data }, parts: [extra],
      options: { ...roll.options, type, types: [type] } };
    if (!roll.parts.length) return extraRoll;
    roll[slotRoll] = extraRoll;
    return roll;
  };
}

export function wrapDamageConfig(original) {
  return function(...args) {
    const config = original.apply(this, args);
    config.rolls = config.rolls.flatMap(roll => {
      const extra = roll[slotRoll];
      delete roll[slotRoll];
      return extra ? [roll, extra] : [roll];
    });
    return config;
  };
}

/** Reuse the system's damage-formula generation and scaling, including custom formula multiplication. */
export function wrapScaledFormula(original) {
  return function(increase) {
    const item = this.parent?.item;
    const level = Number(item?.getFlag("dnd5e", "scaling") ?? 0);
    if (!enabled(item) || !(level >= 1 && level <= 9)) return original.call(this, increase);
    const scaling = this[SLOT_FIELD];
    if (!scaling) return original.call(this, increase);
    // Replacement uses only the slot section, not the base cantrip dice or its scaling.
    const base = scaling.add !== false ? original.call(this, item.scalingIncrease) : "";
    if (!["whole", "half"].includes(scaling.mode)) return base;
    // A separate increment avoids duplicating the base damage, bonuses, or ability modifier.
    // Custom formulas follow native behavior: dice scaling affects the first leading die only.
    const denomination = slotDenomination(this);
    const delta = new this.constructor({
      number: 0, denomination, bonus: "", custom: { enabled: false, formula: "" },
      scaling: { mode: scaling.mode, number: scaling.number, formula: scaling.formula }
    });
    const added = original.call(delta, level);
    return [base, added].filter(Boolean).join(" + ");
  };
}

export function renderSlotDamage(sheet, html) {
  const activity = sheet.activity;
  const item = activity?.item;
  const root = html?.querySelector ? html : html?.[0];
  if (!root) return;
  root.querySelectorAll("[data-sionnach-slot-damage]").forEach(node => node.remove());
  if (!enabled(item)) return;
  const source = activity.toObject();
  for (const nativeSelect of root.querySelectorAll('select[name^="damage.parts."][name$=".scaling.mode"]')) {
    const match = nativeSelect.name.match(/^damage\.parts\.(\d+)\.scaling\.mode$/);
    if (!match) continue;
    const index = Number(match[1]);
    const data = source.damage.parts[index]?.[SLOT_FIELD] ?? { mode: "", number: 1, formula: "", add: true };
    const prefix = `damage.parts.${index}.${SLOT_FIELD}.`;
    const block = document.createElement("div");
    block.dataset.sionnachSlotDamage = "true";
    block.className = "sionnach-slot-damage";
    const title = document.createElement("h4");
    title.textContent = "Spell Slot Scaling";
    const row = document.createElement("div");
    row.className = "field-group";
    const makeField = (labelText, control, key) => {
      const group = document.createElement("div");
      group.className = "form-group label-top";
      const label = document.createElement("label");
      control.name = prefix + key;
      control.id = `${sheet.id}-slot-${index}-${key}`;
      label.htmlFor = control.id;
      label.textContent = labelText;
      control.disabled = !item.isOwner || sheet.isEditable === false;
      const fields = document.createElement("div");
      fields.className = "form-fields";
      fields.append(control);
      group.append(label, fields);
      return group;
    };
    const mode = document.createElement("select");
    for (const [value, label] of [["", "None"], ["whole", "Every Level"], ["half", "Every Other Level"]]) mode.add(new Option(label, value));
    mode.value = data.mode;
    const dice = document.createElement("input");
    dice.type = "number";
    dice.min = "0";
    dice.step = "1";
    dice.dataset.dtype = "Number";
    dice.value = data.number ?? 1;
    const formula = document.createElement("input");
    formula.type = "text";
    formula.value = data.formula ?? "";
    const die = document.createElement("select");
    die.dataset.dtype = "Number";
    die.add(new Option("Same as cantrip", "0"));
    for (const size of CONFIG.DND5E.dieSteps) die.add(new Option(`d${size}`, String(size)));
    die.value = String(data.denomination ?? 0);
    row.append(makeField("Scaling", mode, "mode"), makeField("Dice", dice, "number"), makeField("Die", die, "denomination"));
    const formulaGroup = makeField("Formula", formula, "formula");
    const damageType = document.createElement("select");
    damageType.add(new Option("Same as cantrip", ""));
    for (const [value, definition] of Object.entries(CONFIG.DND5E.damageTypes)) {
      damageType.add(new Option(game.i18n.localize(definition.label ?? definition), value));
    }
    if (data.damageType && !CONFIG.DND5E.damageTypes[data.damageType]) {
      damageType.add(new Option(data.damageType, data.damageType));
    }
    damageType.value = data.damageType ?? "";
    const typeGroup = makeField("Spell Slot Damage Type", damageType, "damageType");
    const add = document.createElement("input");
    add.type = "checkbox";
    add.checked = data.add !== false;
    const addGroup = makeField("Add to cantrip scaling", add, "add");
    addGroup.className = "form-group";
    const hint = document.createElement("p");
    hint.className = "hint";
    hint.textContent = "Checked: add slot dice/formula to normal cantrip damage. Unchecked: use only the slot dice/formula, excluding base cantrip damage. Free casts ignore this section. Scaling starts above level 0.";
    block.append(title, row, formulaGroup, typeGroup, addGroup, hint);
    nativeSelect.closest(".field-group").after(block);
  }
}

export function installSlotDamage(DamageData, models = []) {
  const { SchemaField, StringField, NumberField, BooleanField } = foundry.data.fields;
  // Store the settings with their damage part, so reordering/deleting parts cannot move scaling onto another part.
  const extraFields = () => ({
    [SLOT_FIELD]: new SchemaField({
      mode: new StringField({ initial: "", blank: true, choices: ["", "whole", "half"] }),
      number: new NumberField({ initial: 1, min: 0, integer: true }),
      denomination: new NumberField({ initial: 0, min: 0, integer: true }),
      formula: new StringField({ initial: "", blank: true }),
      damageType: new StringField({ initial: "", blank: true }),
      add: new BooleanField({ initial: true })
    })
  });
  const defineSchema = DamageData.defineSchema;
  DamageData.defineSchema = function() { return { ...defineSchema.call(this), ...extraFields() }; };
  // Foundry embeds independent schema copies. Extend both existing copies and future definitions.
  const visited = new Set();
  const extend = field => {
    if (!field || visited.has(field)) return;
    visited.add(field);
    if ((field === DamageData.schema || field.model === DamageData) && !field.fields[SLOT_FIELD]) {
      field.extendFields(extraFields());
    }
    for (const child of Object.values(field.fields ?? {})) extend(child);
    if (field.element) extend(field.element);
  };
  extend(DamageData.schema);
  for (const Model of models) if (Model?.schema) extend(Model.schema);
  const nativeFormula = DamageData.prototype.scaledFormula;
  DamageData.prototype.scaledFormula = wrapScaledFormula(nativeFormula);
  // Patch the common activity implementations once, before attack/save overrides add their options.
  const bases = new Set();
  for (const Model of models) {
    let base;
    for (let proto = Model?.prototype; proto; proto = Object.getPrototypeOf(proto)) {
      if (Object.hasOwn(proto, "_processDamagePart")) base = proto;
    }
    if (base) bases.add(base);
  }
  for (const base of bases) {
    base._processDamagePart = wrapProcessDamagePart(base._processDamagePart, nativeFormula);
    base.getDamageConfig = wrapDamageConfig(base.getDamageConfig);
  }
  Hooks.on("renderActivitySheet", renderSlotDamage);
}
