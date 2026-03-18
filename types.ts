
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export interface Message {
  sender: 'user' | 'model' | 'error' | 'system';
  text: string;
  hidden?: boolean;
}

export interface GameSettings {
  tone: 'heroic' | 'gritty' | 'comedic';
  narration: 'concise' | 'descriptive' | 'cinematic';
}

export interface UISettings {
  enterToSend: boolean;
  fontSize: 'small' | 'medium' | 'large';
  experimentalUploadLimit: boolean;
  activeModel: string;
  apiKey: string;
  localAiUrl: string;
  localAiModel: string;
  systemVersion: '2.0' | '3.0';
  engineVariant: 'pro' | 'flash';
}

export interface AbilityScore {
  score: number;
  modifier: string;
}

export interface Skill {
  name: string;
  proficient: boolean;
}

export interface Achievement {
  name: string;
  description: string;
}

export interface CharacterSheetData {
  name: string;
  race: string;
  class: string;
  level: number;
  abilityScores: {
    STR: AbilityScore;
    DEX: AbilityScore;
    CON: AbilityScore;
    INT: AbilityScore;
    WIS: AbilityScore;
    CHA: AbilityScore;
  };
  armorClass: number;
  hitPoints: {
    current: number;
    max: number;
  };
  speed: string;
  skills: Skill[];
  featuresAndTraits: string[];
  conditions?: string[];
  backstory?: string;
}

export interface NPCState {
  name: string;
  description: string;
  relationship: string;
}

export interface ProgressClock {
  current: number;
  max: number;
  label: string;
}

export interface Faction {
  status: string;
  goal: string;
}

export interface SemanticNode {
  id: string;
  content: string;
  embedding: number[];
  timestamp: number;
  importance: number; // 0-1 score
  parentId: string | null;
  childIds: string[];
  edges: Record<string, number>; // target node id -> association weight
  clusterLabel?: string;
}

export interface Scar {
  vector: number[];
  depth: number;
  timestamp: number;
  B_total: number;
}

export interface ActiveEncounters {
  entityId: string; // unique identifier (could be NPC name + timestamp)
  currentHp: number;
  maxHp: number;
  conditions: string[]; // e.g., ["poisoned", "blinded"]
  armorClass: number;
  initiative: number;
}

export interface ChatSession {
  id: string;
  title: string;
  messages: Message[];
  isPinned: boolean;
  createdAt: number;
  adminPassword?: string;
  personaId?: string;
  creationPhase?:
    | 'guided'
    | 'character_creation'
    | 'narrator_selection'
    | 'guided_password'
    | 'world_creation'
    | 'quick_start_selection'
    | 'quick_start_password'
    | false;
  characterSheet?: CharacterSheetData | string;
  inventory?: string;
  characterImageUrl?: string;
  questLog?: string;
  npcList?: NPCState[];
  achievements?: Achievement[];
  settings?: GameSettings;
  quickStartChars?: CharacterSheetData[];
  progressClocks?: { [id: string]: ProgressClock };
  factions?: { [id: string]: Faction };
  semanticLog?: SemanticNode[];
  storySummary?: string;
  systemVersion?: '2.0' | '3.0';
  scarLedger?: Scar[];
  currentVector?: number[];
  prevVector?: number[];
  Bc?: number;
  lambdaState?: 'Convergent' | 'Recursive' | 'Divergent' | 'Chaotic';
  latentStateEmbedding?: number[]; // high‑dimensional embedding for the session's current latent state
  activeEncounters?: ActiveEncounters[]; // list of active combat entities
  deltaSHistory?: number[];
  currentSpatialGraph?: Array<{ from: string; to: string; distance: number }>;
}

export interface DMPersona {
  id: string;
  name: string;
  description: string;
  getInstruction: (password: string, version?: '2.0' | '3.0') => string;
}
