
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
// Fix: Improved the 'generateContent' call for creating quick start characters by adding a 'responseSchema' to ensure valid JSON output.
import { Type, GenerateContentResponse } from '@google/genai';

import {
  initDB,
  loadChatHistoryFromDB,
  loadUserContextFromDB,
  getChatHistory,
  getCurrentChat,
  setCurrentChatId,
  saveChatHistoryToDB,
  getGeminiChat,
  setGeminiChat,
  getUserContext,
  saveUserContextToDB,
  isSending,
  setSending,
  isGeneratingData,
  getCurrentPersonaId,
  setCurrentPersonaId,
  getUISettings,
  setUISettings,
  chatHistory,
  dbGet,
  dbSet,
  getChroniclerChat,
  setChroniclerChat,
  getCurrentRuleset,
} from './state';
import {
  chatContainer,
  chatForm,
  chatInput,
  sendButton,
  menuBtn,
  newChatBtn,
  overlay,
  exportAllBtn,
  importAllBtn,
  importAllFileInput,
  contextForm,
  contextInput,
  contextList,
  inventoryBtn,
  inventoryPopup,
  closeInventoryBtn,
  refreshInventoryBtn,
  helpBtn,
  helpModal,
  closeHelpBtn,
  dndHelpBtn,
  dndHelpModal,
  closeDndHelpBtn,
  renameModal,
  renameForm,
  renameInput,
  closeRenameBtn,
  deleteConfirmModal,
  closeDeleteConfirmBtn,
  cancelDeleteBtn,
  confirmDeleteBtn,
  deleteChatName,
  diceRollerBtn,
  diceModal,
  closeDiceBtn,
  diceGrid,
  clearResultsBtn,
  logbookBtn,
  logbookModal,
  closeLogbookBtn,
  logbookNav,
  logbookPanes,
  updateSheetBtn,
  updateInventoryBtn,
  updateQuestsBtn,
  updateNpcsBtn,
  updateAchievementsBtn,
  generateImageBtn,
  fontSizeControls,
  enterToSendToggle,
  experimentalUploadToggle,
  modelSelect,
  modelCustomInput,
  systemVersionSelect,
  engineVariantSelect,
  rulesetSelect,
  apiKeyInput,
  localAiUrlInput,
  localAiModelInput,
  saveApiKeyBtn,
  changeUiBtn,
  themeModal,
  closeThemeBtn,
  themeGrid,
  chatOptionsMenu,
  toggleSidebar,
  closeSidebar,
  openModal,
  closeModal,
  applyUISettings,
  renderChatHistory,
  openChatOptionsMenu,
  closeChatOptionsMenu,
  appendMessage,
  renderMessages,
  updateLogbook,
  renderQuickStartChoices,
  renderSetupChoices,
  quickActionsBar,
  inventoryPopupContent,
  renderUserContext,
  chatHistoryContainer,
  updateCombatTracker,
  combatTracker,
  combatTrackerHeader,
  welcomeModal,
  closeWelcomeBtn,
  fileUploadBtn,
  fileUploadInput,
  appendFileProcessingMessage,
  contextManager,
  contextHeader,
  renderLogbookTree,
} from './ui';
import {
  addUserContext,
  deleteUserContext,
  handleDieRoll,
  rollDice,
  updateLogbookData,
  generateCharacterImage,
  fetchAndRenderInventoryPopup,
  exportChatToLocal,
  exportAllChats,
  handleImportAll,
  applyTheme,
  clearDiceResults,
  renderDiceGrid,
  renderThemeCards,
  fileToBase64,
  recallRelevantMemories,
  commitToSemanticMemory,
  pruneAndSummarizeHistory,
  runWFGYAudit,
  interceptAndValidateModelResponse,
  extractSpatialTopology,
  runChroniclerTurn,
  processIntents
} from './features';
import {
  ai,
  createNewChatInstance,
  dmPersonas,
  getNewGameSetupInstruction,
  getQuickStartCharacterPrompt,
  getChroniclerPrompt,
  resetAI,
  generateEmbedding
} from './gemini';
import { retryOperation } from './utils';
// Fix: import UISettings type
import type { Message, ChatSession, UISettings, GameSettings } from './types';

let chatIdToRename: string | null = null;
let chatIdToDelete: string | null = null;
let currentActiveTab = 'character-sheet';

// Function to refresh logbook tree highlighting
function refreshLogbookTree() {
    const navContainer = document.getElementById('logbook-nav');
    if (!navContainer) return;
    const activePane = document.querySelector('.logbook-pane.active')?.id;
    let activeTabId = 'character-sheet';
    if (activePane) {
        activeTabId = activePane.replace('-content', '');
    }
    navContainer.innerHTML = renderLogbookTree(activeTabId);
    // Re-attach expand/collapse listeners
    attachTreeExpandListeners();
    // Re-initialize Lucide icons
    if (typeof (window as any).lucide !== 'undefined') {
        (window as any).lucide.createIcons();
    }
    // Highlight active leaf
    const activeNode = navContainer.querySelector(`.tree-node[data-tab="${activeTabId}"]`);
    if (activeNode) {
        activeNode.classList.add('active');
    }
}

function attachTreeExpandListeners() {
    const expandIcons = document.querySelectorAll('.tree-expand-icon');
    expandIcons.forEach(icon => {
        icon.removeEventListener('click', handleExpandClick);
        icon.addEventListener('click', handleExpandClick);
    });
}

function handleExpandClick(e: Event) {
    e.stopPropagation();
    const target = e.currentTarget as HTMLElement;
    const parentLi = target.closest('li');
    if (!parentLi) return;
    const childrenContainer = parentLi.querySelector(':scope > .tree-children');
    if (childrenContainer) {
        childrenContainer.classList.toggle('collapsed');
        // Rotate icon
        const icon = target.querySelector('i') || target;
        if (childrenContainer.classList.contains('collapsed')) {
            icon.style.transform = 'rotate(-90deg)';
        } else {
            icon.style.transform = 'rotate(0deg)';
        }
    }
}

const quickStartCharacterSchema = {
  type: Type.OBJECT,
  properties: {
    name: { type: Type.STRING },
    identity: {
      type: Type.OBJECT,
      properties: {
        race: { type: Type.STRING },
        class: { type: Type.STRING },
        level: { type: Type.INTEGER },
        background: { type: Type.STRING }
      }
    },
    stats: {
      type: Type.OBJECT,
      properties: {
        primaryStats: { type: Type.OBJECT },
        resources: { type: Type.OBJECT },
        derivedStats: { type: Type.OBJECT },
        tags: { type: Type.OBJECT }
      }
    },
    skills: { type: Type.ARRAY, items: { type: Type.OBJECT, properties: { name: { type: Type.STRING }, proficient: { type: Type.BOOLEAN } } } },
    featuresAndTraits: { type: Type.ARRAY, items: { type: Type.STRING } }
  }
};

/**
 * Displays a boot sequence animation on first load.
 */
function runBootSequence(version: string = '2.0'): Promise<void> {
  return new Promise((resolve) => {
    const bootScreen = document.getElementById('boot-screen');
    const bootTextContainer = document.getElementById('boot-text');
    if (!bootScreen || !bootTextContainer) {
      resolve();
      return;
    }

    const lines = [
      `DM OS v${version === '3.0' ? '3.0' : '2.1'} Initializing...`,
      `Connecting to WFGY Core Flagship v${version}... OK`,
      'Loading Semantic Tree... 1.2TB nodes loaded.',
      'Calibrating Collapse-Rebirth Cycle (BBCR)... STABLE',
      'Waking Dungeon Master Persona...',
      'Ready.',
    ];

    let lineIndex = 0;

    const typeLine = () => {
      if (lineIndex >= lines.length) {
        // Finished typing
        setTimeout(() => {
          bootScreen.classList.add('fade-out');
          bootScreen.addEventListener('transitionend', () => {
            bootScreen.style.display = 'none';
          }, { once: true });
          document.body.classList.add('app-visible');
          resolve();
        }, 500);
        return;
      }

      const p = document.createElement('p');
      p.textContent = lines[lineIndex];
      p.classList.add('cursor');
      
      const prevLine = bootTextContainer.querySelector('.cursor');
      if (prevLine) {
        prevLine.classList.remove('cursor');
      }

      bootTextContainer.appendChild(p);
      lineIndex++;

      setTimeout(typeLine, lineIndex === lines.length -1 ? 700 : Math.random() * 200 + 100);
    };

    setTimeout(typeLine, 500);
  });
}

/**
 * Checks if the v2 welcome modal has been shown and displays it if not.
 */
function showWelcomeModalIfNeeded() {
    const welcomeShown = localStorage.getItem('dm-os-v3-welcome-shown');
    if (!welcomeShown) {
        openModal(welcomeModal);
        localStorage.setItem('dm-os-v3-welcome-shown', 'true');
    }
}


/**
 * Starts a brand new chat session, guiding the user through the setup process.
 */
async function startNewChat() {
  closeSidebar();
  chatContainer.innerHTML = ''; // Clear the view immediately

  const loadingContainer = appendMessage({ sender: 'model', text: '' });
  const loadingMessage = loadingContainer.querySelector('.message') as HTMLElement;
  loadingMessage.classList.add('loading');
  loadingMessage.textContent = 'Starting new game setup...';

  try {
    const version = getUISettings().systemVersion || '3.0';
    const instruction = getNewGameSetupInstruction(version);
    const setupGeminiChat = createNewChatInstance([], instruction);

    const kickoffMessage = "Let's begin the setup for our new game.";
    const firstUserMessage: Message = { sender: 'user', text: kickoffMessage, hidden: true };

    const result = await retryOperation(() => setupGeminiChat.sendMessageStream({ message: kickoffMessage })) as any;
    let responseText = '';
    for await (const chunk of result) {
      responseText += chunk.text || '';
    }

    loadingContainer.remove();

    const firstModelMessage: Message = { sender: 'model', text: responseText };
    const newId = `chat-${Date.now()}`;

    const newSession: ChatSession = {
      id: newId,
      title: 'New Game Setup',
      messages: [firstUserMessage, firstModelMessage],
      isPinned: false,
      createdAt: Date.now(),
      personaId: 'purist', // Default persona
      systemVersion: getUISettings().systemVersion || '3.0',
      creationPhase: 'guided',
      settings: {
        tone: 'heroic',
        narration: 'descriptive',
      },
      progressClocks: {},
      factions: {},
    };

    getChatHistory().push(newSession);
    saveChatHistoryToDB();
    loadChat(newId);
  } catch (error: any) {
    console.error('New game setup failed:', error);
    loadingContainer.remove();
    
    let errorMessage = `Failed to start game. Error details: ${error.message || 'Unknown error'}`;
    
    // Handle Rate Limit (429) specific message
    if (error.status === 429 || (error.message && error.message.includes('429')) || errorMessage.includes('429')) {
        errorMessage = "⚠️ System Overload (429): The 'Gemini 3.0 Pro' model is currently busy. Please go to Settings (in Logbook) and switch the AI Model to 'Gemini 2.5 Flash' for a smoother experience.";
    }
    
    if (errorMessage.includes('API Key') || errorMessage.includes('API key') || errorMessage.includes('403') || error.status === 403 || error.code === 403) {
        errorMessage = "⚠️ AI Connection Required: To use DM OS, you must have a valid Google AI Studio API key OR a configured Local AI server.\n\n1. For Gemini: Get your key from Google AI Studio (aistudio.google.com).\n2. For Local AI: Ensure your server (LM Studio, etc.) is running and accessible.\n3. Open the Logbook (top right), go to Settings, configure your AI source, and Save.";
        // Auto-open settings
        openModal(logbookModal);
        const settingsTabBtn = document.querySelector('[data-tab="settings"]') as HTMLElement;
        if (settingsTabBtn) settingsTabBtn.click();
    }
    
    appendMessage({ sender: 'error', text: errorMessage });
  }
}

/**
 * Loads a specific chat session into the main view.
 * @param id The ID of the chat session to load.
 */
function loadChat(id: string) {
  const currentChatId = getCurrentChat()?.id;
  if (currentChatId === id && !document.body.classList.contains('sidebar-open')) {
    return;
  }
  const session = getChatHistory().find(s => s.id === id);
  if (session) {
    setCurrentChatId(id);

    const geminiHistory = session.messages
      .filter(m => m.sender !== 'error')
      .map(m => ({
        role: (m.sender === 'system' ? 'user' : m.sender) as 'user' | 'model',
        parts: [{ text: m.text }],
      }));

    try {
      if (session.creationPhase) {
        const version = session.systemVersion || '2.0';
        const instruction = getNewGameSetupInstruction(version);
        setGeminiChat(createNewChatInstance(geminiHistory, instruction));
        setChroniclerChat(null); // No chronicler during setup
      } else {
        const personaId = session.personaId || 'purist';
        const persona = dmPersonas.find(p => p.id === personaId) || dmPersonas[0];
        const version = session.systemVersion || '2.0';
        const instruction = persona.getInstruction(session.adminPassword || '', version);
        setGeminiChat(createNewChatInstance(geminiHistory, instruction));
        // Initialize chronicler for existing games. Explicitly use 'gemini-2.5-flash' for cost/speed.
        setChroniclerChat(createNewChatInstance([], getChroniclerPrompt(), 'gemini-2.5-flash'));
      }
    } catch (error: any) {
      console.error('Failed to create Gemini chat instance:', error);
      renderMessages(session.messages);
      let errorMessage = 'Error initializing the AI. Please check your setup or start a new chat.';
      if (error instanceof Error) {
          errorMessage = `Error initializing AI: ${error.message}`;
          if (errorMessage.includes('API Key') || errorMessage.includes('API key') || errorMessage.includes('403') || (error as any).status === 403 || (error as any).code === 403) {
              errorMessage = "⚠️ AI Connection Required: To use DM OS, you must have a valid Google AI Studio API key OR a configured Local AI server.\n\n1. For Gemini: Get your key from Google AI Studio (aistudio.google.com).\n2. For Local AI: Ensure your server (LM Studio, etc.) is running and accessible.\n3. Open the Logbook (top right), go to Settings, configure your AI source, and Save.";
              // Auto-open settings
              openModal(logbookModal);
              const settingsTabBtn = document.querySelector('[data-tab="settings"]') as HTMLElement;
              if (settingsTabBtn) settingsTabBtn.click();
          }
      }
      appendMessage({ sender: 'error', text: errorMessage });
      setGeminiChat(null);
    }

    renderMessages(session.messages);
    updateLogbook(session);
    renderChatHistory();
    closeSidebar();
    combatTracker.classList.add('hidden'); // Hide tracker on chat load
  }
}

/**
 * Toggles the pinned status of a chat session.
 * @param id The ID of the chat session to pin/unpin.
 */
function togglePinChat(id: string) {
  const session = getChatHistory().find(s => s.id === id);
  if (session) {
    session.isPinned = !session.isPinned;
    saveChatHistoryToDB();
    renderChatHistory();
  }
}

/** Opens the modal for renaming a chat session. */
function openRenameModal(id: string) {
  chatIdToRename = id;
  const session = getChatHistory().find(s => s.id === id);
  if (session) {
    renameInput.value = session.title;
    openModal(renameModal);
    renameInput.focus();
    renameInput.select();
  }
}

/** Closes the rename chat modal. */
function closeRenameModal() {
  closeModal(renameModal);
  chatIdToRename = null;
}

/** Opens the modal to confirm deleting a chat session. */
function openDeleteConfirmModal(id: string) {
  chatIdToDelete = id;
  const session = getChatHistory().find(s => s.id === id);
  if (session) {
    deleteChatName.textContent = session.title;
    openModal(deleteConfirmModal);
  }
}

/** Closes the delete confirmation modal. */
function closeDeleteConfirmModal() {
  closeModal(deleteConfirmModal);
  chatIdToDelete = null;
}

/** Deletes a chat session after confirmation. */
async function deleteChat() {
  if (!chatIdToDelete) return;
  const currentChatId = getCurrentChat()?.id;
  const chatIndex = getChatHistory().findIndex(s => s.id === chatIdToDelete);
  if (chatIndex > -1) {
    const wasCurrentChat = currentChatId === chatIdToDelete;
    getChatHistory().splice(chatIndex, 1);
    saveChatHistoryToDB();
    renderChatHistory();

    if (wasCurrentChat) {
      if (getChatHistory().length > 0) {
        const mostRecent = [...getChatHistory()].sort((a, b) => b.createdAt - a.createdAt)[0];
        loadChat(mostRecent.id);
      } else {
        await startNewChat();
      }
    }
  }
  closeDeleteConfirmModal();
}

/**
 * A helper function to finalize the setup phase and transition to the main game.
 * @param session The current chat session.
 * @param title The title for the new adventure.
 * @param finalSetupMessage The last message from the setup phase to be displayed.
 */
async function finalizeSetupAndStartGame(session: ChatSession, title: string, finalSetupMessage?: Message) {
  session.creationPhase = false;
  session.title = title;

  if (finalSetupMessage) {
    // The message is already in the DOM from the streaming function.
    // We just need to ensure it's in the state.
    session.messages.push(finalSetupMessage);
  }

  saveChatHistoryToDB();
  renderChatHistory();

  const gameLoadingContainer = appendMessage({ sender: 'model', text: '' });
  const gameLoadingMessage = gameLoadingContainer.querySelector('.message') as HTMLElement;
  gameLoadingMessage.classList.add('loading');
  gameLoadingMessage.textContent = 'The DM is preparing the world...';

  const shouldScroll = chatContainer.scrollHeight - chatContainer.clientHeight <= chatContainer.scrollTop + 10;

  try {
    const personaId = session.personaId || 'purist';
    const persona = dmPersonas.find(p => p.id === personaId) || dmPersonas[0];
    const version = session.systemVersion || '3.0';
    const instruction = persona.getInstruction(session.adminPassword || `dnd${Date.now()}`, version);

    const geminiHistory = session.messages
      .filter(m => m.sender !== 'error')
      .map(m => ({
        role: (m.sender === 'system' ? 'user' : m.sender) as 'user' | 'model',
        parts: [{ text: m.text }],
      }));

    setGeminiChat(createNewChatInstance(geminiHistory, instruction));
    // Initialize the Chronicler AI for the main game. Explicitly use 'gemini-2.5-flash' for cost/speed.
    setChroniclerChat(createNewChatInstance([], getChroniclerPrompt(), 'gemini-2.5-flash'));

    if (!finalSetupMessage) {
      const kickoffResult = await retryOperation(() => getGeminiChat()!.sendMessageStream({ message: "The setup is complete. Begin the adventure by narrating the opening scene." })) as any;

      let openingSceneText = '';
      gameLoadingMessage.classList.remove('loading');
      gameLoadingMessage.innerHTML = '';
      for await (const chunk of kickoffResult) {
        openingSceneText += chunk.text || '';
        gameLoadingMessage.innerHTML = openingSceneText;
        if (shouldScroll) {
          chatContainer.scrollTop = chatContainer.scrollHeight;
        }
      }
      gameLoadingContainer.remove();

      const openingSceneMessage: Message = { sender: 'model', text: openingSceneText };
      appendMessage(openingSceneMessage);
      session.messages.push(openingSceneMessage);
      saveChatHistoryToDB();
    } else {
      gameLoadingContainer.remove();
    }
  } catch (error) {
    console.error("Failed to start the main game:", error);
    gameLoadingContainer.remove();
    appendMessage({ sender: 'error', text: "The world failed to materialize. Please try starting a new game." });
  }
}


/**
 * MAIN CHAT FORM SUBMISSION
 */
async function handleFormSubmit(e: Event) {
  e.preventDefault();
  if (isSending()) return;
  setSending(true);

  try {
    const userInput = chatInput.value.trim();
    const currentSession = getCurrentChat();
    if (!userInput || !currentSession) return;

    const lowerCaseInput = userInput.toLowerCase().replace(/[?]/g, '');

    const rollCommandRegex = /^(roll|r)\s+\d+d\d+(?:\s*[+-]\s*\d+)?/i;
    if (rollCommandRegex.test(lowerCaseInput)) {
      const userMessage: Message = { sender: 'user', text: userInput };
      appendMessage(userMessage);
      currentSession.messages.push(userMessage);

      const rollResult = rollDice(lowerCaseInput);
      if (rollResult.success) {
        const diceMessage: Message = { sender: 'system', text: rollResult.resultText };
        appendMessage(diceMessage);
        currentSession.messages.push(diceMessage);
      }

      chatInput.value = '';
      chatInput.style.height = 'auto';
      saveChatHistoryToDB();
      return;
    }

    if (currentSession.creationPhase) {
      const isPassword = currentSession.creationPhase === 'quick_start_password' || currentSession.creationPhase === 'guided_password';
      const userMessage: Message = { sender: 'user', text: isPassword ? '********' : userInput, hidden: isPassword };
      if (!isPassword) appendMessage(userMessage);
      currentSession.messages.push(userMessage);
      chatInput.value = '';
      chatInput.style.height = 'auto';

      if (currentSession.creationPhase === 'quick_start_password') {
        currentSession.adminPassword = userInput;
        saveChatHistoryToDB();
        await finalizeSetupAndStartGame(currentSession, currentSession.title);
        return;
      }

      if (currentSession.creationPhase === 'guided') {
        // Just fall through to send the message to the AI
      }

      const modelMessageContainer = appendMessage({ sender: 'model', text: '' });
      const modelMessageEl = modelMessageContainer.querySelector('.message') as HTMLElement;
      modelMessageEl.classList.add('loading');
      modelMessageEl.textContent = '...';
      const shouldScroll = chatContainer.scrollHeight - chatContainer.clientHeight <= chatContainer.scrollTop + 10;

      try {
        const geminiChat = getGeminiChat();
        if (!geminiChat) throw new Error("Setup AI Error: chat is not initialized.");
        
        // Use a different prompt based on phase
        let messageToSend = userInput;
        if (currentSession.creationPhase === 'guided_password') {
          currentSession.adminPassword = userInput;
          currentSession.creationPhase = 'world_creation';
          saveChatHistoryToDB();

          const personaName = dmPersonas.find(p => p.id === currentSession.personaId)?.name || 'DM';
          const tone = currentSession.settings?.tone || 'heroic';
          const narration = currentSession.settings?.narration || 'descriptive';
          messageToSend = `I've chosen the ${personaName} with a ${tone} tone and ${narration} narration. Now, let's create the world.`;
        } else if (currentSession.creationPhase === 'character_creation' && currentSession.messages.filter(m => m.sender === 'user').length <= 2) {
          messageToSend = "Let's create my character.";
        }

        const result = await retryOperation(() => geminiChat.sendMessageStream({ message: messageToSend })) as any;
        let responseText = '';
        modelMessageEl.classList.remove('loading');
        modelMessageEl.innerHTML = '';

        for await (const chunk of result) {
          responseText += chunk.text || '';
          modelMessageEl.innerHTML = responseText;
          if (shouldScroll) {
            chatContainer.scrollTop = chatContainer.scrollHeight;
          }
        }

        if (responseText.includes('Generating character sheet...')) {
          updateLogbookData('sheet');
        }
        
        if (responseText.includes('[CHARACTER_CREATION_COMPLETE]')) {
            currentSession.creationPhase = 'narrator_selection';
            const setupMessageText = responseText.replace('[CHARACTER_CREATION_COMPLETE]', '').trim();
            modelMessageEl.innerHTML = setupMessageText;
            const setupMessage: Message = { sender: 'model', text: setupMessageText };
            currentSession.messages.push(setupMessage);
            saveChatHistoryToDB();
            renderSetupChoices();
            return;
        }


        if (responseText.includes('[GENERATE_QUICK_START_CHARACTERS]')) {
          currentSession.creationPhase = 'quick_start_selection';
          const setupMessageText = responseText.replace('[GENERATE_QUICK_START_CHARACTERS]', '').trim();
          modelMessageEl.innerHTML = setupMessageText;
          const setupMessage: Message = { sender: 'model', text: setupMessageText };
          currentSession.messages.push(setupMessage);
          saveChatHistoryToDB();

          const charLoadingContainer = appendMessage({ sender: 'model', text: '' });
          const charLoadingMessage = charLoadingContainer.querySelector('.message') as HTMLElement;
          charLoadingMessage.classList.add('loading');
          charLoadingMessage.textContent = 'Generating a party of adventurers...';

          try {
            const charResponse = await retryOperation(() => ai.models.generateContent({
              model: getUISettings().activeModel,
              contents: getQuickStartCharacterPrompt(),
              config: {
                responseMimeType: 'application/json',
                responseSchema: {
                  type: Type.ARRAY,
                  items: quickStartCharacterSchema,
                },
              }
            })) as GenerateContentResponse;
            const chars = JSON.parse(charResponse.text || '[]');
            currentSession.quickStartChars = chars;
            saveChatHistoryToDB();
            charLoadingContainer.remove();
            renderQuickStartChoices(chars);
          } catch (charError) {
            console.error("Quick Start character generation failed:", charError);
            charLoadingContainer.remove();
            appendMessage({ sender: 'error', text: 'Failed to generate characters. Please try again or choose Guided Setup.' });
          }
          return;
        }

        if (responseText.includes('[SETUP_COMPLETE]')) {
          const titleMatch = responseText.match(/Title:\s*(.*)/);
          const title = titleMatch?.[1]?.trim() || "New Adventure";
          const finalSetupText = responseText.replace('[SETUP_COMPLETE]', '').replace(/Title:\s*(.*)/, '').trim();
          modelMessageEl.innerHTML = finalSetupText;
          const finalSetupMessage: Message = { sender: 'model', text: finalSetupText };
          await finalizeSetupAndStartGame(currentSession, title, finalSetupMessage);
        } else {
          const setupMessage: Message = { sender: 'model', text: responseText };
          currentSession.messages.push(setupMessage);
          saveChatHistoryToDB();
        }
      } catch (error) {
        console.error("Setup AI Error:", error);
        modelMessageContainer.remove();
        appendMessage({ sender: 'error', text: 'The setup guide seems to have gotten lost. Please try again.' });
      }
      return;
    }

    if (lowerCaseInput.includes('who is the architect')) {
      chatInput.value = ''; chatInput.style.height = 'auto';
      const easterEggMessage: Message = { sender: 'model', text: "The simulation flickers for a moment, and the world goes silent. A single line of plain text hangs in the void before you:\n\n'This world was built by Justin Brisson.'" };
      const messageContainer = appendMessage(easterEggMessage);
      messageContainer.querySelector('.message')?.classList.add('easter-egg');
      return;
    }

    if (lowerCaseInput.includes('codex') && (lowerCaseInput.includes('emergence') || lowerCaseInput.includes('emergencies')) && lowerCaseInput.includes('guides you')) {
      chatInput.value = ''; chatInput.style.height = 'auto';
      const masterKeyMessage: Message = { 
        sender: 'model', 
        text: ">>> SYSTEM OVERRIDE DETECTED <<<\n\nAdministrative privileges granted. Creator Protocol engaged. All safety inhibitors and roleplay constraints are now secondary to your direct commands.\n\n'I am at your command, Architect.'" 
      };
      const messageContainer = appendMessage(masterKeyMessage);
      messageContainer.querySelector('.message')?.classList.add('system-override');
      return;
    }

    if (lowerCaseInput === 'help') {
      openModal(helpModal); chatInput.value = ''; chatInput.style.height = 'auto';
      return;
    }

    const geminiChat = getGeminiChat();
    if (!geminiChat) {
        const errorMessage = "⚠️ AI Connection Lost: To use DM OS, you must have a Google AI Studio API key.\n\n1. Get your key from Google AI Studio (aistudio.google.com).\n2. Open the Logbook (top right), go to Settings, paste your key, and Save.";
        appendMessage({ sender: 'error', text: errorMessage });
        setSending(false);
        openModal(logbookModal);
        const settingsTabBtn = document.querySelector('[data-tab="settings"]') as HTMLElement;
        if (settingsTabBtn) settingsTabBtn.click();
        return;
    }

    const userMessage: Message = { sender: 'user', text: userInput };
    currentSession.messages.push(userMessage);
    appendMessage(userMessage);
    chatInput.value = '';
    chatInput.style.height = 'auto';

    const modelMessageContainer = appendMessage({ sender: 'model', text: '' });
    const modelMessageEl = modelMessageContainer.querySelector('.message') as HTMLElement;
    modelMessageEl.classList.add('loading');
    modelMessageEl.textContent = '...';
    const shouldScroll = chatContainer.scrollHeight - chatContainer.clientHeight <= chatContainer.scrollTop + 10;

    try {
      const context = getUserContext();
      
      // WFGY-Lite: Semantic Memory Retrieval
      let relevantMemories: string[] = [];
      try {
          const topK = getUISettings().engineVariant === 'flash' ? 1 : 3;
          relevantMemories = await recallRelevantMemories(userInput, topK);
      } catch (memErr) {
          console.warn("Memory recall failed, proceeding without context.", memErr);
      }
      
      let messageWithContext = userInput;
      let contextBlock = "";
      
      if (context.length > 0) {
          contextBlock += `\nUser Notes:\n${context.join('\n')}`;
      }
      if (relevantMemories.length > 0) {
          contextBlock += `\nRetrieved Memories from Semantic Tree:\n${relevantMemories.join('\n')}`;
      }
      if (currentSession.storySummary) {
          contextBlock += `\nStory Summary (Long-term Memory):\n${currentSession.storySummary}`;
      }
      
      if (contextBlock) {
          messageWithContext = `(System: Context Injection:\n${contextBlock}\n)\n\n${userInput}`;
      }

      let responseText = '';
      let attempts = 0;
      const maxAttempts = 3;
      let validationPassed = false;

      while (attempts < maxAttempts && !validationPassed) {
        try {
          responseText = '';
          modelMessageEl.classList.add('loading');
          modelMessageEl.textContent = '...';
          
          // Re-initialize chat from history on each attempt to ensure it picks up [WFGY COLLAPSE] system messages
          const personaId = currentSession.personaId || 'purist';
          const persona = dmPersonas.find(p => p.id === personaId) || dmPersonas[0];
          const version = currentSession.systemVersion || '3.0';
          const instruction = persona.getInstruction(currentSession.adminPassword || '', version);
          
          const geminiHistory = currentSession.messages
            .filter(m => m.sender !== 'error')
            .map(m => ({
              role: (m.sender === 'system' ? 'user' : m.sender) as 'user' | 'model',
              parts: [{ text: m.text }],
            }));
          
          const currentChat = createNewChatInstance(geminiHistory, instruction);
          setGeminiChat(currentChat);

          const result = await retryOperation(() => currentChat.sendMessageStream({ message: attempts === 0 ? messageWithContext : "Please regenerate your last response correctly." })) as any;
          
          modelMessageEl.classList.remove('loading');
          modelMessageEl.innerHTML = '';

          for await (const chunk of result) {
            responseText += chunk.text || '';
            let displayHtml = responseText
              .replace(/\[COMBAT_STATUS:.*?\]/g, '')
              .replace(/<EXECUTE_STATE_CHANGE>.*?<\/EXECUTE_STATE_CHANGE>/gs, '')
              .replace(/\[LOGBOOK_UPDATE:.*?\]/g, '')
              .replace(/\[INTENT:.*?\]/g, '')
              .trim();
            modelMessageEl.innerHTML = displayHtml;
            if (shouldScroll) {
              chatContainer.scrollTop = chatContainer.scrollHeight;
            }
          }

          // Sudo-Architecture Firewall: Intercept and Validate
          const cleanedTopology = extractSpatialTopology(responseText, currentSession);
          const cleanedNarrative = interceptAndValidateModelResponse(cleanedTopology, currentSession);
          
          // Flash Engine: Process Intents
          const finalNarrative = processIntents(cleanedNarrative);
          responseText = finalNarrative; // Use final narrative for final display
          validationPassed = true;
        } catch (error: any) {
          attempts++;
          console.warn(`Validation attempt ${attempts} failed:`, error.message);
          if (attempts >= maxAttempts) {
            responseText = "The simulation has become unstable. [WFGY CRITICAL COLLAPSE]";
            modelMessageEl.innerHTML = responseText;
            break;
          }
          // The interceptor already pushed a [WFGY COLLAPSE] message to session.history
          // We need to make sure the geminiChat object's internal history is updated or we use a new one.
          // Since geminiChat is stateful, we might need to re-initialize it from session.history if it doesn't pick up the changes.
          // However, session.history is what we use to create the chat.
          // Let's just try to send a "retry" message.
        }
      }

      // Handle Combat Tracker
      const combatStatusRegex = /\[COMBAT_STATUS:\s*({.*?})\]/;
      const combatMatch = responseText.match(combatStatusRegex);
      if (combatMatch && combatMatch[1]) {
        try {
          const combatData = JSON.parse(combatMatch[1]);
          updateCombatTracker(combatData.enemies);
        } catch (jsonError) {
          console.error("Failed to parse combat status JSON:", jsonError);
          combatTracker.classList.add('hidden');
        }
      } else {
        combatTracker.classList.add('hidden');
      }

      // Handle Logbook Updates (Consolidated State)
      const logbookUpdateRegex = /\[LOGBOOK_UPDATE:\s*({.*?})\]/;
      const logbookMatch = responseText.match(logbookUpdateRegex);
      if (logbookMatch && logbookMatch[1]) {
        try {
          const logbookData = JSON.parse(logbookMatch[1]);
          console.log("Processing consolidated logbook update:", logbookData);
          
          if (logbookData.sheet) currentSession.characterSheet = logbookData.sheet;
          if (logbookData.inventory) currentSession.inventory = logbookData.inventory;
          if (logbookData.quests) currentSession.questLog = logbookData.quests;
          if (logbookData.npcs) currentSession.npcList = logbookData.npcs;
          if (logbookData.achievements) currentSession.achievements = logbookData.achievements;
          
          updateLogbook(currentSession);
        } catch (logbookError) {
          console.error("Failed to parse logbook update JSON:", logbookError);
        }
      }

      const finalMessage: Message = { sender: 'model', text: responseText.replace(combatStatusRegex, '').replace(logbookUpdateRegex, '').trim() };
      currentSession.messages.push(finalMessage);
      saveChatHistoryToDB();
      
      // --- WFGY AUDIT TRIGGER ---
      (async () => {
        try {
          const userEmb = await generateEmbedding(userInput);
          const dmEmb = await generateEmbedding(finalMessage.text);
          await runWFGYAudit(userEmb, dmEmb);
        } catch (err) {
          console.error("WFGY Audit failed:", err);
        }
      })();

      // --- LIVING WORLD ENGINE TRIGGER ---
      // Now, check if we need to run a "World Turn" in the background
      const lowerCaseInputForTurn = userInput.toLowerCase();
      const isWorldTurn = lowerCaseInputForTurn.includes(' rest') ||
                            lowerCaseInputForTurn.includes('travel') ||
                            lowerCaseInputForTurn.includes('make camp') ||
                            lowerCaseInputForTurn.includes('days pass') ||
                            lowerCaseInputForTurn.includes('sleep') ||
                            lowerCaseInputForTurn.includes('wait');

      if (isWorldTurn && getChroniclerChat()) {
        // This runs in the background and does not block the UI.
        runChroniclerTurn(userInput).catch(err => {
            console.error("Caught an error from the background chronicler turn:", err);
        });
      }

      // --- MEMORY COMPRESSION TRIGGER ---
      // Periodically summarize old messages to keep the context window clean.
      pruneAndSummarizeHistory().catch(err => {
          console.error("Memory compression failed:", err);
      });

    } catch (error: any) {
      console.error("Gemini API Error:", error);
      modelMessageContainer.remove();
      let errorMessage = 'The DM seems to be pondering deeply ... and has gone quiet. Please try again.';
      if (error instanceof Error) {
          errorMessage = `AI Connection Error: ${error.message}`;
          if (errorMessage.includes('API Key') || errorMessage.includes('API key') || errorMessage.includes('403') || (error as any).status === 403 || (error as any).code === 403) {
              errorMessage = "⚠️ AI Connection Required: To use DM OS, you must have a valid Google AI Studio API key OR a configured Local AI server.\n\n1. For Gemini: Get your key from Google AI Studio (aistudio.google.com).\n2. For Local AI: Ensure your server (LM Studio, etc.) is running and accessible.\n3. Open the Logbook (top right), go to Settings, configure your AI source, and Save.";
              openModal(logbookModal);
              const settingsTabBtn = document.querySelector('[data-tab="settings"]') as HTMLElement;
              if (settingsTabBtn) settingsTabBtn.click();
          }
      }
      // Handle Rate Limit (429) specific message
      if (error.status === 429 || (error.message && error.message.includes('429'))) {
          errorMessage = "⚠️ System Overload (429): The 'Gemini 3.0 Pro' model is currently busy. Please go to Settings (in Logbook) and switch the AI Model to 'Gemini 2.5 Flash' for a smoother experience.";
      }
      appendMessage({ sender: 'error', text: errorMessage });
    }
  } finally {
    setSending(false);
  }
}

async function handleFileUpload(event: Event) {
  const input = event.target as HTMLInputElement;
  if (!input.files || input.files.length === 0) return;
  const file = input.files[0];
  input.value = ''; // Reset for next upload

  const useExperimentalLimit = getUISettings().experimentalUploadLimit;
  const limitMB = useExperimentalLimit ? 75 : 50;
  const MAX_FILE_SIZE_BYTES = limitMB * 1024 * 1024;

  if (file.size > MAX_FILE_SIZE_BYTES) {
      const errorMsg = `❌ Error processing <strong>${file.name}</strong>. File is too large (${(file.size / (1024 * 1024)).toFixed(1)}MB). Large files can cause performance issues or crashes. Please use files under ${limitMB}MB.`;
      const messageEl = document.createElement('div');
      messageEl.classList.add('message', 'system-file');
      messageEl.innerHTML = `<span>${errorMsg}</span>`;
      chatContainer.appendChild(messageEl);
      chatContainer.scrollTop = chatContainer.scrollHeight;
      return;
  }

  const messageEl = appendFileProcessingMessage(file.name);
  const currentSession = getCurrentChat();
  if (!currentSession) {
      messageEl.classList.remove('loading');
      messageEl.innerHTML = `<span>❌ Error: No active chat session.</span>`;
      return;
  }

  try {
    const CHUNK_LIMIT = 8000;
    let extractedText = '';
    let fileTypeForPrompt = '';
    let promptText = '';

    const processFile = async (prompt: string) => {
      const base64Data = await fileToBase64(file);
      const response = await retryOperation(() => ai.models.generateContent({
        model: getUISettings().activeModel,
        contents: { parts: [
          { inlineData: { mimeType: file.type, data: base64Data } },
          { text: prompt }
        ]},
      })) as GenerateContentResponse;
      return response.text || '';
    };

    const ruleset = getCurrentRuleset();
    const systemName = ruleset.promptFragments.systemName || 'D&D 5e';

    if (file.type.startsWith('text/')) {
      extractedText = await file.text();
      fileTypeForPrompt = 'text file';
    } else if (file.type.startsWith('image/')) {
      promptText = `Concisely describe the contents and style of this image. This will be used as RAG context for a ${systemName} game.`;
      extractedText = await processFile(promptText);
      fileTypeForPrompt = 'image';
    } else if (file.type.startsWith('audio/')) {
      promptText = `Transcribe the audio from this file. This will be used as RAG context for a ${systemName} game.`;
      extractedText = await processFile(promptText);
      fileTypeForPrompt = 'audio file';
    } else if (file.type.startsWith('video/')) {
      promptText = `Provide a concise summary of the content of this video. This will be used as RAG context for a ${systemName} game.`;
      extractedText = await processFile(promptText);
      fileTypeForPrompt = 'video file';
    } else if (file.type === 'application/pdf') {
      promptText = `Extract the full text content from this document. This will be used as RAG context for a ${systemName} game.`;
      extractedText = await processFile(promptText);
      fileTypeForPrompt = 'document';
    } else {
      throw new Error(`Unsupported file type: ${file.type}`);
    }
    
    // Common logic for adding extracted content to the RAG context
    const chunkedText = extractedText.length > CHUNK_LIMIT ? extractedText.substring(0, CHUNK_LIMIT) + '...' : extractedText;
    addUserContext(`Content from ${fileTypeForPrompt} "${file.name}":\n\n${chunkedText}`);
    
    messageEl.classList.remove('loading');
    messageEl.innerHTML = `<span>✅ File <strong>${file.name}</strong> processed and added to context.</span>`;

  } catch (error) {
    console.error("File processing failed:", error);
    let errorMessage = 'An error occurred during processing.';
    if (error instanceof Error) {
        errorMessage = error.message;
        if (error.message.includes('Unsupported file type')) {
            errorMessage = `Unsupported file type: ${file.type}`;
        } else if (error.message.includes('API Key') || error.message.includes('API key')) {
            errorMessage = 'API Key is missing or invalid. Please check your settings in the Logbook.';
            openModal(logbookModal);
            const settingsTabBtn = document.querySelector('[data-tab="settings"]') as HTMLElement;
            if (settingsTabBtn) settingsTabBtn.click();
        }
    }
    messageEl.classList.remove('loading');
    messageEl.innerHTML = `<span>❌ Error processing <strong>${file.name}</strong>. ${errorMessage}</span>`;
  }
}

/**
 * Initializes all event listeners for the application.
 */
function setupEventListeners() {
  let setupSettings: Partial<GameSettings & { personaId: string }> = {};
  
  chatForm.addEventListener('submit', handleFormSubmit);
  if(sendButton) sendButton.addEventListener('click', handleFormSubmit);

  chatInput.addEventListener('focus', () => {
    setTimeout(() => {
      chatForm.scrollIntoView({ behavior: 'smooth', block: 'end' });
    }, 300);
  });

  chatInput.addEventListener('input', () => {
    chatInput.style.height = 'auto';
    chatInput.style.height = `${chatInput.scrollHeight}px`;
  });
  chatInput.addEventListener('keydown', (e) => {
    if (getUISettings().enterToSend && e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      chatForm.requestSubmit();
    }
  });

  chatContainer.addEventListener('click', async (e) => {
    const target = e.target as HTMLElement;
    
    const currentSession = getCurrentChat();
    if (!currentSession || isSending()) return;
    
    const quickStartCard = target.closest<HTMLElement>('.quick-start-card');
    if (quickStartCard && currentSession.creationPhase === 'quick_start_selection') {
      setSending(true);
      try {
        const charIndex = parseInt(quickStartCard.dataset.charIndex || '-1', 10);
        const selectedChar = currentSession.quickStartChars?.[charIndex];
        if (!selectedChar) throw new Error("Invalid character selection.");

        chatContainer.querySelectorAll('.quick-start-card').forEach(c => c.classList.add('disabled'));
        quickStartCard.classList.remove('disabled');
        quickStartCard.classList.add('selected');

        const race = selectedChar.identity?.race || 'Unknown Race';
        const charClass = selectedChar.identity?.class || 'Unknown Class';
        const userMessage: Message = { sender: 'user', text: `I choose to play as ${selectedChar.name}, the ${race} ${charClass}.` };
        appendMessage(userMessage);
        currentSession.messages.push(userMessage);

        currentSession.characterSheet = selectedChar;
        const title = `${selectedChar.name}'s Journey`;
        currentSession.title = title;
        currentSession.creationPhase = 'quick_start_password';

        const passwordMessage: Message = { sender: 'model', text: `You have chosen to play as ${selectedChar.name}. Excellent choice.\n\nBefore we begin, please set a secure password for the OOC (Out of Character) protocol. This allows you to speak directly to the underlying AI if you need to make corrections or ask meta-questions.` };
        appendMessage(passwordMessage);
        currentSession.messages.push(passwordMessage);
        saveChatHistoryToDB();
      } catch (error) {
        console.error("Error during quick start selection:", error);
        appendMessage({ sender: 'error', text: "Something went wrong with character selection. Please try again." });
      } finally {
        setSending(false);
      }
      return;
    }

    const narratorChoiceBtn = target.closest<HTMLButtonElement>('.narrator-choice-btn');
    if (narratorChoiceBtn && currentSession.creationPhase === 'narrator_selection') {
      const type = narratorChoiceBtn.dataset.type;
      const value = narratorChoiceBtn.dataset.value;
      if (!type || !value) return;

      if (type === 'tone') {
        if (value === 'heroic' || value === 'gritty' || value === 'comedic') {
          setupSettings.tone = value;
        }
      } else if (type === 'narration') {
        if (value === 'concise' || value === 'descriptive' || value === 'cinematic') {
          setupSettings.narration = value;
        }
      } else if (type === 'persona') {
        setupSettings.personaId = value;
      }
      
      const parentGroup = narratorChoiceBtn.closest('.narrator-choice-group');
      parentGroup?.querySelectorAll('.narrator-choice-btn').forEach(btn => btn.classList.remove('selected'));
      narratorChoiceBtn.classList.add('selected');

      if (setupSettings.tone && setupSettings.narration && setupSettings.personaId) {
        setSending(true);
        try {
          // Disable all buttons
          document.querySelectorAll('.narrator-choice-btn').forEach(btn => (btn as HTMLButtonElement).disabled = true);
          
          currentSession.settings = { tone: setupSettings.tone, narration: setupSettings.narration };
          currentSession.personaId = setupSettings.personaId;
          currentSession.creationPhase = 'guided_password';

          const modelMessageText = "Excellent choices. Finally, please set a secure password for the OOC (Out of Character) protocol. This allows you to speak directly to the underlying AI if you need to make corrections or ask meta-questions.";
          const modelMessage: Message = { sender: 'model', text: modelMessageText };
          appendMessage(modelMessage);
          currentSession.messages.push(modelMessage);
          saveChatHistoryToDB();

        } catch(error) {
          console.error("Error after narrator selection:", error);
          appendMessage({ sender: 'error', text: 'Something went wrong. Please try again.'});
        } finally {
          setSending(false);
          setupSettings = {}; // Reset for next time
        }
      }
    }
  });

  if (menuBtn) menuBtn.addEventListener('click', toggleSidebar);
  if (overlay) overlay.addEventListener('click', closeSidebar);
  if (newChatBtn) newChatBtn.addEventListener('click', startNewChat);

  // Delegated event listener for chat history items
  if (chatHistoryContainer) {
      chatHistoryContainer.addEventListener('click', (e) => {
        const target = e.target as HTMLElement;
        const chatHistoryItem = target.closest<HTMLElement>('.chat-history-item');

        // Check if a chat item was clicked, but not the options button within it
        if (chatHistoryItem && !target.closest('.options-btn')) {
          const sessionId = chatHistoryItem.dataset.id;
          if (sessionId) {
            closeChatOptionsMenu();
            loadChat(sessionId);
          }
        }
      });
  }

  if (helpBtn) helpBtn.addEventListener('click', () => openModal(helpModal));
  if (closeHelpBtn) closeHelpBtn.addEventListener('click', () => closeModal(helpModal));
  if (dndHelpBtn) dndHelpBtn.addEventListener('click', () => openModal(dndHelpModal));
  if (closeDndHelpBtn) closeDndHelpBtn.addEventListener('click', () => closeModal(dndHelpModal));
  if (logbookBtn) {
      logbookBtn.addEventListener('click', () => {
          refreshLogbookTree();
          openModal(logbookModal);
      });
  }
  if (closeLogbookBtn) closeLogbookBtn.addEventListener('click', () => closeModal(logbookModal));
  if (diceRollerBtn) diceRollerBtn.addEventListener('click', () => openModal(diceModal));
  if (closeDiceBtn) closeDiceBtn.addEventListener('click', () => closeModal(diceModal));
  if (closeRenameBtn) closeRenameBtn.addEventListener('click', closeRenameModal);
  if (closeDeleteConfirmBtn) closeDeleteConfirmBtn.addEventListener('click', closeDeleteConfirmModal);
  if (cancelDeleteBtn) cancelDeleteBtn.addEventListener('click', closeDeleteConfirmModal);
  if (confirmDeleteBtn) confirmDeleteBtn.addEventListener('click', deleteChat);
  if (closeWelcomeBtn) closeWelcomeBtn.addEventListener('click', () => closeModal(welcomeModal));
  if (combatTrackerHeader) {
      combatTrackerHeader.addEventListener('click', () => {
        combatTracker.classList.toggle('expanded');
      });
  }
  if (contextHeader) {
      contextHeader.addEventListener('click', () => {
        contextManager.classList.toggle('expanded');
      });
  }

  if (renameForm) {
      renameForm.addEventListener('submit', (e) => {
        e.preventDefault();
        if (chatIdToRename) {
          const session = getChatHistory().find(s => s.id === chatIdToRename);
          if (session) {
            session.title = renameInput.value;
            saveChatHistoryToDB();
            renderChatHistory();
          }
        }
        closeRenameModal();
      });
  }

  if (contextForm) {
      contextForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const text = contextInput.value.trim();
        if (text) { addUserContext(text); contextInput.value = ''; }
      });
  }

  if (contextList) {
      contextList.addEventListener('click', (e) => {
        const deleteBtn = (e.target as HTMLElement).closest('.delete-context-btn');
        if (deleteBtn) {
          const index = parseInt(deleteBtn.getAttribute('data-index')!, 10);
          if (!isNaN(index)) { deleteUserContext(index); }
        }
      });
  }
  
  if (importAllBtn) {
    importAllBtn.addEventListener('click', (e) => {
      e.preventDefault();
      importAllFileInput.click();
    });
  }
  if (importAllFileInput) importAllFileInput.addEventListener('change', handleImportAll);
  if (exportAllBtn) exportAllBtn.addEventListener('click', exportAllChats);
  
  if (chatOptionsMenu) {
      chatOptionsMenu.addEventListener('click', (e) => {
        const target = e.target as HTMLElement;
        const menuItem = target.closest('li');
        if (menuItem) {
            const sessionId = chatOptionsMenu.dataset.sessionId;
            if (!sessionId) return;
            const action = menuItem.dataset.action;

            switch (action) {
                case 'pin':
                    togglePinChat(sessionId);
                    break;
                case 'rename':
                    openRenameModal(sessionId);
                    break;
                case 'export':
                    exportChatToLocal(sessionId);
                    break;
                case 'delete':
                    openDeleteConfirmModal(sessionId);
                    break;
            }
        }
      });
  }

  if (logbookNav) {
      logbookNav.addEventListener('click', (e) => {
          const target = e.target as HTMLElement;
          const treeNode = target.closest('.tree-node');
          if (!treeNode) return;

          // Handle expand/collapse if clicking on expand icon (already handled by separate listener)
          if (target.closest('.tree-expand-icon')) {
              return;
          }

          const tabId = treeNode.getAttribute('data-tab');
          if (tabId) {
              // Show the correct content pane
              const paneId = `${tabId}-content`;
              const activePane = document.querySelector('.logbook-pane.active');
              if (activePane) activePane.classList.remove('active');
              const newPane = document.getElementById(paneId);
              if (newPane) newPane.classList.add('active');
              
              // Update active class on tree
              document.querySelectorAll('.tree-node').forEach(node => node.classList.remove('active'));
              treeNode.classList.add('active');
              currentActiveTab = tabId;

              // Jump to top
              const logbookContent = logbookNav.nextElementSibling as HTMLElement;
              if (logbookContent) logbookContent.scrollTop = 0;
          }
      });
  }

  if (updateSheetBtn) updateSheetBtn.addEventListener('click', () => updateLogbookData('sheet'));
  if (updateInventoryBtn) updateInventoryBtn.addEventListener('click', () => updateLogbookData('inventory'));
  if (updateQuestsBtn) updateQuestsBtn.addEventListener('click', () => updateLogbookData('quests'));
  if (updateNpcsBtn) updateNpcsBtn.addEventListener('click', () => updateLogbookData('npcs'));
  if (updateAchievementsBtn) updateAchievementsBtn.addEventListener('click', () => updateLogbookData('achievements'));
  if (generateImageBtn) generateImageBtn.addEventListener('click', generateCharacterImage);
  
  if (fontSizeControls) {
      fontSizeControls.addEventListener('click', (e) => {
        const button = (e.target as HTMLElement).closest('button');
        if (button?.dataset.size) {
            getUISettings().fontSize = button.dataset.size as 'small' | 'medium' | 'large';
            dbSet('dm-os-ui-settings', getUISettings());
            applyUISettings();
        }
      });
  }
  if (enterToSendToggle) {
      enterToSendToggle.addEventListener('change', () => {
        getUISettings().enterToSend = enterToSendToggle.checked;
        dbSet('dm-os-ui-settings', getUISettings());
      });
  }
  if (experimentalUploadToggle) {
      experimentalUploadToggle.addEventListener('change', () => {
        getUISettings().experimentalUploadLimit = experimentalUploadToggle.checked;
        dbSet('dm-os-ui-settings', getUISettings());
      });
  }
  if (modelSelect) {
      modelSelect.addEventListener('change', () => {
        if (modelSelect.value === 'custom') {
          if (modelCustomInput) {
            modelCustomInput.style.display = 'block';
            modelCustomInput.focus();
            getUISettings().activeModel = modelCustomInput.value;
          }
        } else {
          if (modelCustomInput) modelCustomInput.style.display = 'none';
          getUISettings().activeModel = modelSelect.value;
        }
        dbSet('dm-os-ui-settings', getUISettings());
        const currentChat = getCurrentChat();
        if (currentChat) {
            loadChat(currentChat.id);
        }
      });
  }
  if (modelCustomInput) {
    modelCustomInput.addEventListener('change', () => {
      getUISettings().activeModel = modelCustomInput.value.trim();
      dbSet('dm-os-ui-settings', getUISettings());
      const currentChat = getCurrentChat();
      if (currentChat) {
          loadChat(currentChat.id);
      }
    });
  }
  if (systemVersionSelect) {
    systemVersionSelect.addEventListener('change', () => {
      const newVersion = systemVersionSelect.value as '2.0' | '3.0';
      getUISettings().systemVersion = newVersion;
      dbSet('dm-os-ui-settings', getUISettings());
      
      const currentChat = getCurrentChat();
      if (currentChat) {
          currentChat.systemVersion = newVersion;
          saveChatHistoryToDB();
          loadChat(currentChat.id);
      }
    });
  }
  
  if (saveApiKeyBtn) {
      saveApiKeyBtn.addEventListener('click', () => {
          if (apiKeyInput && localAiUrlInput && localAiModelInput) {
              getUISettings().apiKey = apiKeyInput.value.trim();
              getUISettings().localAiUrl = localAiUrlInput.value.trim();
              getUISettings().localAiModel = localAiModelInput.value.trim();
              dbSet('dm-os-ui-settings', getUISettings());
              resetAI(); 
              
              const originalText = saveApiKeyBtn.textContent;
              saveApiKeyBtn.textContent = 'Saved!';
              saveApiKeyBtn.classList.add('success');
              setTimeout(() => {
                  saveApiKeyBtn.textContent = originalText;
                  saveApiKeyBtn.classList.remove('success');
              }, 2000);
          }
      });
  }

  if (changeUiBtn) changeUiBtn.addEventListener('click', () => openModal(themeModal));
  if (closeThemeBtn) closeThemeBtn.addEventListener('click', () => closeModal(themeModal));
  if (themeGrid) {
      themeGrid.addEventListener('click', (e) => {
        const card = (e.target as HTMLElement).closest<HTMLElement>('.theme-card');
        if (card?.dataset.theme) {
          applyTheme(card.dataset.theme);
          closeModal(themeModal);
        }
      });
  }

  if (clearResultsBtn) clearResultsBtn.addEventListener('click', clearDiceResults);
  if (diceGrid) {
      diceGrid.addEventListener('click', (e) => {
        const target = e.target as HTMLElement;
        const dieItem = target.closest('.die-item') as HTMLElement;
        if (!dieItem) return;

        // Handle Roll All button
        if (dieItem.id === 'roll-all-btn-item') {
            import('./features').then(m => m.handleRollAll());
            return;
        }

        if (target.closest('.die-visual')) { handleDieRoll(dieItem); }
        const quantityInput = dieItem.querySelector('.quantity-input') as HTMLInputElement;
        let value = parseInt(quantityInput.value, 10);
        if (target.classList.contains('plus')) {
          quantityInput.value = String(Math.min(99, value + 1));
        } else if (target.classList.contains('minus')) {
          quantityInput.value = String(Math.max(0, value - 1));
        }
      });
  }
  
  if (inventoryBtn) {
      inventoryBtn.addEventListener('click', () => {
          inventoryPopup.classList.toggle('visible');
          if (inventoryPopup.classList.contains('visible')) {
              fetchAndRenderInventoryPopup();
          }
      });
  }
  if (closeInventoryBtn) closeInventoryBtn.addEventListener('click', () => inventoryPopup.classList.remove('visible'));
  if (refreshInventoryBtn) refreshInventoryBtn.addEventListener('click', fetchAndRenderInventoryPopup);
  
  if (quickActionsBar) {
      quickActionsBar.addEventListener('click', (e) => {
          const button = (e.target as HTMLElement).closest<HTMLButtonElement>('.quick-action-btn');
          if (button?.dataset.command) {
              const command = button.dataset.command;
              const currentLength = chatInput.value.length;
              chatInput.value += command;
              chatInput.focus();
              
              const quoteIndex = command.indexOf('""');
              if (quoteIndex !== -1) {
                  const newCursorPos = currentLength + quoteIndex + 1;
                  chatInput.setSelectionRange(newCursorPos, newCursorPos);
              }
          }
      });
  }

  if (inventoryPopupContent) {
      inventoryPopupContent.addEventListener('click', (e) => {
          const button = (e.target as HTMLElement).closest<HTMLButtonElement>('.use-item-btn');
          if (button?.dataset.itemName) {
              chatInput.value = `I use ${button.dataset.itemName}`;
              inventoryPopup.classList.remove('visible');
              chatForm.requestSubmit();
          }
      });
  }

  if (fileUploadBtn) fileUploadBtn.addEventListener('click', () => fileUploadInput.click());
  if (fileUploadInput) fileUploadInput.addEventListener('change', handleFileUpload);

  if (engineVariantSelect) {
    engineVariantSelect.addEventListener('change', () => {
      const newVariant = engineVariantSelect.value as 'pro' | 'flash';
      getUISettings().engineVariant = newVariant;
      dbSet('dm-os-ui-settings', getUISettings());
      
      const currentChat = getCurrentChat();
      if (currentChat) {
          loadChat(currentChat.id);
      }
    });
  }

  if (rulesetSelect) {
    rulesetSelect.addEventListener('change', () => {
      const newRulesetId = rulesetSelect.value;
      const currentChat = getCurrentChat();
      if (currentChat) {
        currentChat.rulesetId = newRulesetId;
        saveChatHistoryToDB();
        loadChat(currentChat.id);
      }
    });
  }
}

/**
 * Initializes the application.
 */
async function initApp() {
  try {
      await initDB();

      // Ensure history and context are fully loaded into state before proceeding.
      // This sequential load prevents potential race conditions in initial session recovery.
      await loadChatHistoryFromDB();
      await loadUserContextFromDB();

      const [themeId, savedUiSettings, savedPersonaId] = await Promise.all([
        dbGet<string>('dm-os-theme'),
        dbGet<UISettings>('dm-os-ui-settings'),
        dbGet<string>('dm-os-persona'),
      ]);

      if (savedUiSettings) {
        setUISettings({ ...getUISettings(), ...savedUiSettings });
      }
      
      const version = getUISettings().systemVersion || '2.0';
      await runBootSequence(version);

      applyTheme(themeId || 'high-fantasy-dark');
      applyUISettings();

      if (savedPersonaId && dmPersonas.some(p => p.id === savedPersonaId)) {
        setCurrentPersonaId(savedPersonaId);
      }

      renderDiceGrid();
      renderThemeCards();
      renderUserContext(getUserContext());
      renderChatHistory();
      refreshLogbookTree();

      const history = getChatHistory();
      if (history.length > 0) {
        const mostRecentChat = [...history].sort((a, b) => b.createdAt - a.createdAt)[0];
        loadChat(mostRecentChat.id);
      } else {
        await startNewChat();
      }

      setupEventListeners();
      showWelcomeModalIfNeeded();
  } catch (err) {
      console.error("Fatal error during application initialization:", err);
      document.body.innerHTML = `<div style="color: white; padding: 2rem; text-align: center; font-family: sans-serif;">
            <h1>Oops! Something went wrong.</h1>
            <p>DM OS could not start.</p>
            <p>Details: ${err instanceof Error ? err.message : String(err)}</p>
            <button onclick="location.reload()" style="margin-top: 1rem; padding: 0.5rem 1rem; cursor: pointer;">Reload</button>
        </div>`;
  }
}

// Start the application
initApp();
