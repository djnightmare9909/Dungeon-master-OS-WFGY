
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
import { Type, GenerateContentResponse } from '@google/genai';
import {
  isGeneratingData,
  setGeneratingData,
  getCurrentChat,
  saveChatHistoryToDB,
  getUserContext,
  saveUserContextToDB,
  getChatHistory,
  dbSet,
  getUISettings
} from './state';
import {
  updateSheetBtn,
  updateAchievementsBtn,
  characterSheetDisplay,
  achievementsDisplay,
  updateInventoryBtn,
  inventoryDisplay,
  updateQuestsBtn,
  questsDisplay,
  updateNpcsBtn,
  npcsDisplay,
  generateImageBtn,
  characterImagePlaceholder,
  characterImageLoading,
  characterImageDisplay,
  inventoryPopupContent,
  diceResultsLog,
  diceTotalValue,
  diceGrid,
  themeGrid,
  contextList,
  renderCharacterSheet, 
  renderAchievements, 
  renderUserContext, 
  updateLogbook,
  appendMessage
} from './ui';
import { ai, generateEmbedding, getChroniclerPrompt } from './gemini';
import { 
  calculateCosineSimilarity, 
  retryOperation,
  calculateSemanticTension,
  calculateScarPotential,
  updateVectorBBPF,
  euclideanDistanceSquared
} from './utils';
import type { CharacterSheetData, Achievement, NPCState, SemanticNode, Scar, Message, ChatSession, ActiveEncounters, ProgressClock, Faction } from './types';

// =================================================================================
// TTS (Re-architected for stability)
// =================================================================================

// --- State Management ---
let ttsState: 'IDLE' | 'PLAYING' | 'PAUSED' = 'IDLE';
let ttsQueue: SpeechSynthesisUtterance[] = [];
let ttsCurrentUtteranceIndex = 0;
let ttsCurrentButton: HTMLButtonElement | null = null;
let ttsVoices: SpeechSynthesisVoice[] = [];
// Generation counter to prevent race conditions from stale async callbacks.
let ttsGeneration = 0;

// --- Defensive Voice Loading ---
// Memoize the promise to avoid re-running this logic on every click
let voicesPromise: Promise<SpeechSynthesisVoice[]> | null = null;
function getAvailableVoices(): Promise<SpeechSynthesisVoice[]> {
    if (voicesPromise) {
        return voicesPromise;
    }
    voicesPromise = new Promise((resolve, reject) => {
        // Set a timeout in case the browser never fires the event.
        const timeout = setTimeout(() => {
            if (speechSynthesis.getVoices().length > 0) {
              resolve(speechSynthesis.getVoices());
            } else {
              // Fallback: resolve with empty array rather than rejecting, 
              // so the app doesn't crash if TTS isn't supported/ready.
              resolve([]);
            }
        }, 2000);

        const checkVoices = () => {
            const voices = speechSynthesis.getVoices();
            if (voices.length > 0) {
                clearTimeout(timeout);
                ttsVoices = voices;
                resolve(voices);
                // Important: remove the listener once voices are loaded.
                speechSynthesis.onvoiceschanged = null;
            }
        };

        if (speechSynthesis.getVoices().length > 0) {
            checkVoices();
        } else {
            speechSynthesis.onvoiceschanged = checkVoices;
        }
    });
    return voicesPromise;
}
// Pre-warm the voices when the module loads.
getAvailableVoices().catch(err => console.warn(err));


// --- Core Functions ---
function updateTTS_UI() {
    if (!ttsCurrentButton) return;

    const soundWave = ttsCurrentButton.nextElementSibling as HTMLElement;
    const playIcon = ttsCurrentButton.querySelector('.play-icon') as SVGElement;
    const pauseIcon = ttsCurrentButton.querySelector('.pause-icon') as SVGElement;

    if (ttsState === 'PLAYING') {
        soundWave.classList.add('playing');
        playIcon.style.display = 'none';
        pauseIcon.style.display = 'block';
    } else { // PAUSED or IDLE
        soundWave.classList.remove('playing');
        playIcon.style.display = 'block';
        pauseIcon.style.display = 'none';
    }
}

/**
 * Aggressively stops all TTS, cleans up state, and resets the UI of the
 * currently active button. This is the primary function for ensuring a clean slate.
 */
export function stopTTS() {
    // Invalidate all old callbacks by incrementing the generation counter.
    // This is the most important step to prevent race conditions.
    ttsGeneration++;

    // This is a critical workaround for a common browser bug.
    // If speech is paused and then cancelled, the engine can get stuck.
    // Resuming it for a moment before cancelling forces it into a clean state.
    if (speechSynthesis.paused) {
        speechSynthesis.resume();
    }
    
    // Cancel any speaking or pending utterances.
    // This will trigger 'onend' or 'onerror' with a 'canceled' error,
    // which our handlers will now safely ignore due to the generation check.
    if (speechSynthesis.speaking || speechSynthesis.pending) {
        speechSynthesis.cancel();
    }
    
    // Reset the UI of the previously active button, if it exists.
    if (ttsCurrentButton) {
        const soundWave = ttsCurrentButton.nextElementSibling as HTMLElement;
        const playIcon = ttsCurrentButton.querySelector('.play-icon') as SVGElement;
        const pauseIcon = ttsCurrentButton.querySelector('.pause-icon') as SVGElement;
        
        if (soundWave && playIcon && pauseIcon) {
            soundWave.classList.remove('playing');
            playIcon.style.display = 'block';
            pauseIcon.style.display = 'none';
        }
    }

    // Reset all state variables to idle.
    ttsState = 'IDLE';
    ttsQueue = [];
    ttsCurrentUtteranceIndex = 0;
    ttsCurrentButton = null;
}

function playQueue(generation: number) {
    // If the generation is stale, this playback has been cancelled. Abort.
    if (generation !== ttsGeneration) return;

    if (ttsQueue.length === 0 || ttsCurrentUtteranceIndex >= ttsQueue.length) {
        stopTTS();
        return;
    }
    
    ttsState = 'PLAYING';
    updateTTS_UI();
    const utterance = ttsQueue[ttsCurrentUtteranceIndex];
    speechSynthesis.speak(utterance);
}

function handleUtteranceEnd(generation: number) {
    // If the generation is stale, this playback has been cancelled. Abort.
    if (generation !== ttsGeneration) return;

    ttsCurrentUtteranceIndex++;
    playQueue(generation);
}

/**
 * Chunks text into manageable pieces for the speech synthesis engine.
 */
function chunkText(text: string, maxLength = 180): string[] {
    if (!text) return [];
    
    const chunks: string[] = [];
    const sentences = text.match(/[^.!?\n]+(?:[.!?\n]|$)/g) || [text];

    for (let sentence of sentences) {
        sentence = sentence.trim();
        if (sentence.length === 0) continue;
        if (sentence.length <= maxLength) {
            chunks.push(sentence);
            continue;
        }

        let currentChunk = '';
        const words = sentence.split(/\s+/);
        for (const word of words) {
            if ((currentChunk + ' ' + word).length > maxLength && currentChunk.length > 0) {
                chunks.push(currentChunk);
                currentChunk = word;
            } else {
                currentChunk = (currentChunk + ' ' + word).trim();
            }
        }
        if (currentChunk.length > 0) chunks.push(currentChunk);
    }
    return chunks;
}

/**
 * Main entry point for the TTS button click.
 */
export async function handleTTS(htmlContent: string, button: HTMLButtonElement) {
    const currentGeneration = ttsGeneration;

    // If clicking the same button that is currently active
    if (ttsCurrentButton === button) {
        if (ttsState === 'PLAYING') {
            speechSynthesis.pause();
            ttsState = 'PAUSED';
            updateTTS_UI();
        } else if (ttsState === 'PAUSED') {
            speechSynthesis.resume();
            ttsState = 'PLAYING';
            updateTTS_UI();
        }
        return;
    }

    // If clicking a new button, stop everything first.
    stopTTS();
    
    // Update the generation after stopTTS increments it, to ensure we own this sequence.
    // Wait, stopTTS increments generation. So the generation we captured at the start is now old.
    // We need to capture the NEW generation ID.
    const myGeneration = ttsGeneration; 

    ttsCurrentButton = button;
    // Strip HTML tags for speech
    const text = htmlContent.replace(/<[^>]*>/g, '');
    const chunks = chunkText(text);

    try {
        const voices = await getAvailableVoices();
        // Prefer a female voice, or Google US English, or default
        const voice = voices.find(v => v.name.includes('Google US English') || v.name.includes('Female')) || voices[0];

        ttsQueue = chunks.map(chunk => {
            const u = new SpeechSynthesisUtterance(chunk);
            if (voice) u.voice = voice;
            u.rate = 1.0;
            u.pitch = 1.0;
            u.onend = () => handleUtteranceEnd(myGeneration);
            u.onerror = (e) => {
                console.error("TTS Error", e);
                // Only stop if it wasn't a cancel event
                if (e.error !== 'canceled' && e.error !== 'interrupted') {
                    stopTTS();
                }
            };
            return u;
        });

        playQueue(myGeneration);

    } catch (e) {
        console.error("Failed to initialize TTS", e);
        stopTTS();
    }
}

// =================================================================================
// DICE ROLLER
// =================================================================================

export function renderDiceGrid() {
  const diceTypes = ['d4', 'd6', 'd8', 'd10', 'd12', 'd20', 'd100'];
  diceGrid.innerHTML = diceTypes.map(die => `
    <div class="die-item" data-die="${die}">
      <div class="die-visual ${die}">${die.substring(1)}</div>
      <div class="die-controls">
        <button class="minus">-</button>
        <input type="number" class="quantity-input" value="1" min="1" max="99">
        <button class="plus">+</button>
      </div>
    </div>
  `).join('');
}

export function rollDice(expression: string): { success: boolean; resultText: string; total: number } {
  try {
    // Basic parsing for "d20", "2d6", "1d8+2"
    const match = expression.match(/(\d*)d(\d+)(?:\s*([+-])\s*(\d+))?/i);
    if (!match) return { success: false, resultText: '', total: 0 };

    const count = parseInt(match[1] || '1', 10);
    const sides = parseInt(match[2], 10);
    const op = match[3];
    const modifier = parseInt(match[4] || '0', 10);

    if (count > 100) return { success: false, resultText: 'Too many dice!', total: 0 };

    let rolls = [];
    let subTotal = 0;
    for (let i = 0; i < count; i++) {
      const roll = Math.floor(Math.random() * sides) + 1;
      rolls.push(roll);
      subTotal += roll;
    }

    let total = subTotal;
    if (op === '+') total += modifier;
    if (op === '-') total -= modifier;

    const rollStr = `[${rolls.join(', ')}]`;
    const modStr = modifier > 0 ? ` ${op} ${modifier}` : '';
    const resultText = `Rolled ${count}d${sides}${modStr}: **${total}** ${rollStr}`;

    return { success: true, resultText, total };
  } catch (e) {
    return { success: false, resultText: '', total: 0 };
  }
}

export function handleDieRoll(dieItem: HTMLElement) {
  const dieType = dieItem.dataset.die; // e.g., "d20"
  const quantityInput = dieItem.querySelector('.quantity-input') as HTMLInputElement;
  const quantity = parseInt(quantityInput.value, 10) || 1;

  const visual = dieItem.querySelector('.die-visual');
  visual?.classList.add('rolling');
  setTimeout(() => visual?.classList.remove('rolling'), 500);

  const command = `${quantity}${dieType}`; // e.g. "2d20"
  const { success, resultText, total } = rollDice(command);

  if (success) {
    const p = document.createElement('p');
    p.innerHTML = resultText.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
    diceResultsLog.prepend(p);
    
    // Update running total
    const currentTotal = parseInt(diceTotalValue.textContent || '0', 10);
    diceTotalValue.textContent = String(currentTotal + total);
  }
}

export function clearDiceResults() {
    diceResultsLog.innerHTML = '';
    diceTotalValue.textContent = '0';
}

// =================================================================================
// LOGBOOK & DATA GENERATION
// =================================================================================

async function generateLogbookSection(section: 'sheet' | 'inventory' | 'quests' | 'npcs' | 'achievements') {
  const session = getCurrentChat();
  if (!session) return;

  // Construct a history string for context
  const historyText = session.messages
    .filter(m => !m.hidden && m.sender !== 'error' && m.sender !== 'system')
    .slice(-20) // Look at last 20 messages for context
    .map(m => `${m.sender.toUpperCase()}: ${m.text}`)
    .join('\n');

  let prompt = '';
  let schema: any = null;

  switch (section) {
    case 'sheet':
      prompt = `Based on the following chat history, generate a JSON object representing the user's character sheet (D&D 5e). Fill in as much detail as possible from context. If unknown, use defaults.
      History:
      ${historyText}`;
      schema = {
        type: Type.OBJECT,
        properties: {
          name: { type: Type.STRING },
          race: { type: Type.STRING },
          class: { type: Type.STRING },
          level: { type: Type.INTEGER },
          abilityScores: {
            type: Type.OBJECT,
            properties: {
              STR: { type: Type.OBJECT, properties: { score: { type: Type.INTEGER }, modifier: { type: Type.STRING } } },
              DEX: { type: Type.OBJECT, properties: { score: { type: Type.INTEGER }, modifier: { type: Type.STRING } } },
              CON: { type: Type.OBJECT, properties: { score: { type: Type.INTEGER }, modifier: { type: Type.STRING } } },
              INT: { type: Type.OBJECT, properties: { score: { type: Type.INTEGER }, modifier: { type: Type.STRING } } },
              WIS: { type: Type.OBJECT, properties: { score: { type: Type.INTEGER }, modifier: { type: Type.STRING } } },
              CHA: { type: Type.OBJECT, properties: { score: { type: Type.INTEGER }, modifier: { type: Type.STRING } } }
            }
          },
          armorClass: { type: Type.INTEGER },
          hitPoints: { type: Type.OBJECT, properties: { current: { type: Type.INTEGER }, max: { type: Type.INTEGER } } },
          speed: { type: Type.STRING },
          skills: { type: Type.ARRAY, items: { type: Type.OBJECT, properties: { name: { type: Type.STRING }, proficient: { type: Type.BOOLEAN } } } },
          featuresAndTraits: { type: Type.ARRAY, items: { type: Type.STRING } }
        }
      };
      break;
    case 'inventory':
      prompt = `Based on the chat history, list the character's inventory as a simple text list. Include quantities. History: ${historyText}`;
      break;
    case 'quests':
      prompt = `Based on the chat history, write a concise quest journal. List active quests and their current status. History: ${historyText}`;
      break;
    case 'npcs':
      prompt = `Identify the key NPCs met in the recent history. Return a JSON array.
      History: ${historyText}`;
      schema = {
          type: Type.ARRAY,
          items: {
              type: Type.OBJECT,
              properties: {
                  name: { type: Type.STRING },
                  description: { type: Type.STRING },
                  relationship: { type: Type.STRING, description: "Friendly, Hostile, Neutral, etc." }
              }
          }
      };
      break;
    case 'achievements':
      prompt = `Generate a list of 3-5 'achievements' or milestones the player has recently accomplished based on the history. Be creative. JSON format. History: ${historyText}`;
      schema = {
          type: Type.ARRAY,
          items: {
              type: Type.OBJECT,
              properties: {
                  name: { type: Type.STRING },
                  description: { type: Type.STRING }
              }
          }
      };
      break;
  }

  try {
    const response = await retryOperation(() => ai.models.generateContent({
      model: getUISettings().activeModel,
      contents: prompt,
      config: {
        responseMimeType: schema ? 'application/json' : 'text/plain',
        responseSchema: schema,
      }
    })) as GenerateContentResponse;

    const text = response.text || '';

    if (section === 'sheet') {
      session.characterSheet = JSON.parse(text) as CharacterSheetData;
    } else if (section === 'inventory') {
      session.inventory = text;
    } else if (section === 'quests') {
      session.questLog = text;
    } else if (section === 'npcs') {
        session.npcList = JSON.parse(text) as NPCState[];
    } else if (section === 'achievements') {
      session.achievements = JSON.parse(text) as Achievement[];
    }

    saveChatHistoryToDB();
    updateLogbook(session);

  } catch (error) {
    console.error(`Failed to update ${section}:`, error);
    alert(`Failed to update ${section}. API Error.`);
  }
}

export async function updateLogbookData(section: 'sheet' | 'inventory' | 'quests' | 'npcs' | 'achievements') {
  if (isGeneratingData()) return;
  setGeneratingData(true);

  const btnMap = {
    sheet: updateSheetBtn,
    inventory: updateInventoryBtn,
    quests: updateQuestsBtn,
    npcs: updateNpcsBtn,
    achievements: updateAchievementsBtn
  };
  const btn = btnMap[section];
  const originalText = btn.textContent;
  btn.textContent = 'Updating...';
  btn.disabled = true;

  try {
    await generateLogbookSection(section);
  } finally {
    btn.textContent = 'Updated!';
    setTimeout(() => {
        btn.textContent = originalText;
        btn.disabled = false;
    }, 2000);
    setGeneratingData(false);
  }
}

export async function generateCharacterImage() {
    const session = getCurrentChat();
    if (!session || isGeneratingData()) return;
    
    setGeneratingData(true);
    generateImageBtn.disabled = true;
    characterImagePlaceholder.classList.add('hidden');
    characterImageDisplay.classList.add('hidden');
    characterImageLoading.classList.remove('hidden');

    try {
        // 1. Generate a prompt for the image
        let description = "";
        if (typeof session.characterSheet === 'object' && session.characterSheet) {
            const s = session.characterSheet;
            description = `A ${s.race} ${s.class}, level ${s.level}. Features: ${s.featuresAndTraits?.slice(0,3).join(', ')}.`;
        } else {
            description = "A D&D adventurer.";
        }

        const promptResponse = await retryOperation(() => ai.models.generateContent({
            model: getUISettings().activeModel,
            contents: `Create a detailed visual description for an image generation model of this character: ${description}. The style should be digital fantasy art, detailed, dramatic lighting. Output ONLY the description.`,
        })) as GenerateContentResponse;
        
        const imagePrompt = promptResponse.text || description;

        // 2. Generate the Image using Imagen
        // Use 'any' as the response type for generateImages isn't explicitly imported
        const imageResponse = await retryOperation(() => ai.models.generateImages({
            model: 'imagen-4.0-generate-001', // Explicitly use Imagen
            prompt: imagePrompt,
            config: {
                numberOfImages: 1,
                aspectRatio: '1:1',
                outputMimeType: 'image/jpeg'
            }
        })) as any;

        const base64Image = imageResponse.generatedImages[0].image.imageBytes;
        const imageUrl = `data:image/jpeg;base64,${base64Image}`;

        session.characterImageUrl = imageUrl;
        saveChatHistoryToDB();
        updateLogbook(session);

    } catch (error) {
        console.error("Image generation failed:", error);
        alert("Failed to generate image. Please try again.");
        characterImagePlaceholder.classList.remove('hidden');
    } finally {
        characterImageLoading.classList.add('hidden');
        generateImageBtn.disabled = false;
        setGeneratingData(false);
    }
}

export async function fetchAndRenderInventoryPopup() {
    const session = getCurrentChat();
    if (!session) return;
    
    inventoryPopupContent.innerHTML = '<div class="placeholder">Checking bag...</div>';
    
    try {
        // Reuse the existing inventory logic or fetch new structured data
        // For the popup, we want a structured list if possible.
        // If session.inventory is text, we might need to parse it or ask AI to structure it.
        // To be fast, let's just ask AI for a quick JSON list.
        
        const historyText = session.messages
            .slice(-20)
            .map(m => `${m.sender}: ${m.text}`)
            .join('\n');

        const response = await retryOperation(() => ai.models.generateContent({
            model: 'gemini-2.5-flash', // Use Flash for speed in UI elements
            contents: `Based on this history, list the character's inventory items as a JSON list of strings. Be concise. History: ${historyText}`,
            config: {
                responseMimeType: 'application/json',
                responseSchema: {
                    type: Type.ARRAY,
                    items: { type: Type.STRING }
                }
            }
        })) as GenerateContentResponse;
        
        const items = JSON.parse(response.text || '[]');
        
        if (items.length === 0) {
            inventoryPopupContent.innerHTML = '<div class="placeholder">Bag is empty.</div>';
        } else {
            inventoryPopupContent.innerHTML = `
                <ul>
                    ${items.map((item: string) => `
                        <li>
                            <span class="inventory-item-name">${item}</span>
                            <button class="use-item-btn" data-item-name="${item.replace(/"/g, '&quot;')}">Use</button>
                        </li>
                    `).join('')}
                </ul>
            `;
        }

    } catch (error) {
        console.error("Inventory fetch failed:", error);
        inventoryPopupContent.innerHTML = `<div class="placeholder" style="color: var(--danger-color);">Failed to load inventory.</div>`;
    }
}

// =================================================================================
// WFGY-LITE: SEMANTIC MEMORY SYSTEM
// =================================================================================

export async function commitToSemanticMemory(text: string, importance: number = 0.5) {
    const session = getCurrentChat();
    if (!session) return;
    if (!session.semanticLog) session.semanticLog = [];

    try {
        // Rate limit protection: If embedding fails (e.g., 429), we just skip adding memory.
        // This prevents the game from crashing due to background tasks.
        const embedding = await generateEmbedding(text);
        const node: SemanticNode = {
            id: `mem-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            content: text,
            embedding: embedding,
            timestamp: Date.now(),
            importance: importance,
            parentId: null,
            childIds: [],
            edges: {}
        };
        session.semanticLog.push(node);
        saveChatHistoryToDB();
        // console.log("Committed to Semantic Tree:", text.substring(0, 30) + "...");
    } catch (e) {
        console.warn("Failed to commit to semantic memory (skipped):", e);
    }
}

export async function recallRelevantMemories(query: string, topK: number = 3): Promise<string[]> {
    const session = getCurrentChat();
    if (!session || !session.semanticLog || session.semanticLog.length === 0) return [];

    try {
        const queryEmbedding = await generateEmbedding(query);
        
        // Calculate cosine similarity for all nodes
        const scoredNodes = session.semanticLog.map(node => ({
            content: node.content,
            score: calculateCosineSimilarity(queryEmbedding, node.embedding) * (1 + node.importance * 0.1) // Weight by importance slightly
        }));

        // Sort descending
        scoredNodes.sort((a, b) => b.score - a.score);

        // Filter for reasonable relevance (e.g., > 0.4 similarity)
        const relevant = scoredNodes
            .filter(n => n.score > 0.45)
            .slice(0, topK)
            .map(n => n.content);
            
        return relevant;
    } catch (e) {
        console.warn("Memory recall failed (skipped):", e);
        return [];
    }
}


// =================================================================================
// EXPORT / IMPORT / THEME / ETC
// =================================================================================

export function exportChatToLocal(sessionId: string) {
    const session = getChatHistory().find(s => s.id === sessionId);
    if (!session) return;
    
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(session, null, 2));
    const downloadAnchorNode = document.createElement('a');
    downloadAnchorNode.setAttribute("href", dataStr);
    downloadAnchorNode.setAttribute("download", `dmos_export_${session.title.replace(/[^a-z0-9]/gi, '_')}.json`);
    document.body.appendChild(downloadAnchorNode);
    downloadAnchorNode.click();
    downloadAnchorNode.remove();
}

export function exportAllChats() {
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify({
        version: 2,
        chats: getChatHistory(),
        userContext: getUserContext()
    }, null, 2));
    const downloadAnchorNode = document.createElement('a');
    downloadAnchorNode.setAttribute("href", dataStr);
    downloadAnchorNode.setAttribute("download", `dmos_full_backup_${new Date().toISOString().split('T')[0]}.json`);
    document.body.appendChild(downloadAnchorNode);
    downloadAnchorNode.click();
    downloadAnchorNode.remove();
}

export async function handleImportAll(event: Event) {
    const input = event.target as HTMLInputElement;
    if (!input.files || input.files.length === 0) return;
    
    const file = input.files[0];
    const reader = new FileReader();
    
    reader.onload = async (e) => {
        try {
            const json = JSON.parse(e.target?.result as string);
            
            // Handle both single session export and full backup
            if (json.chats && Array.isArray(json.chats)) {
                // Full backup
                // Merge strategy: append new, don't overwrite existing IDs unless prompted?
                // For simplicity, we'll filter out duplicates by ID.
                const existingIds = new Set(getChatHistory().map(c => c.id));
                let importedCount = 0;
                
                for (const chat of json.chats) {
                    if (!existingIds.has(chat.id)) {
                        getChatHistory().push(chat);
                        importedCount++;
                    }
                }
                
                if (json.userContext && Array.isArray(json.userContext)) {
                    const currentContext = new Set(getUserContext());
                    json.userContext.forEach((c: string) => currentContext.add(c));
                    // Fix: Cannot assign to 'userContext' because it is an import.
                    // We need to use a mutator or direct array manipulation if exported as const.
                    // Since state.ts exports 'userContext' as 'let', we can't reassign it here directly via import.
                    // We must use the accessor or modify the array in place.
                    // state.ts exports it as 'export let userContext'.
                    // We'll clear and refill it to be safe, or add to it.
                    // Let's use a helper in state.ts ideally, but here we can just empty and push.
                    const newContextArray = Array.from(currentContext);
                    const stateContext = getUserContext();
                    stateContext.length = 0;
                    stateContext.push(...newContextArray);
                    saveUserContextToDB();
                }
                
                saveChatHistoryToDB();
                alert(`Imported ${importedCount} new chats.`);
                window.location.reload(); // Reload to render
                
            } else if (json.messages && Array.isArray(json.messages)) {
                // Single chat
                const existing = getChatHistory().find(c => c.id === json.id);
                if (existing) {
                    if (confirm(`Chat "${json.title}" already exists. Overwrite?`)) {
                        Object.assign(existing, json);
                        saveChatHistoryToDB();
                        window.location.reload();
                    }
                } else {
                    getChatHistory().push(json);
                    saveChatHistoryToDB();
                    window.location.reload();
                }
            } else {
                throw new Error("Invalid file format");
            }
            
        } catch (err) {
            console.error("Import failed", err);
            alert("Failed to import file. Invalid JSON.");
        }
    };
    
    reader.readAsText(file);
    input.value = ''; // Reset
}

export function addUserContext(text: string) {
    getUserContext().push(text);
    saveUserContextToDB();
    renderUserContext(getUserContext());
}

export function deleteUserContext(index: number) {
    getUserContext().splice(index, 1);
    saveUserContextToDB();
    renderUserContext(getUserContext());
}

// --- Theme Logic ---
const themes = [
  { id: 'high-fantasy-dark', name: 'High Fantasy (Dark)', palette: ['#131314', '#c5b358', '#e3e3e3'] },
  { id: 'high-fantasy-light', name: 'High Fantasy (Light)', palette: ['#fdf6e3', '#8b4513', '#3a2e2c'] },
  { id: 'dark-fantasy-crimson', name: 'Dark Fantasy Crimson', palette: ['#0a0a0a', '#b71c1c', '#d1d1d1'] },
  { id: 'classic-rpg-parchment', name: 'Classic RPG Parchment', palette: ['#4d3c2a', '#e5c100', '#d5c8b8'] },
  { id: 'cyberpunk-hud-advanced', name: 'Cyberpunk HUD', palette: ['#0d0221', '#00f0ff', '#c72cff'] },
  { id: 'cyberpunk-bladerunner', name: 'Blade Runner Neon', palette: ['#040a18', '#ff9900', '#90b4ce'] },
  { id: 'glitch-terminal', name: 'Glitch Terminal', palette: ['#000', '#fff', '#888'] },
  { id: 'glitch-terminal-crt', name: 'Retro CRT Terminal', palette: ['#000', '#e0e0e0', '#555'] },
  { id: 'hacker-terminal', name: 'Matrix Green', palette: ['#0d0d0d', '#00ff00', '#008000'] },
  { id: 'hacker-terminal-glitch', name: 'Hacker Glitch', palette: ['#0d0d0d', '#00ff00', '#ff3333'] },
  { id: 'hacker-terminal-amber', name: 'Retro Amber', palette: ['#000', '#ffb400', '#b37e00'] },
  { id: 'hacker-terminal-vault-tec', name: 'Vault-Tec Blue/Yellow', palette: ['#0a141f', '#ffe832', '#27bce0'] },
  { id: 'vampire-gothic-terminal', name: 'Vampire Gothic', palette: ['#050101', '#ff4d4d', '#e0baba'] },
  { id: 'text-adventure-dark', name: 'Minimalist Text Adventure', palette: ['#000', '#ccc', '#333'] },
  { id: 'outer-space-starship', name: 'Sci-Fi Starship', palette: ['#eef2f5', '#007bff', '#1c2a38'] },
  { id: 'outer-space-alert', name: 'Red Alert', palette: ['#3d0000', '#ff4444', '#ffdddd'] },
  { id: 'pirate-sea', name: 'Pirate Map', palette: ['#f0e5d1', '#008b8b', '#2a201c'] },
  { id: 'steampunk', name: 'Steampunk Brass', palette: ['#5a3e2b', '#d4ac0d', '#e6d8c9'] },
  { id: 'art-deco', name: 'BioShock Art Deco', palette: ['#0d2c2c', '#d4af37', '#c5b8a5'] },
  { id: 'solarpunk', name: 'Solarpunk Utopia', palette: ['#f0f5e6', '#ff9900', '#2b4138'] },
  { id: 'aquatic', name: 'Deep Sea', palette: ['#0a1f3a', '#33d4ff', '#bfeaff'] },
  { id: 'apocalyptic', name: 'Wasteland Log', palette: ['#3b3a35', '#a3955a', '#adaa9d'] },
  { id: '8-bit-arcade', name: '8-Bit Dungeon', palette: ['#000', '#00ffff', '#ff00ff'] },
  { id: 'celestial', name: 'Celestial Void', palette: ['#100f1a', '#d8b8ff', '#d8d8e8'] },
];

export function renderThemeCards() {
    themeGrid.innerHTML = themes.map(theme => `
        <div class="theme-card" data-theme="${theme.id}">
            <div class="theme-preview" style="background: ${theme.palette[0]}; border: 1px solid rgba(255,255,255,0.1);">
                <div class="palette-swatch" style="background: ${theme.palette[1]};"></div>
                <div class="palette-swatch" style="background: ${theme.palette[2]};"></div>
            </div>
            <div class="theme-name">${theme.name}</div>
        </div>
    `).join('');
}

export function applyTheme(themeId: string) {
    document.body.setAttribute('data-theme', themeId);
    dbSet('dm-os-theme', themeId);
    
    // Re-render cards to show selection state if we wanted to, 
    // but mostly we just update the body attr.
}

// --- File Helper ---
export function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => {
      const result = reader.result as string;
      // Remove Data-URL declaration (e.g. "data:image/png;base64,")
      const base64 = result.split(',')[1];
      resolve(base64);
    };
    reader.onerror = error => reject(error);
  });
}

// =================================================================================
// MEMORY COMPRESSION: STORY SUMMARIZER
// =================================================================================

/**
 * Periodically prunes the message history and creates a rolling summary.
 * This ensures the context window doesn't overflow while maintaining long-term memory.
 */
export async function pruneAndSummarizeHistory() {
  const session = getCurrentChat();
  if (!session || isGeneratingData()) return;

  const settings = getUISettings();
  const isFlash = settings.engineVariant === 'flash';
  
  // Tiered Budgeting: More aggressive pruning for Flash
  const triggerThreshold = isFlash ? 25 : 40;
  const bufferSize = isFlash ? 10 : 15;
  const archiveCount = triggerThreshold - bufferSize;

  if (session.messages.length < triggerThreshold) return;

  console.log(`Memory Compression Triggered (${isFlash ? 'Flash' : 'Pro'}): Archiving and summarizing old messages...`);

  try {
    // 1. Identify messages to prune
    const messagesToArchive = session.messages.slice(0, archiveCount);
    const remainingMessages = session.messages.slice(archiveCount);

    const archiveText = messagesToArchive
      .filter(m => !m.hidden && m.sender !== 'error' && m.sender !== 'system')
      .map(m => `${m.sender.toUpperCase()}: ${m.text}`)
      .join('\n');

    if (archiveText.trim()) {
        // 2. Commit to Semantic Memory (RAG) before deleting
        // This ensures the information is still retrievable even if not in the active window.
        await commitToSemanticMemory(`Archived History Chunk (${new Date().toLocaleDateString()}): \n${archiveText}`, 0.4);
        
        // 3. Generate a summary update using a fast model
        const currentSummary = session.storySummary || "The adventure has just begun.";
        const prompt = `
          You are a specialized story summarizer for a D&D campaign. 
          Your task is to integrate new events into an existing "Story Summary".
          
          EXISTING SUMMARY:
          ${currentSummary}
          
          NEW EVENTS TO ARCHIVE:
          ${archiveText}
          
          INSTRUCTIONS:
          - Create a single, cohesive, and concise paragraph that summarizes the entire story so far.
          - Focus on key plot points, character developments, and major locations.
          - Keep it under 350 words.
          - Maintain the tone of the adventure.
          
          NEW COHESIVE SUMMARY:
        `;

        const response = await retryOperation(() => ai.models.generateContent({
          model: 'gemini-2.5-flash', // Use Flash for speed/cost
          contents: prompt,
        })) as GenerateContentResponse;

        const newSummary = response.text || currentSummary;
        session.storySummary = newSummary;
    }

    // 4. Update the session messages
    session.messages = remainingMessages;

    // 5. Persist changes
    saveChatHistoryToDB();
    console.log("Memory Compression Complete. Context window reduced.");

  } catch (error) {
    console.warn("Memory compression failed (skipped):", error);
  }
}

// =================================================================================
// WFGY CORE: SEMANTIC AUDIT & COLLAPSE TRIGGER
// =================================================================================

/**
 * Runs the WFGY Semantic Audit on every turn.
 * Calculates ΔS, Ψ_scar, B_total, tracks Λ-Observer state, and triggers BBCR if needed.
 * @param userEmbedding Embedding vector of the user's message.
 * @param dmEmbedding Embedding vector of the DM's response.
 * @returns Promise<boolean> true if a collapse occurred.
 */
export async function runWFGYAudit(
  userEmbedding: number[],
  dmEmbedding: number[]
): Promise<boolean> {
  const session = getCurrentChat();
  if (!session) return false;

  // Initialize vectors if missing (latentStateEmbedding replaces currentVector)
  if (!session.latentStateEmbedding) {
    session.latentStateEmbedding = Array(768).fill(0).map(() => (Math.random() - 0.5) * 0.2);
  }
  // We'll keep scarLedger as before
  if (!session.scarLedger) session.scarLedger = [];
  if (!session.Bc) session.Bc = 0.85;
  if (!session.lambdaState) session.lambdaState = 'Convergent';
  if (!session.deltaSHistory) session.deltaSHistory = [];

  const deltaS = calculateSemanticTension(userEmbedding, dmEmbedding);
  const scarPot = calculateScarPotential(session.latentStateEmbedding, session.scarLedger);
  const B_total = deltaS + scarPot * 0.1;

  // Update deltaS history (keep last 10)
  session.deltaSHistory.push(deltaS);
  if (session.deltaSHistory.length > 10) session.deltaSHistory.shift();

  // Λ-Observer logic
  if (session.deltaSHistory.length >= 3) {
    // Compute linear trend using simple average slope
    const n = session.deltaSHistory.length;
    let sumX = 0,
      sumY = 0,
      sumXY = 0,
      sumX2 = 0;
    for (let i = 0; i < n; i++) {
      sumX += i;
      sumY += session.deltaSHistory[i];
      sumXY += i * session.deltaSHistory[i];
      sumX2 += i * i;
    }
    const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX) || 0;

    if (slope > 0.05) {
      session.lambdaState = 'Chaotic';
    } else if (slope < -0.05) {
      session.lambdaState = 'Convergent';
    } else {
      // Check variance to decide between Recursive and Divergent
      const mean = sumY / n;
      let variance = 0;
      for (let i = 0; i < n; i++) {
        variance += Math.pow(session.deltaSHistory[i] - mean, 2);
      }
      variance /= n;
      if (variance < 0.01) {
        session.lambdaState = 'Recursive';
      } else if (slope > 0) {
        session.lambdaState = 'Divergent';
      } else {
        session.lambdaState = 'Recursive';
      }
    }
  }

  // Collapse trigger
  if (B_total > session.Bc || session.lambdaState === 'Chaotic') {
    console.warn('WFGY COLLAPSE TRIGGERED!', { B_total, Bc: session.Bc, lambdaState: session.lambdaState });

    // Log Scar in the Ledger
    const scar: Scar = {
      vector: [...dmEmbedding],
      depth: 1.0 + 0.5 * (session.scarLedger.length || 0),
      timestamp: Date.now(),
      B_total: B_total,
    };
    session.scarLedger.push(scar);

    // Append hidden system message with collapse info
    const collapseMsg: Message = {
      sender: 'system',
      text: `[WFGY COLLAPSE]: Semantic Tension reached critical threshold (${B_total.toFixed(2)}). The world shudders as a Scar is formed in the latent space.`,
      hidden: true,
    };
    session.messages.push(collapseMsg);

    // Adjust Bc using online Bayesian moving average (simple exponential smoothing)
    session.Bc = session.Bc * 0.8 + B_total * 0.2;

    // "Rebirth" – move latent state away from the collapsed region
    // Shift away from the new scar using the same repulsion logic
    session.latentStateEmbedding = updateVectorBBPF(
      session.latentStateEmbedding,
      session.scarLedger,
      0.5 // stronger alpha to force divergence
    );

    saveChatHistoryToDB();
    return true;
  }

  // Normal update: move latent state according to BBPF (away from scars)
  session.latentStateEmbedding = updateVectorBBPF(
    session.latentStateEmbedding,
    session.scarLedger,
    0.3
  );

  saveChatHistoryToDB();
  return false;
}

// =================================================================================
// STATE CHANGE INTERCEPTOR & VALIDATOR
// =================================================================================

/**
 * Extracts <EXECUTE_STATE_CHANGE> tags from raw model response, validates each
 * requested state change against the current session state, applies valid changes,
 * and returns the cleaned narrative text.
 *
 * If any change is invalid, the function records a scar, throws an error, and
 * does NOT modify the session state.
 *
 * @param rawText The raw text output from the Gemini model.
 * @param session The current chat session.
 * @returns The narrative text with all <EXECUTE_STATE_CHANGE> tags removed.
 * @throws Error if any requested state change fails validation.
 */
export function interceptAndValidateModelResponse(
  rawText: string,
  session: ChatSession
): string {
  // Regular expression to find all <EXECUTE_STATE_CHANGE> tags (non‑greedy)
  const tagRegex = /<EXECUTE_STATE_CHANGE>(.*?)<\/EXECUTE_STATE_CHANGE>/gs;
  const matches = [...rawText.matchAll(tagRegex)];

  // If no tags, just return the raw text (no state changes)
  if (matches.length === 0) {
    return rawText;
  }

  try {
    // Parse all JSON objects from the tags
    const changes: any[] = [];
    for (const match of matches) {
      try {
        const jsonStr = match[1].trim();
        const parsed = JSON.parse(jsonStr);
        // Allow both single object and array
        if (Array.isArray(parsed)) {
          changes.push(...parsed);
        } else {
          changes.push(parsed);
        }
      } catch (e) {
        console.error('Failed to parse EXECUTE_STATE_CHANGE JSON:', e);
        throw new Error('Invalid JSON in state change tag.');
      }
    }

    // Validate each change against current session state
    for (const change of changes) {
      const { targetId, stat, operator, value } = change;
      if (!targetId || !stat || !operator || value === undefined) {
        throw new Error(`Missing required field in state change: ${JSON.stringify(change)}`);
      }

      // --- Validation logic ---
      if (targetId === 'player') {
        // Player character validation
        if (!session.characterSheet || typeof session.characterSheet !== 'object') {
          throw new Error('Cannot modify player: character sheet missing or invalid.');
        }
        if (stat === 'hp') {
          const currentHp = session.characterSheet.hitPoints?.current;
          const maxHp = session.characterSheet.hitPoints?.max;
          if (typeof currentHp !== 'number' || typeof maxHp !== 'number') {
            throw new Error('Player HP data missing.');
          }
          let newHp = currentHp;
          if (operator === '+') newHp = currentHp + value;
          else if (operator === '-') newHp = currentHp - value;
          else if (operator === '=') newHp = value;
          else throw new Error(`Invalid operator for hp: ${operator}`);
          if (newHp < 0 || newHp > maxHp) {
            throw new Error(`HP change would result in out-of-bounds value: ${newHp}`);
          }
        } else if (stat === 'condition') {
          // Conditions are arrays of strings
          if (!Array.isArray(session.characterSheet.conditions)) {
            // Initialize if missing
            session.characterSheet.conditions = [];
          }
          if (operator === 'add') {
            if (typeof value !== 'string') throw new Error('Condition must be a string');
          } else if (operator === 'remove') {
            if (typeof value !== 'string') throw new Error('Condition must be a string');
          } else {
            throw new Error(`Invalid operator for condition: ${operator}`);
          }
        } else {
          throw new Error(`Unsupported player stat: ${stat}`);
        }
      } else if (targetId === 'inventory') {
        // Inventory item quantity change
        if (!session.inventory) {
          throw new Error('Inventory data missing.');
        }
      } else {
        // Assume targetId is an NPC name (from active encounters)
        if (!session.activeEncounters) {
          throw new Error('Active encounters missing.');
        }
        const encounter = session.activeEncounters.find(e => e.entityId === targetId);
        if (!encounter) {
          throw new Error(`Target NPC "${targetId}" not found in active encounters.`);
        }
        if (stat === 'hp') {
          let newHp = encounter.currentHp;
          if (operator === '+') newHp += value;
          else if (operator === '-') newHp -= value;
          else if (operator === '=') newHp = value;
          else throw new Error(`Invalid operator for hp: ${operator}`);
          if (newHp < 0 || newHp > encounter.maxHp) {
            throw new Error(`HP change would result in out-of-bounds value: ${newHp}`);
          }
        } else if (stat === 'condition') {
          if (operator === 'add') {
            if (typeof value !== 'string') throw new Error('Condition must be a string');
          } else if (operator === 'remove') {
            if (typeof value !== 'string') throw new Error('Condition must be a string');
          } else {
            throw new Error(`Invalid operator for condition: ${operator}`);
          }
        } else {
          throw new Error(`Unsupported NPC stat: ${stat}`);
        }
      }
    }

    // --- Apply changes (now validated) ---
    for (const change of changes) {
      const { targetId, stat, operator, value } = change;
      if (targetId === 'player') {
        if (stat === 'hp') {
          const cs = session.characterSheet as CharacterSheetData;
          if (operator === '+') cs.hitPoints.current += value;
          else if (operator === '-') cs.hitPoints.current -= value;
          else if (operator === '=') cs.hitPoints.current = value;
        } else if (stat === 'condition') {
          const cs = session.characterSheet as CharacterSheetData;
          if (!cs.conditions) cs.conditions = [];
          if (operator === 'add' && !cs.conditions.includes(value)) {
            cs.conditions.push(value);
          } else if (operator === 'remove') {
            cs.conditions = cs.conditions.filter(c => c !== value);
          }
        }
      } else if (targetId === 'inventory') {
        console.log('Inventory change requested:', change);
      } else {
        // NPC
        const encounter = session.activeEncounters!.find(e => e.entityId === targetId)!;
        if (stat === 'hp') {
          if (operator === '+') encounter.currentHp += value;
          else if (operator === '-') encounter.currentHp -= value;
          else if (operator === '=') encounter.currentHp = value;
        } else if (stat === 'condition') {
          if (operator === 'add' && !encounter.conditions.includes(value)) {
            encounter.conditions.push(value);
          } else if (operator === 'remove') {
            encounter.conditions = encounter.conditions.filter(c => c !== value);
          }
        }
      }
    }

    // Persist changes to IndexedDB
    saveChatHistoryToDB();

    // Remove all <EXECUTE_STATE_CHANGE> tags from the raw text
    const cleanedText = rawText.replace(tagRegex, '').trim();

    return cleanedText;
  } catch (error: any) {
    const reason = error.message || 'Unknown validation error';
    recordValidationFailure(session, reason);

    // Append a hidden system message to the prompt history to guide regeneration
    if (!session.messages) session.messages = [];
    session.messages.push({
      sender: 'system',
      text: `[WFGY COLLAPSE]: Your previous response was rejected due to an illegal state change: ${reason}. You MUST regenerate the response without narrating final numbers and ensuring all <EXECUTE_STATE_CHANGE> tags are mathematically valid according to the character sheet and active encounters. Do NOT repeat the illegal move.`,
      hidden: true
    });

    throw error; // Re-throw to signal index.tsx to regenerate
  }
}

/**
 * Extracts <TOPOLOGY_GRAPH> tags from raw model response, parses the JSON,
 * and updates the session's currentSpatialGraph.
 */
export function extractSpatialTopology(rawText: string, session: ChatSession): string {
  const tagRegex = /<TOPOLOGY_GRAPH>(.*?)<\/TOPOLOGY_GRAPH>/gs;
  const match = tagRegex.exec(rawText);

  if (match) {
    try {
      const jsonStr = match[1].trim();
      const parsed = JSON.parse(jsonStr);
      if (Array.isArray(parsed)) {
        session.currentSpatialGraph = parsed;
        saveChatHistoryToDB();
        console.log("Spatial Topology Extracted:", parsed);
      }
    } catch (e) {
      console.error("Failed to parse TOPOLOGY_GRAPH JSON:", e);
    }
    // Clean the text by removing the tag
    return rawText.replace(tagRegex, '').trim();
  }

  return rawText;
}

/**
 * Runs the Chronicler's turn, incorporating MeRF reward calculation.
 */
export async function runChroniclerTurn(playerAction: string) {
  const session = getCurrentChat();
  if (!session) return;

  const settings = getUISettings();
  const isFlash = settings.engineVariant === 'flash';

  // Lazy Simulation: Throttle Chronicler in Flash mode
  if (isFlash) {
    const significantKeywords = ['travel', 'rest', 'wait', 'days', 'weeks', 'months', 'year', 'journey', 'arrive'];
    const isSignificant = significantKeywords.some(kw => playerAction.toLowerCase().includes(kw));
    const messageCount = session.messages.length;
    
    // Only run every 3 messages unless it's a significant event
    if (!isSignificant && messageCount % 3 !== 0) {
      console.log("[CHRONICLER] Skipping turn (Lazy Simulation active)");
      return;
    }
  }

  const currentState = {
    progressClocks: session.progressClocks || {},
    factions: session.factions || {}
  };

  try {
    const prompt = getChroniclerPrompt();
    const inputData = JSON.stringify({ currentState, playerAction });

    const response = await retryOperation(() => ai.models.generateContent({
      model: getUISettings().activeModel,
      contents: inputData,
      config: {
        systemInstruction: prompt,
        responseMimeType: 'application/json'
      }
    })) as GenerateContentResponse;

    const chroniclerOutput = JSON.parse(response.text || '{}');
    const newState = chroniclerOutput.newState;

    if (newState) {
      // MeRF Reward Calculation (Heuristics)
      const growth = estimateGrowth(newState, currentState);
      const novelty = estimateNovelty(newState, currentState, session.messages);
      const consistency = estimateConsistency(newState, currentState, session.messages);
      const tension = await computeSemanticTension(playerAction, chroniclerOutput.eventLog);

      const rIntrinsic = (growth + novelty + consistency) - tension;
      console.log(`[CHRONICLER MeRF] R_intrinsic: ${rIntrinsic.toFixed(2)} (G:${growth}, N:${novelty}, C:${consistency}, T:${tension.toFixed(2)})`);

      // Apply updates if reward is positive or at least not catastrophic
      if (rIntrinsic > -0.5) {
        if (newState.progressClocks) session.progressClocks = newState.progressClocks;
        if (newState.factions) session.factions = newState.factions;
        
        // Log the event
        if (chroniclerOutput.eventLog) {
          session.messages.push({
            sender: 'system',
            text: `[CHRONICLER]: ${chroniclerOutput.eventLog}`,
            hidden: true
          });
        }
        
        saveChatHistoryToDB();
      } else {
        console.warn("Chronicler action rejected due to low MeRF reward.");
      }
    }

  } catch (error) {
    console.error("Chronicler turn failed:", error);
  }
}

/**
 * Processes [INTENT: ...] tags for the Flash engine variant.
 * Offloads mechanical logic to the client side.
 */
export function processIntents(text: string): string {
  const intentRegex = /\[INTENT:\s*(\w+)\s*({.*?})?\]/g;
  let match;
  let processedText = text;

  while ((match = intentRegex.exec(text)) !== null) {
    const action = match[1];
    const paramsStr = match[2];
    let params = {};
    if (paramsStr) {
      try {
        params = JSON.parse(paramsStr);
      } catch (e) {
        console.error("Failed to parse intent params:", paramsStr);
      }
    }
    
    executeIntent(action, params);
    processedText = processedText.replace(match[0], '');
  }
  
  return processedText;
}

function executeIntent(action: string, params: any) {
  console.log(`[FLASH ENGINE] Executing Intent: ${action}`, params);
  
  const session = getCurrentChat();
  if (!session) return;

  switch (action) {
    case 'ATTACK': {
      const roll = Math.floor(Math.random() * 20) + 1;
      const bonus = params.bonus || 0;
      const total = roll + bonus;
      appendMessage({ 
        sender: 'system', 
        text: `[FLASH MECHANICS]: Attack roll for ${params.target || 'target'}: ${roll} + ${bonus} = ${total}`,
        hidden: false 
      });
      break;
    }
    case 'DAMAGE': {
      appendMessage({ 
        sender: 'system', 
        text: `[FLASH MECHANICS]: ${params.target || 'target'} takes ${params.amount} ${params.type || ''} damage.`,
        hidden: false 
      });
      break;
    }
    case 'CHECK': {
      const roll = Math.floor(Math.random() * 20) + 1;
      const dc = params.dc || 10;
      const success = roll >= dc;
      appendMessage({ 
        sender: 'system', 
        text: `[FLASH MECHANICS]: ${params.skill || 'Skill'} check (DC ${dc}): ${roll} -> ${success ? 'SUCCESS' : 'FAILURE'}`,
        hidden: false 
      });
      break;
    }
    case 'HEAL': {
      appendMessage({ 
        sender: 'system', 
        text: `[FLASH MECHANICS]: ${params.target || 'target'} is healed for ${params.amount} HP.`,
        hidden: false 
      });
      break;
    }
    case 'CONDITION': {
      appendMessage({ 
        sender: 'system', 
        text: `[FLASH MECHANICS]: ${params.target || 'target'} is now ${params.condition} for ${params.duration || '1 minute'}.`,
        hidden: false 
      });
      break;
    }
    default:
      console.warn(`Unknown intent action: ${action}`);
  }
}

function estimateGrowth(newState: any, oldState: any): number {
  let score = 0;
  // Growth: Clocks advancing towards completion
  for (const id in newState.progressClocks) {
    const oldClock = oldState.progressClocks[id];
    const newClock = newState.progressClocks[id];
    if (oldClock && newClock && newClock.current > oldClock.current) {
      score += 0.2;
    }
  }
  // Growth: Faction goals shifting
  for (const id in newState.factions) {
    const oldFaction = oldState.factions[id];
    const newFaction = newState.factions[id];
    if (oldFaction && newFaction && newFaction.goal !== oldFaction.goal) {
      score += 0.3;
    }
  }
  return Math.min(score, 1.0);
}

function estimateNovelty(newState: any, oldState: any, history: Message[]): number {
  // Simple heuristic: Are there new keys in clocks or factions?
  const oldClockKeys = Object.keys(oldState.progressClocks);
  const newClockKeys = Object.keys(newState.progressClocks);
  const addedClocks = newClockKeys.filter(k => !oldClockKeys.includes(k));
  
  return addedClocks.length > 0 ? 0.5 : 0.1;
}

function estimateConsistency(newState: any, oldState: any, history: Message[]): number {
  // Heuristic: Did values jump too much?
  let penalty = 0;
  for (const id in newState.progressClocks) {
    const oldClock = oldState.progressClocks[id];
    const newClock = newState.progressClocks[id];
    if (oldClock && newClock && (newClock.current - oldClock.current) > 2) {
      penalty += 0.2;
    }
  }
  return Math.max(1.0 - penalty, 0);
}

async function computeSemanticTension(action: string, event: string): Promise<number> {
  try {
    const actionEmb = await generateEmbedding(action);
    const eventEmb = await generateEmbedding(event);
    // Semantic Tension is high if the event is unrelated to the action
    const similarity = calculateCosineSimilarity(actionEmb, eventEmb);
    return 1.0 - similarity;
  } catch (e) {
    return 0.5;
  }
}

/**
 * If validation fails, record a scar in the ledger and throw an error to force regeneration.
 * (Called from within interceptAndValidateModelResponse on failure.)
 */
export function recordValidationFailure(session: ChatSession, reason: string) {
  if (!session.scarLedger) session.scarLedger = [];
  const scar: Scar = {
    vector: session.latentStateEmbedding || Array(768).fill(0),
    depth: 1.0 + 0.5 * (session.scarLedger.length || 0),
    timestamp: Date.now(),
    B_total: 1.0, // placeholder
  };
  session.scarLedger.push(scar);
  saveChatHistoryToDB();
  console.error(`Validation failed, scar recorded: ${reason}`);
}
