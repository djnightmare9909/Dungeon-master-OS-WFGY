
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
import type { ChatSession, GameSettings, Message, CharacterSheetData, Achievement, NPCState, ProgressClock, Faction, SemanticNode, Scar } from './types';

/**
 * Takes any object and safely migrates it into a valid ChatSession object.
 * This is the core of the app's backwards compatibility and data integrity strategy.
 * It provides default values for any missing fields and attempts to coerce incorrect data types.
 * @param session An object of unknown structure, potentially an old or incomplete chat session.
 * @returns A fully-formed, valid ChatSession object.
 */
export function migrateAndValidateSession(session: any): ChatSession {
  const newSession: Partial<ChatSession> = {};

  newSession.id = typeof session.id === 'string' ? session.id : `chat-${Date.now()}-${Math.random()}`;
  newSession.title = typeof session.title === 'string' && session.title.trim() !== '' ? session.title : 'Untitled Adventure';
  newSession.createdAt = typeof session.createdAt === 'number' ? session.createdAt : Date.now();
  newSession.isPinned = typeof session.isPinned === 'boolean' ? session.isPinned : false;

  if (Array.isArray(session.messages)) {
    newSession.messages = session.messages.filter((m: any) =>
      typeof m === 'object' && m !== null &&
      typeof m.sender === 'string' &&
      typeof m.text === 'string'
    ) as Message[];
  } else {
    newSession.messages = [];
  }

  newSession.adminPassword = typeof session.adminPassword === 'string' ? session.adminPassword : undefined;
  newSession.personaId = typeof session.personaId === 'string' ? session.personaId : 'purist';

  if (
    session.creationPhase === 'guided' ||
    session.creationPhase === 'character_creation' ||
    session.creationPhase === 'character_upload' ||
    session.creationPhase === 'narrator_selection' ||
    session.creationPhase === 'guided_password' ||
    session.creationPhase === 'world_creation' ||
    session.creationPhase === 'quick_start_selection' ||
    session.creationPhase === 'quick_start_password'
    ) {
    newSession.creationPhase = session.creationPhase;
  } else {
    newSession.creationPhase = false;
  }

  if (typeof session.characterSheet === 'object' && session.characterSheet !== null) {
    newSession.characterSheet = session.characterSheet as CharacterSheetData;
  } else if (typeof session.characterSheet === 'string') {
    newSession.characterSheet = session.characterSheet;
  } else {
    newSession.characterSheet = undefined;
  }

  newSession.inventory = typeof session.inventory === 'string' ? session.inventory : '';
  newSession.characterImageUrl = typeof session.characterImageUrl === 'string' ? session.characterImageUrl : '';
  newSession.questLog = typeof session.questLog === 'string' ? session.questLog : '';
  
  if (Array.isArray(session.npcList)) {
    newSession.npcList = session.npcList.filter((npc: any) => 
        typeof npc === 'object' && npc !== null &&
        typeof npc.name === 'string' &&
        typeof npc.description === 'string' &&
        typeof npc.relationship === 'string'
    ) as NPCState[];
  } else {
    newSession.npcList = [];
  }


  if (Array.isArray(session.achievements)) {
    newSession.achievements = session.achievements.filter((a: any) =>
      typeof a === 'object' && a !== null &&
      typeof a.name === 'string' &&
      typeof a.description === 'string'
    ) as Achievement[];
  } else {
    newSession.achievements = [];
  }

  const defaultSettings: GameSettings = {
    tone: 'heroic',
    narration: 'descriptive',
  };
  if (typeof session.settings === 'object' && session.settings !== null) {
    newSession.settings = { ...defaultSettings, ...session.settings };
  } else {
    newSession.settings = defaultSettings;
  }

  if (Array.isArray(session.quickStartChars)) {
    newSession.quickStartChars = session.quickStartChars as CharacterSheetData[];
  } else {
    newSession.quickStartChars = undefined;
  }

  newSession.progressClocks = typeof session.progressClocks === 'object' && session.progressClocks !== null ? session.progressClocks as { [id: string]: ProgressClock } : {};
  newSession.factions = typeof session.factions === 'object' && session.factions !== null ? session.factions as { [id: string]: Faction } : {};

  // Initialize semanticLog if missing
  if (Array.isArray(session.semanticLog)) {
    newSession.semanticLog = session.semanticLog as SemanticNode[];
  } else {
    newSession.semanticLog = [];
  }

  newSession.storySummary = typeof session.storySummary === 'string' ? session.storySummary : '';

  newSession.scarLedger = Array.isArray(session.scarLedger) ? session.scarLedger : [];
  newSession.currentVector = Array.isArray(session.currentVector) ? session.currentVector : undefined;
  newSession.prevVector = Array.isArray(session.prevVector) ? session.prevVector : undefined;
  newSession.Bc = typeof session.Bc === 'number' ? session.Bc : 0.85;
  newSession.lambdaState = (['Convergent', 'Recursive', 'Divergent', 'Chaotic'].includes(session.lambdaState)) ? session.lambdaState : 'Convergent';
  newSession.deltaSHistory = Array.isArray(session.deltaSHistory) ? session.deltaSHistory : [];

  return newSession as ChatSession;
}

/**
 * Calculates the cosine similarity between two vectors.
 * @param vecA First vector.
 * @param vecB Second vector.
 * @returns A score between -1 and 1, where 1 is identical.
 */
export function calculateCosineSimilarity(vecA: number[], vecB: number[]): number {
    if (vecA.length !== vecB.length) {
        console.warn("Vectors have different lengths in cosine similarity calculation.");
        return 0;
    }
    let dotProduct = 0;
    let normA = 0;
    let normB = 0;
    for (let i = 0; i < vecA.length; i++) {
        dotProduct += vecA[i] * vecB[i];
        normA += vecA[i] * vecA[i];
        normB += vecB[i] * vecB[i];
    }
    if (normA === 0 || normB === 0) return 0;
    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

/**
 * WFGY Math: Semantic Tension (ΔS)
 * ΔS = 1 - cos(I, G)
 */
export function calculateSemanticTension(vecA: number[], vecB: number[]): number {
  const similarity = calculateCosineSimilarity(vecA, vecB);
  return 1 - similarity;
}

/**
 * Euclidean distance squared between two vectors.
 */
export function euclideanDistanceSquared(a: number[], b: number[]): number {
  if (a.length !== b.length) return Infinity;
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    const diff = a[i] - b[i];
    sum += diff * diff;
  }
  return sum;
}

/**
 * WFGY Math: Scar Potential (Ψ_scar)
 * Ψ_scar(x) = Σ D_k / (||x - x_k||² + ε)
 * Capped at 100.0 to prevent Infinity.
 */
export function calculateScarPotential(x: number[], scarLedger: Scar[]): number {
  if (!scarLedger || scarLedger.length === 0) return 0;
  const epsilon = 1e-6;
  let potential = 0;
  for (const scar of scarLedger) {
    const distSq = euclideanDistanceSquared(x, scar.vector);
    potential += scar.depth / (distSq + epsilon);
  }
  return Math.min(potential, 100.0);
}

/**
 * WFGY Math: BBPF Update Rule
 * x_{t+1} = x_t - α ∇Ψ_scar(x)   (deterministic repulsion from nearest scar)
 * Where ∇Ψ_scar(x) for the nearest scar = -2 * depth * (x - x_k) / (||x - x_k||²)²
 */
export function updateVectorBBPF(
  x: number[],
  scarLedger: Scar[],
  alpha: number = 0.3
): number[] {
  if (!x || x.length === 0) return Array(768).fill(0).map(() => (Math.random() - 0.5) * 0.2);
  if (scarLedger.length === 0) return x; // no scars, no change

  // Find nearest scar (by Euclidean distance)
  let nearestScar: Scar | null = null;
  let minDistSq = Infinity;
  for (const scar of scarLedger) {
    if (scar.vector.length !== x.length) continue;
    const distSq = euclideanDistanceSquared(x, scar.vector);
    if (distSq < minDistSq) {
      minDistSq = distSq;
      nearestScar = scar;
    }
  }

  if (!nearestScar) return x; // no compatible scar

  const newX = [...x];
  const epsilon = 1e-6;
  const distSq = Math.max(minDistSq, epsilon); // avoid division by zero
  const depth = nearestScar.depth;

  // Compute gradient of Ψ for this scar: ∇Ψ = -2 * depth * (x - x_k) / (distSq)^2
  // We want to move opposite to gradient (i.e., -α ∇Ψ) = +α * 2 * depth * (x - x_k) / distSq^2
  const factor = (alpha * 2 * depth) / (distSq * distSq);
  for (let i = 0; i < x.length; i++) {
    const diff = x[i] - nearestScar.vector[i];
    newX[i] = x[i] + factor * diff; // move away from scar
  }

  // Normalize to prevent explosion (optional, keep same norm as before)
  const normOld = Math.sqrt(x.reduce((sum, v) => sum + v * v, 0)) || 1;
  const normNew = Math.sqrt(newX.reduce((sum, v) => sum + v * v, 0)) || 1;
  const scale = normOld / normNew;
  for (let i = 0; i < x.length; i++) {
    newX[i] *= scale;
  }

  return newX;
}

/**
 * Retries an async operation with exponential backoff.
 * Useful for handling API rate limits (429 errors).
 * @param operation A function that returns a promise.
 * @param maxRetries Maximum number of retries.
 * @param baseDelay Base delay in milliseconds.
 */
export async function retryOperation<T>(operation: () => Promise<T>, maxRetries = 3, baseDelay = 2000): Promise<T> {
  let lastError: any;
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await operation();
    } catch (error: any) {
      lastError = error;
      // Check for various 429 signatures (status code, error code, or message content)
      const isRateLimit = 
        error.status === 429 || 
        error.code === 429 || 
        (error.message && (error.message.includes('429') || error.message.includes('quota') || error.message.includes('Too Many Requests')));
      
      if (isRateLimit) {
        const delay = baseDelay * Math.pow(2, i);
        console.warn(`Rate limit hit. Retrying in ${delay}ms... (Attempt ${i + 1}/${maxRetries})`);
        await new Promise(resolve => setTimeout(resolve, delay));
        continue;
      }
      throw error; // Not a rate limit error, rethrow immediately
    }
  }
  throw lastError;
}
