import { Ruleset } from './types';

export const DND_5E_RULESET: Ruleset = {
  id: 'dnd-5e',
  name: 'Dungeons & Dragons 5e',
  description: 'The standard 5th edition ruleset for heroic fantasy.',
  statBlock: {
    primaryStats: ['STR', 'DEX', 'CON', 'INT', 'WIS', 'CHA'],
    resources: ['hitPoints'],
    derivedStats: ['armorClass', 'speed', 'level', 'initiative'],
  },
  rollMechanic: {
    type: 'd20',
    description: 'Roll a 20-sided die, add modifiers, and compare to a Target Number (DC or AC).',
  },
  promptFragments: {
    systemName: 'D&D 5e',
    damageLanguage: 'hit point damage',
    healthLanguage: 'Hit Points (HP)',
    actionLanguage: 'ability checks, saving throws, and attack rolls',
    mechanicsReference: `
*   **Ability Checks:**
    *   Strength (STR): Athletics.
    *   Dexterity (DEX): Acrobatics, Sleight of Hand, Stealth.
    *   Constitution (CON): Concentration saves, endurance checks.
    *   Intelligence (INT): Arcana, History, Investigation, Nature, Religion.
    *   Wisdom (WIS): Animal Handling, Insight, Medicine, Perception, Survival.
    *   Charisma (CHA): Deception, Intimidation, Performance, Persuasion.
*   **Actions in Combat:**
    *   Action: Attack, Cast a Spell (1 action casting time), Dash, Disengage, Dodge, Help, Hide, Ready, Search, Use an Object.
    *   Bonus Action: Only usable for specific abilities, spells, or features (e.g., Cunning Action, certain spells).
    *   Reaction: Used once per round, resets at the start of your turn. Used for Opportunity Attacks or specific abilities like Shield spell.
    *   Free Object Interaction: Draw a weapon, open a door, etc. (one per turn).
*   **Conditions:** Blinded, Charmed, Deafened, Exhaustion, Frightened, Grappled, Incapacitated, Invisible, Paralyzed, Petrified, Poisoned, Prone, Restrained, Stunned, Unconscious. Each has specific mechanical effects you must enforce.
    `,
  },
};

export const COC_7E_RULESET: Ruleset = {
  id: 'coc-7e',
  name: 'Call of Cthulhu 7e',
  description: 'A game of mystery and horror where investigators face cosmic entities.',
  statBlock: {
    primaryStats: ['STR', 'CON', 'SIZ', 'DEX', 'APP', 'INT', 'POW', 'EDU'],
    resources: ['hitPoints', 'sanity', 'luck', 'magicPoints'],
    derivedStats: ['damageBonus', 'build', 'movementRate'],
  },
  rollMechanic: {
    type: 'percentile',
    description: 'Roll two 10-sided dice (d100) and compare to your skill or characteristic. Success levels: Regular, Hard, Extreme, Critical.',
  },
  promptFragments: {
    systemName: 'Call of Cthulhu 7e',
    damageLanguage: 'hit point or sanity loss',
    healthLanguage: 'Hit Points and Sanity',
    actionLanguage: 'skill checks and characteristic rolls',
    mechanicsReference: `
*   **Skill Checks:** Roll d100. Success if <= skill value.
    *   Regular Success: <= Skill
    *   Hard Success: <= 1/2 Skill
    *   Extreme Success: <= 1/5 Skill
    *   Critical Success: 01
    *   Fumble: 96-100 (if skill < 50) or 100 (if skill >= 50)
*   **Bonus/Penalty Dice:** Roll an extra tens die. Take the best (bonus) or worst (penalty).
*   **Pushing the Roll:** If you fail a non-combat skill check, you can justify a second attempt with higher stakes. If you fail a pushed roll, something catastrophic happens.
*   **Sanity (SAN):** When encountering horror, roll SAN check. Failure results in sanity loss (e.g., 1/1d6). Losing 5+ SAN in one go causes Temporary Insanity.
*   **Combat:**
    *   Attacker rolls Fighting vs Defender's Fighting (to fight back) or Dodge.
    *   Firearms: No fighting back, only diving for cover (penalty die to attacker).
    *   Major Wound: Taking damage >= 1/2 Max HP in one blow.
    `,
  },
};

export const RULESETS: Record<string, Ruleset> = {
  'dnd-5e': DND_5E_RULESET,
  'coc-7e': COC_7E_RULESET,
};

export const DEFAULT_RULESET_ID = 'dnd-5e';
