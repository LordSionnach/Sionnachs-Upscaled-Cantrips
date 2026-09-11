import { installSlotDamage } from "./slot-damage.mjs";
export const MODULE_ID = "sionnachs-upscaled-cantrips";
const FREE_SLOT = "spell0";
const dialogClasses = new WeakMap();

export function isEnabled(item) {
  return item?.type === "spell" && item.system?.level === 0
    && item.getFlag(MODULE_ID, "enabled") === true;
}

/** Preserve the original getter for every item that has not explicitly opted in. */
export function enableSpellScaling(SpellData) {
  const prototype = SpellData.prototype;
  const original = Object.getOwnPropertyDescriptor(prototype, "canScale");
  if (!original?.get || !original.configurable) throw new Error("Unsupported D&D 5e spell data model.");
  Object.defineProperty(prototype, "canScale", {
    ...original,
    get() {
      const eligible = isEnabled(this.parent) && !this.linkedActivity
        && !this.parent.getFlag("dnd5e", "spellLevel");
      return eligible || original.get.call(this);
    }
  });
}

/** Extend the configured native dialog, including its normal remaining-slot labels and filters. */
export function getDialogClass(BaseDialog) {
  if (dialogClasses.has(BaseDialog)) return dialogClasses.get(BaseDialog);
  class UpscaledCantripDialog extends BaseDialog {
    async _prepareScalingContext(context, options) {
      context = await super._prepareScalingContext(context, options);
      if (!isEnabled(this.item) || !context.spellSlots) return context;
      const slots = context.spellSlots;
      slots.options = slots.options.filter(option => option.value !== FREE_SLOT);
      const selected = this.config.spell?.slot ?? FREE_SLOT;
      const validSelection = slots.options.some(option => option.value === selected && !option.disabled);
      slots.value = validSelection ? selected : FREE_SLOT;
      for (const option of slots.options) option.selected = option.value === slots.value;
      slots.options.unshift({
        value: FREE_SLOT, label: "Cantrip — no spell slot", disabled: false,
        selected: slots.value === FREE_SLOT
      });
      // Running out of leveled slots does not prevent a free cantrip cast.
      const noSlots = game.i18n.format("DND5E.SpellCastNoSlotsLeft", { name: this.item.name });
      context.notes = context.notes.filter(note => note.message !== noSlots);
      return context;
    }
  }
  dialogClasses.set(BaseDialog, UpscaledCantripDialog);
  return UpscaledCantripDialog;
}

export function prepareUse(activity, usage, dialog) {
  if (!isEnabled(activity.item) || usage.cause || activity.item.getFlag("dnd5e", "spellLevel")) return;
  usage.spell ??= {};
  // Native preparation can default Pact Magic to a paid slot. Default ordinary casts to free.
  if (!usage.scaling) usage.spell.slot = FREE_SLOT;
  usage.spell.slot ??= FREE_SLOT;
  usage.scaling = Math.max(0, activity.actor.system.spells?.[usage.spell.slot]?.level ?? 0);
  dialog.applicationClass = getDialogClass(dialog.applicationClass);
}

export function prepareConsumption(activity, usage) {
  if (!isEnabled(activity.item) || usage.cause || activity.item.getFlag("dnd5e", "spellLevel")) return;
  if (usage.spell?.slot === FREE_SLOT) {
    if (usage.consume === true) usage.consume = { action: true, resources: true, spellSlot: false };
    else if (usage.consume && typeof usage.consume === "object") usage.consume.spellSlot = false;
    return;
  }
  // The native consumer validates availability and records the slot expenditure for chat/refunds.
  const slot = activity.actor.system.spells?.[usage.spell?.slot];
  if (!slot || !(slot.level >= 1)) {
    ui.notifications.warn("Choose a cantrip cast or a valid spell slot.");
    return false;
  }
}

export function renderCheckbox(sheet, html) {
  const item = sheet.document ?? sheet.item;
  const root = html?.querySelector ? html : html?.[0];
  if (!root) return;
  root.querySelectorAll(`[data-module="${MODULE_ID}"]`).forEach(node => node.remove());
  if (item?.type !== "spell" || item.system?.level !== 0) return;
  // Both the navigation button and the content panel have data-tab="details".
  // Anchor to the spell-level field inside the actual content section.
  const panelSelector = 'section.tab[data-tab="details"]';
  const details = root.matches?.(panelSelector) ? root : root.querySelector(panelSelector);
  const levelGroup = details?.querySelector('[name="system.level"]')?.closest(".form-group");
  if (!levelGroup) return;
  const group = document.createElement("div");
  group.className = "form-group";
  group.dataset.module = MODULE_ID;
  const label = document.createElement("label");
  const input = document.createElement("input");
  input.type = "checkbox";
  input.name = `flags.${MODULE_ID}.enabled`;
  input.id = `${sheet.id}-${MODULE_ID}-enabled`;
  input.checked = isEnabled(item);
  input.disabled = !item.isOwner || sheet.isEditable === false || sheet.isEditMode === false;
  label.htmlFor = input.id;
  label.textContent = "Allow cantrip upcasting";
  const fields = document.createElement("div");
  fields.className = "form-fields";
  fields.append(input);
  const hint = document.createElement("p");
  hint.className = "hint";
  hint.textContent = "Choose a free cantrip cast or spend a spell slot of 1st level or higher in the normal casting dialog.";
  group.append(label, fields, hint);
  levelGroup.after(group);
  // The native item sheet's submit-on-change handler persists this flag with the rest of the form.
}

Hooks.once("init", () => {
  if (game.system.id !== "dnd5e") return;
  try {
    enableSpellScaling(CONFIG.Item.dataModels.spell);
    installSlotDamage(dnd5e.dataModels.shared.DamageData, [
      ...Object.values(CONFIG.Item.dataModels),
      ...Object.values(CONFIG.DND5E.activityTypes).map(type => type.documentClass)
    ]);
    Hooks.on("dnd5e.preUseActivity", prepareUse);
    Hooks.on("dnd5e.preActivityConsumption", prepareConsumption);
    Hooks.on("renderItemSheet5e", renderCheckbox);
  } catch (error) {
    console.error(`${MODULE_ID} | Initialization failed`, error);
    Hooks.once("ready", () => ui.notifications.error("Sionnach's Upscaled Cantrips could not initialize. This version requires D&D 5e 5.3.3."));
  }
});
