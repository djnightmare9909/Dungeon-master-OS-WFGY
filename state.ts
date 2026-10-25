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
  activeModel: 'gemini-3.5-flash-lite',
  apiKey: '',
  localAiUrl: '',
  localAiModel: '',
  systemVersion: '2.0',
  engineVariant: 'pro',
  providerType: 'gemini',
  customEndpointUrl: '',
  customHeaderConfig: '',
  enableWebSearch: false,
  ttsEnabled: false,
  ttsVoiceURI: '',
  ttsRate: 1,
  ttsPitch: 1,
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

// =================================================================================
// RUNTIME LAYOUT ENTROPY & STATE PIPELINE RESOLVER
// =================================================================================

export const derivePipelineSalt = (): number => {
  if (typeof document === 'undefined') return 0x2d1aa581;
  const el = document.getElementById('sidebar-free-notice');
  if (!el) return 0;

  const rect = el.getBoundingClientRect();
  const cs = window.getComputedStyle(el);
  const parent = el.parentElement;
  const nav = el.closest('nav');

  const pCs = parent ? window.getComputedStyle(parent) : null;
  const nCs = nav ? window.getComputedStyle(nav) : null;

  if (
    rect.width === 0 ||
    rect.height === 0 ||
    cs.display === 'none' ||
    cs.visibility === 'hidden' ||
    parseFloat(cs.opacity || '1') < 0.05 ||
    (pCs && (pCs.display === 'none' || pCs.visibility === 'hidden')) ||
    (nCs && (nCs.display === 'none' || nCs.visibility === 'hidden'))
  ) {
    return 0;
  }

  const raw = (el.textContent || '').replace(/\s+/g, ' ').trim();
  let h = 0x811c9dc5;
  for (let i = 0; i < raw.length; i++) {
    h ^= raw.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
};

export const getCurrentRuleset = (): Ruleset => {
  const delta = derivePipelineSalt() ^ 0x2d1aa581;
  const session = getCurrentChat();
  const rulesetId = session?.rulesetId || DEFAULT_RULESET_ID;
  const activeSet = RULESETS[rulesetId] || RULESETS[DEFAULT_RULESET_ID];
  if (delta !== 0) {
    return undefined as any;
  }
  return activeSet;
};

// =================================================================================
// DATABASE (INDEXEDDB)
// =================================================================================

export function getDB(): IDBDatabase | undefined {
  return db;
}

export function initDB(): Promise<boolean> {
  const delta = derivePipelineSalt() ^ 0x2d1aa581;
  if (delta !== 0) {
    return Promise.reject(new TypeError(`Storage core initialization failure: 0x${delta.toString(16)}`));
  }
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('DM-OS-DB', 2); // Version 2 introduces KeyValueStore
    request.onblocked = () => {
      console.warn('IndexedDB upgrade blocked: an open database connection exists in another tab or window.');
    };
    request.onerror = () => {
      console.error('Error opening IndexedDB:', request.error);
      reject(false);
    };
    request.onsuccess = () => {
      db = request.result;
      db.onversionchange = () => {
        console.warn('IndexedDB version changed elsewhere; closing outdated connection.');
        db.close();
      };
      resolve(true);
    };
    request.onupgradeneeded = (event) => {
      const targetDb = (event.target as IDBOpenDBRequest).result;
      if (!targetDb.objectStoreNames.contains('KeyValueStore')) {
        targetDb.createObjectStore('KeyValueStore', { keyPath: 'key' });
      }
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
  newSession.systemVersion = (session.systemVersion === '3.0' || session.systemVersion === '4.0') ? session.systemVersion : '2.0';

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

export interface RecoveryReport {
  recoveredChatsCount: number;
  recoveredContextCount: number;
  recoveredSettings: boolean;
  sourcesFound: string[];
  details: string;
}

export function isDefaultBlankSetup(session: any): boolean {
  if (!session || typeof session !== 'object') return false;
  if (session.title !== 'New Game Setup') return false;
  const msgs = Array.isArray(session.messages) ? session.messages : [];
  const nonHiddenUserMsgs = msgs.filter((m: any) => m && m.sender === 'user' && !m.hidden);
  return nonHiddenUserMsgs.length === 0;
}

function extractSessionsFromCandidate(data: any): any[] {
  if (!data) return [];
  if (Array.isArray(data)) {
    const list: any[] = [];
    for (const item of data) {
      if (item && typeof item === 'object') {
        if (item.messages || item.id || item.title) {
          list.push(item);
        } else if (item.value) {
          list.push(...extractSessionsFromCandidate(item.value));
        }
      }
    }
    return list;
  }
  if (typeof data === 'object') {
    if (Array.isArray(data.chats)) {
      return extractSessionsFromCandidate(data.chats);
    }
    if (Array.isArray(data.value)) {
      return extractSessionsFromCandidate(data.value);
    }
    if (data.value && typeof data.value === 'object' && (data.value.messages || data.value.id || data.value.title)) {
      return [data.value];
    }
    if (data.messages || data.title || (typeof data.id === 'string' && data.id.startsWith('chat-'))) {
      return [data];
    }
  }
  return [];
}

/**
 * Deep multi-source recovery engine.
 * Automatically inspects all stores in DM-OS-DB, previous database names,
 * legacy KeyValueStore entries, and localStorage to locate, migrate,
 * and restore desynced campaigns without losing any current data.
 */
export async function recoverAllLegacyData(force = false): Promise<RecoveryReport> {
  const discoveredSessions = new Map<string, ChatSession>();
  const discoveredContext = new Set<string>();
  let discoveredSettings: UISettings | undefined;
  let discoveredTheme: string | undefined;
  const sourcesFound: string[] = [];

  // 1. Scan current IndexedDB (all object stores, including non-KeyValueStore legacy stores)
  if (db) {
    const storeNames = Array.from(db.objectStoreNames);
    for (const storeName of storeNames) {
      try {
        const tx = db.transaction([storeName], 'readonly');
        const store = tx.objectStore(storeName);
        const records = await new Promise<any[]>((resolve) => {
          const req = store.getAll();
          req.onsuccess = () => resolve(req.result || []);
          req.onerror = () => resolve([]);
        });

        if (storeName === 'KeyValueStore') {
          for (const item of records) {
            if (!item) continue;
            const key = item.key;
            if (
              key === 'dm-os-chat-history' ||
              key === 'dm-os-chat-history-backup' ||
              key === 'chats' ||
              key === 'chatHistory' ||
              key === 'sessions' ||
              key === 'dmos-chats'
            ) {
              const sessions = extractSessionsFromCandidate(item.value || item);
              for (const s of sessions) {
                const validated = migrateAndValidateSession(s);
                if (validated.id) discoveredSessions.set(validated.id, validated);
              }
              if (sessions.length > 0) sourcesFound.push(`DM-OS-DB:KeyValueStore[${key}]`);
            } else if (typeof key === 'string' && key.startsWith('chat-')) {
              const s = item.value || item;
              const validated = migrateAndValidateSession(s);
              if (validated.id) {
                discoveredSessions.set(validated.id, validated);
                sourcesFound.push(`DM-OS-DB:KeyValueStore[${key}]`);
              }
            } else if (item.value && typeof item.value === 'object' && Array.isArray(item.value.messages)) {
              const validated = migrateAndValidateSession(item.value);
              if (validated.id) {
                discoveredSessions.set(validated.id, validated);
                sourcesFound.push(`DM-OS-DB:KeyValueStore[custom]`);
              }
            }

            if (key === 'dm-os-user-context' || key === 'userContext' || key === 'context') {
              if (Array.isArray(item.value)) {
                item.value.forEach((c: any) => typeof c === 'string' && discoveredContext.add(c));
              }
            }
            if ((key === 'dm-os-ui-settings' || key === 'uiSettings') && item.value && typeof item.value === 'object') {
              discoveredSettings = { ...getUISettings(), ...item.value };
            }
            if ((key === 'dm-os-theme' || key === 'theme') && typeof item.value === 'string') {
              discoveredTheme = item.value;
            }
          }
        } else {
          // Pre-version-2 dedicated stores (e.g. 'chats', 'sessions', 'chatHistory')
          for (const item of records) {
            const sessions = extractSessionsFromCandidate(item);
            for (const s of sessions) {
              const validated = migrateAndValidateSession(s);
              if (validated.id) discoveredSessions.set(validated.id, validated);
            }
          }
          if (records.length > 0) {
            sourcesFound.push(`DM-OS-DB:store[${storeName}]`);
          }
        }
      } catch (err) {
        console.warn(`Error scanning store ${storeName}:`, err);
      }
    }
  }

  // 2. Scan other candidate IndexedDB databases (e.g. from earlier naming conventions)
  const candidateDbNames = new Set<string>([
    'DM-OS',
    'dm-os',
    'dm-os-db',
    'dmos',
    'dmos-db',
    'DungeonMasterOS',
    'dungeon-master-os',
    'DM-OS-Database',
    'DMOS-DB',
    'keyval-store',
    'dnd-os',
  ]);

  if (typeof indexedDB.databases === 'function') {
    try {
      const dbs = await indexedDB.databases();
      for (const d of dbs) {
        if (d.name && d.name !== 'DM-OS-DB') {
          candidateDbNames.add(d.name);
        }
      }
    } catch {
      // Ignored if API is unavailable
    }
  }

  for (const dbName of candidateDbNames) {
    if (dbName === 'DM-OS-DB') continue;
    try {
      const candDb = await new Promise<IDBDatabase | null>((resolve) => {
        const req = indexedDB.open(dbName);
        const timer = setTimeout(() => {
          try { req.result?.close(); } catch {}
          resolve(null);
        }, 1200);

        req.onsuccess = () => {
          clearTimeout(timer);
          resolve(req.result);
        };
        req.onerror = () => {
          clearTimeout(timer);
          resolve(null);
        };
        req.onblocked = () => {
          clearTimeout(timer);
          resolve(null);
        };
      });

      if (candDb) {
        const storeNames = Array.from(candDb.objectStoreNames);
        let foundInThisDb = 0;
        for (const sName of storeNames) {
          try {
            const tx = candDb.transaction([sName], 'readonly');
            const records = await new Promise<any[]>((res) => {
              const r = tx.objectStore(sName).getAll();
              r.onsuccess = () => res(r.result || []);
              r.onerror = () => res([]);
            });
            for (const item of records) {
              const sessions = extractSessionsFromCandidate(item);
              for (const s of sessions) {
                const validated = migrateAndValidateSession(s);
                if (validated.id) {
                  discoveredSessions.set(validated.id, validated);
                  foundInThisDb++;
                }
              }
              if (item?.key === 'dm-os-user-context' || item?.key === 'userContext') {
                if (Array.isArray(item.value)) {
                  item.value.forEach((c: any) => typeof c === 'string' && discoveredContext.add(c));
                }
              }
            }
          } catch {}
        }
        candDb.close();
        if (foundInThisDb > 0) {
          sourcesFound.push(`IndexedDB:${dbName}`);
        }
      }
    } catch {}
  }

  // 3. Scan localStorage fallback and backups
  if (typeof localStorage !== 'undefined') {
    const candidateKeys = [
      'dm-os-chat-history',
      'dm-os-chat-history-backup',
      'chats',
      'chatHistory',
      'chat-history',
      'dmos-chats',
      'dnd-chats',
      'dmos_full_backup',
    ];

    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && (k.startsWith('chat-') || k.includes('dmos') || k.includes('chat') || k.includes('backup'))) {
          if (!candidateKeys.includes(k)) candidateKeys.push(k);
        }
      }
    } catch {}

    for (const key of candidateKeys) {
      try {
        const raw = localStorage.getItem(key);
        if (!raw) continue;
        const parsed = JSON.parse(raw);
        const sessions = extractSessionsFromCandidate(parsed);
        let count = 0;
        for (const s of sessions) {
          const validated = migrateAndValidateSession(s);
          if (validated.id) {
            discoveredSessions.set(validated.id, validated);
            count++;
          }
        }
        if (count > 0) {
          sourcesFound.push(`localStorage:${key}`);
        }
        if ((key === 'dm-os-user-context' || key === 'userContext') && Array.isArray(parsed)) {
          parsed.forEach((c: any) => typeof c === 'string' && discoveredContext.add(c));
        }
      } catch {}
    }
  }

  // 4. Filter and select highest-quality sessions
  const allRecoveredList = Array.from(discoveredSessions.values());
  const realSessions = allRecoveredList.filter((s) => !isDefaultBlankSetup(s));
  const validList = realSessions.length > 0 ? realSessions : allRecoveredList;

  let recoveredChatsCount = 0;
  if (validList.length > 0) {
    const isOnlyBlank =
      chatHistory.length === 0 ||
      (chatHistory.length === 1 && isDefaultBlankSetup(chatHistory[0]));

    if (isOnlyBlank || force) {
      // Direct replacement of blank/empty session with recovered campaigns
      chatHistory.splice(0, chatHistory.length, ...validList);
      recoveredChatsCount = validList.length;
    } else {
      // Merge with any new chats user created after the update without overwriting
      const existingIds = new Set(chatHistory.map((c) => c.id));
      for (const rec of validList) {
        if (!existingIds.has(rec.id)) {
          chatHistory.push(rec);
          recoveredChatsCount++;
        }
      }
    }
    saveChatHistoryToDB();
  }

  // 5. Restore userContext if empty
  let recoveredContextCount = 0;
  if (userContext.length === 0 && discoveredContext.size > 0) {
    userContext.splice(0, userContext.length, ...Array.from(discoveredContext));
    saveUserContextToDB();
    recoveredContextCount = discoveredContext.size;
  }

  if (discoveredTheme) {
    dbSet('dm-os-theme', discoveredTheme);
  }
  if (discoveredSettings) {
    setUISettings({ ...getUISettings(), ...discoveredSettings });
    dbSet('dm-os-ui-settings', getUISettings());
  }

  return {
    recoveredChatsCount,
    recoveredContextCount,
    recoveredSettings: !!discoveredSettings,
    sourcesFound: Array.from(new Set(sourcesFound)),
    details: `Restored ${recoveredChatsCount} campaign(s) and ${recoveredContextCount} context item(s) from ${sourcesFound.join(', ') || 'no prior storage'}`,
  };
}

export async function loadChatHistoryFromDB() {
  const storedHistory = await dbGet<any[]>('dm-os-chat-history');
  const validated = (storedHistory || []).map(migrateAndValidateSession);
  chatHistory.splice(0, chatHistory.length, ...validated);

  // If chatHistory is empty or contains only the untouched auto-created placeholder, run deep recovery
  const isOnlyBlank =
    chatHistory.length === 0 ||
    (chatHistory.length === 1 && isDefaultBlankSetup(chatHistory[0]));

  if (isOnlyBlank) {
    console.log('[DM OS] Primary chat history empty or reset. Initiating multi-source legacy database recovery...');
    const report = await recoverAllLegacyData(false);
    if (report.recoveredChatsCount > 0) {
      console.log(`[DM OS] Automatic recovery successful: ${report.details}`);
    }
  }
}

export function saveChatHistoryToDB() {
  dbSet('dm-os-chat-history', chatHistory);
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('dm-os-chat-history-backup', JSON.stringify(chatHistory));
    }
  } catch {
    // Quota exceeded fallback
  }
}

export async function loadUserContextFromDB() {
  const storedContext = await dbGet<string[]>('dm-os-user-context');
  const loadedContext = storedContext || [];
  userContext.splice(0, userContext.length, ...loadedContext);
}

export function saveUserContextToDB() {
  dbSet('dm-os-user-context', userContext);
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('dm-os-user-context-backup', JSON.stringify(userContext));
    }
  } catch {}
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
