
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
import { Chat } from '@google/genai';
import {
  ChatSession,
  UISettings,
  SemanticNode,
  Scar,
  ProgressClock,
  Faction,
  Message,
  CharacterSheetData,
  Achievement,
  NPCState,
  GameSettings,
  ActiveEncounters,
  Ruleset,
} from './types';
import { RULESETS, DEFAULT_RULESET_ID } from './rulesets';

// =================================================================================
// STATE
// =================================================================================

let db: IDBDatabase;
export let chatHistory: ChatSession[] = [];
export let userContext: string[] = [];
let currentChatId: string | null = null;
let geminiChat: Chat | null = null;
let chroniclerChat: Chat | null = null;
let isSendingFlag = false;
let isGeneratingDataFlag = false;
let currentPersonaId: string = 'purist';
let uiSettings: UISettings = {
  enterToSend: true,
  fontSize: 'medium',
  experimentalUploadLimit: false,
  activeModel: 'gemini-2.5-flash',
  apiKey: '',
  localAiUrl: '',
  localAiModel: '',
  systemVersion: '2.0',
  engineVariant: 'pro',
  providerType: 'gemini',
  customEndpointUrl: '',
  customHeaderConfig: '',
};

// =================================================================================
// STATE ACCESSORS
// =================================================================================

export const getChatHistory = () => chatHistory;
export const getUserContext = () => userContext;
export const getCurrentChat = (): ChatSession | undefined =>
  chatHistory.find((s) => s.id === currentChatId);
export const setCurrentChatId = (id: string | null) => {
  currentChatId = id;
};
export const getGeminiChat = () => geminiChat;
export const setGeminiChat = (chat: Chat | null) => {
  geminiChat = chat;
};
export const getChroniclerChat = () => chroniclerChat;
export const setChroniclerChat = (chat: Chat | null) => {
  chroniclerChat = chat;
};
export const isSending = () => isSendingFlag;
export const setSending = (state: boolean) => {
  isSendingFlag = state;
};
export const isGeneratingData = () => isGeneratingDataFlag;
export const setGeneratingData = (state: boolean) => {
  isGeneratingDataFlag = state;
};
export const getCurrentPersonaId = () => currentPersonaId;
export const setCurrentPersonaId = (id: string) => {
  currentPersonaId = id;
};
export const getUISettings = () => uiSettings;
export const setUISettings = (settings: UISettings) => {
  uiSettings = settings;
};

export const getCurrentRuleset = (): Ruleset => {
  const session = getCurrentChat();
  const rulesetId = session?.rulesetId || DEFAULT_RULESET_ID;
  return RULESETS[rulesetId] || RULESETS[DEFAULT_RULESET_ID];
};

// =================================================================================
// DATABASE (INDEXEDDB)
// =================================================================================

export function initDB(): Promise<boolean> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('DM-OS-DB', 2); // Increment version for schema change
    request.onerror = () => {
      console.error('Error opening IndexedDB');
      reject(false);
    };
    request.onsuccess = () => {
      db = request.result;
      resolve(true);
    };
    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains('KeyValueStore')) {
        db.createObjectStore('KeyValueStore', { keyPath: 'key' });
      }
      // No automatic migration – existing data will be migrated on load
    };
  });
}

export function dbGet<T>(key: string): Promise<T | undefined> {
  return new Promise((resolve) => {
    if (!db) {
      console.error('DB not initialized!');
      return resolve(undefined);
    }
    const transaction = db.transaction(['KeyValueStore'], 'readonly');
    const store = transaction.objectStore('KeyValueStore');
    const request = store.get(key);
    request.onsuccess = () => {
      resolve(request.result?.value);
    };
    request.onerror = () => {
      console.error(`Error getting key ${key} from DB`);
      resolve(undefined);
    };
  });
}

export function dbSet(key: string, value: any): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!db) {
      console.error('DB not initialized!');
      return reject();
    }
    const transaction = db.transaction(['KeyValueStore'], 'readwrite');
    const store = transaction.objectStore('KeyValueStore');
    const request = store.put({ key, value });
    request.onsuccess = () => {
      resolve();
    };
    request.onerror = () => {
      console.error(`Error setting key ${key} in DB`);
      reject();
    };
  });
}

// =================================================================================
// MIGRATION (from any old structure to the latest ChatSession)
// =================================================================================

export function migrateAndValidateSession(session: any): ChatSession {
  const newSession: Partial<ChatSession> = {};

  // Basic fields
  newSession.id =
    typeof session.id === 'string' ? session.id : `chat-${Date.now()}-${Math.random()}`;
  newSession.title =
    typeof session.title === 'string' && session.title.trim() !== ''
      ? session.title
      : 'Untitled Adventure';
  newSession.createdAt = typeof session.createdAt === 'number' ? session.createdAt : Date.now();
  newSession.isPinned = typeof session.isPinned === 'boolean' ? session.isPinned : false;

  // Messages
  if (Array.isArray(session.messages)) {
    newSession.messages = session.messages.filter(
      (m: any) =>
        typeof m === 'object' &&
        m !== null &&
        typeof m.sender === 'string' &&
        typeof m.text === 'string'
    ) as Message[];
  } else {
    newSession.messages = [];
  }

  // Admin & persona
  newSession.adminPassword = typeof session.adminPassword === 'string' ? session.adminPassword : undefined;
  newSession.personaId = typeof session.personaId === 'string' ? session.personaId : 'purist';

  // Creation phase
  const validPhases = [
    'guided',
    'character_creation',
    'narrator_selection',
    'guided_password',
    'world_creation',
    'quick_start_selection',
    'quick_start_password',
  ];
  if (validPhases.includes(session.creationPhase)) {
    newSession.creationPhase = session.creationPhase;
  } else {
    newSession.creationPhase = false;
  }

  // Character sheet
  if (typeof session.characterSheet === 'object' && session.characterSheet !== null) {
    newSession.characterSheet = session.characterSheet as CharacterSheetData;
  } else if (typeof session.characterSheet === 'string') {
    newSession.characterSheet = session.characterSheet;
  } else {
    newSession.characterSheet = undefined;
  }

  // Inventory, image, quest log
  newSession.inventory = typeof session.inventory === 'string' ? session.inventory : '';
  newSession.characterImageUrl = typeof session.characterImageUrl === 'string' ? session.characterImageUrl : '';
  newSession.questLog = typeof session.questLog === 'string' ? session.questLog : '';

  // NPC list
  if (Array.isArray(session.npcList)) {
    newSession.npcList = session.npcList.filter(
      (npc: any) =>
        typeof npc === 'object' &&
        npc !== null &&
        typeof npc.name === 'string' &&
        typeof npc.description === 'string' &&
        typeof npc.relationship === 'string'
    ) as NPCState[];
  } else {
    newSession.npcList = [];
  }

  // Achievements
  if (Array.isArray(session.achievements)) {
    newSession.achievements = session.achievements.filter(
      (a: any) =>
        typeof a === 'object' &&
        a !== null &&
        typeof a.name === 'string' &&
        typeof a.description === 'string'
    ) as Achievement[];
  } else {
    newSession.achievements = [];
  }

  // Game settings
  const defaultSettings: GameSettings = {
    tone: 'heroic',
    narration: 'descriptive',
  };
  if (typeof session.settings === 'object' && session.settings !== null) {
    newSession.settings = { ...defaultSettings, ...session.settings };
  } else {
    newSession.settings = defaultSettings;
  }

  // Quick start characters
  if (Array.isArray(session.quickStartChars)) {
    newSession.quickStartChars = session.quickStartChars as CharacterSheetData[];
  } else {
    newSession.quickStartChars = undefined;
  }

  // Progress clocks & factions
  newSession.progressClocks =
    typeof session.progressClocks === 'object' && session.progressClocks !== null
      ? (session.progressClocks as { [id: string]: ProgressClock })
      : {};
  newSession.factions =
    typeof session.factions === 'object' && session.factions !== null
      ? (session.factions as { [id: string]: Faction })
      : {};

  // Semantic log – migrate old flat nodes to new graph structure
  if (Array.isArray(session.semanticLog)) {
    newSession.semanticLog = session.semanticLog.map((node: any) => {
      const newNode: SemanticNode = {
        id: node.id || `mem-${Date.now()}-${Math.random()}`,
        content: node.content || '',
        embedding: Array.isArray(node.embedding) ? node.embedding : [],
        timestamp: typeof node.timestamp === 'number' ? node.timestamp : Date.now(),
        importance: typeof node.importance === 'number' ? node.importance : 0.5,
        parentId: node.parentId !== undefined ? node.parentId : null,
        childIds: Array.isArray(node.childIds) ? node.childIds : [],
        edges: node.edges && typeof node.edges === 'object' ? node.edges : {},
        clusterLabel: node.clusterLabel,
      };
      return newNode;
    });
  } else {
    newSession.semanticLog = [];
  }

  // Story summary
  newSession.storySummary = typeof session.storySummary === 'string' ? session.storySummary : '';

  // Scar ledger
  if (Array.isArray(session.scarLedger)) {
    newSession.scarLedger = session.scarLedger as Scar[];
  } else {
    newSession.scarLedger = [];
  }

  // System version
  newSession.systemVersion = session.systemVersion === '3.0' ? '3.0' : '2.0';

  // Vectors
  newSession.currentVector = Array.isArray(session.currentVector) ? session.currentVector : undefined;
  newSession.prevVector = Array.isArray(session.prevVector) ? session.prevVector : undefined;

  // WFGY fields
  newSession.Bc = typeof session.Bc === 'number' ? session.Bc : 0.85;
  newSession.lambdaState = ['Convergent', 'Recursive', 'Divergent', 'Chaotic'].includes(
    session.lambdaState
  )
    ? session.lambdaState
    : 'Convergent';
  newSession.deltaSHistory = Array.isArray(session.deltaSHistory) ? session.deltaSHistory : [];

  // New HAM fields
  newSession.latentStateEmbedding = Array.isArray(session.latentStateEmbedding)
    ? session.latentStateEmbedding
    : undefined;

  // Active encounters
  if (Array.isArray(session.activeEncounters)) {
    newSession.activeEncounters = session.activeEncounters.filter(
      (enc: any) =>
        typeof enc === 'object' &&
        enc !== null &&
        typeof enc.entityId === 'string' &&
        typeof enc.currentHp === 'number' &&
        typeof enc.maxHp === 'number' &&
        Array.isArray(enc.conditions) &&
        typeof enc.armorClass === 'number' &&
        typeof enc.initiative === 'number'
    ) as ActiveEncounters[];
  } else {
    newSession.activeEncounters = [];
  }

  // Ruleset
  newSession.rulesetId = typeof session.rulesetId === 'string' ? session.rulesetId : DEFAULT_RULESET_ID;

  return newSession as ChatSession;
}

// =================================================================================
// DATA HYDRATION / PERSISTENCE
// =================================================================================

export async function loadChatHistoryFromDB() {
  const storedHistory = await dbGet<any[]>('dm-os-chat-history');
  const validated = (storedHistory || []).map(migrateAndValidateSession);
  // Mutate the array to maintain reference stability
  chatHistory.splice(0, chatHistory.length, ...validated);
}

export function saveChatHistoryToDB() {
  dbSet('dm-os-chat-history', chatHistory);
}

export async function loadUserContextFromDB() {
  const storedContext = await dbGet<string[]>('dm-os-user-context');
  const loadedContext = storedContext || [];
  // Mutate the array to maintain reference stability
  userContext.splice(0, userContext.length, ...loadedContext);
}

export function saveUserContextToDB() {
  dbSet('dm-os-user-context', userContext);
}

// =================================================================================
// SPREADING ACTIVATION TRAVERSAL
// =================================================================================

/**
 * Traverses the memory graph starting from a given node using spreading activation.
 * Returns all nodes reachable via edges with weight >= minWeight, up to maxDepth.
 * @param semanticLog - The array of SemanticNode objects from the chat session.
 * @param startNodeId - ID of the node to start from.
 * @param minWeight - Minimum edge weight to traverse.
 * @param maxDepth - Maximum graph distance (number of hops).
 * @returns Array of SemanticNode objects that form the localized subgraph.
 */
export function traverseMemoryGraph(
  semanticLog: SemanticNode[],
  startNodeId: string,
  minWeight: number,
  maxDepth: number
): SemanticNode[] {
  const nodeMap = new Map<string, SemanticNode>();
  for (const node of semanticLog) {
    nodeMap.set(node.id, node);
  }

  const startNode = nodeMap.get(startNodeId);
  if (!startNode) return [];

  const visited = new Set<string>();
  const result: SemanticNode[] = [];
  const queue: Array<{ nodeId: string; depth: number }> = [{ nodeId: startNodeId, depth: 0 }];

  while (queue.length > 0) {
    const { nodeId, depth } = queue.shift()!;
    if (visited.has(nodeId)) continue;
    visited.add(nodeId);

    const node = nodeMap.get(nodeId);
    if (node) result.push(node);

    if (depth >= maxDepth) continue;

    // Follow edges with sufficient weight
    for (const [targetId, weight] of Object.entries(node?.edges || {})) {
      if (weight >= minWeight && !visited.has(targetId)) {
        queue.push({ nodeId: targetId, depth: depth + 1 });
      }
    }

    // Optionally also follow childIds (if they represent hierarchy)
    for (const childId of node?.childIds || []) {
      if (!visited.has(childId)) {
        // You can assign a default weight (e.g., 1.0) for hierarchical links
        queue.push({ nodeId: childId, depth: depth + 1 });
      }
    }
  }

  return result;
}
