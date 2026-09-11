# Sionnach's Upscaled Cantrips

For Foundry VTT 14.364 and D&D 5e 5.3.3.

1. Enable **Sionnach's Upscaled Cantrips** in your world's **Manage Modules** menu.
2. Open a cantrip, enter edit mode, and open its **Details** tab.
3. Check **Allow cantrip upcasting** (saved automatically).
4. Cast it normally. The standard D&D 5e casting dialog offers **Cantrip — no spell slot** and the actor's eligible leveled slots, including Pact Magic where the system allows it.

Free casts spend no spell slots. Leveled casts use the system's ordinary slot consumption, availability checks, and chat expenditure/refund records. The normal **Consume Spell Slot** override remains available. Unchecked cantrips follow the unmodified system casting flow, including any ordinary targeting or concentration prompts.

## Spell-slot damage scaling

For a cantrip with **Allow cantrip upcasting** enabled, open its damage activity (often named **Cast**) and select **Effect**. Each editable damage part has a **Spell Slot Scaling** section directly beneath its normal Scaling / Dice / Formula row.

- **None**: no slot-based increment.
- **Every Level**: one increment per slot level, starting with 1st level.
- **Every Other Level**: one increment at 2nd level, two at 4th, three at 6th, and four at 8th.
- **Dice**: extra dice per increment.
- **Die**: choose a separate die size for slot damage, such as d6 or d10. Defaults to **Same as cantrip**, preserving existing settings. For example, a cantrip can deal 1d8 cold plus 2d6 fire when cast with a 1st-level slot. The optional Formula field remains available below this row.
- **Formula**: an additional formula per increment, using normal D&D 5e formula scaling.
- **Spell Slot Damage Type**: defaults to **Same as cantrip**. Choose a type for the slot dice/formula. With additive scaling, normal cantrip damage keeps its original type and slot damage becomes a separate native roll (for example, 1d8 cold plus 2d8 fire). With replacement scaling, only the slot damage is rolled, using its chosen type. Free casts always keep the normal cantrip type. Actor/activity bonuses are included once, on the original portion in additive mode or the slot portion in replacement mode.
- **Add to cantrip scaling**: checked by default, this adds the slot dice/formula to normal cantrip damage, including its base dice and character-level increases. Uncheck it to use only the slot section's dice/formula, excluding that part's base cantrip dice, base bonus, and cantrip scaling. Other separately configured activity/actor damage bonuses still follow the system's normal rules.

Free cantrip casts completely ignore this section. The original scaling row remains responsible for free-cast damage. By default the new section uses **None** with **Add to cantrip scaling** checked, preserving existing damage until configured.

For example, at character level 1, a base 1d8 cantrip with Every Level / 2 dice selected deals 1d8 + 2d8 using a 1st-level slot with the checkbox checked, or just 2d8 unchecked. A free cast still deals 1d8. Separate additive terms are combined by the normal damage roll.

In replacement mode, None supplies no damage from that part. Every Other Level supplies its first increment at a 2nd-level slot, so a 1st-level slot also supplies no damage from that part. Choose Every Level when slot damage should begin at 1st level.

Settings are stored on each damage part and follow it when parts are removed or reordered. Native chat damage rolls recover the slot level from the system's saved casting scaling. The spell remains a cantrip on its permanent item document.

The default D&D 5e item sheet is supported. Third-party replacement sheets and casting workflows that bypass D&D 5e's activity hooks are not verified. Linked item/scroll casts keep their original consumption rules. Explicit dialog suppression from macros is respected.

To install elsewhere, extract the installation ZIP into your Foundry user-data `modules` folder, keeping the `sionnachs-upscaled-cantrips` directory. Restart Foundry if it was already running, then enable the module in the world. No dependencies are required.
