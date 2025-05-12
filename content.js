// content.js (Revised with detailed logging)

const DEBUG = true; // Set true for console logs
let currentInputField = null;
let lastSentValue = null;
let debounceTimer = null;
const DEBOUNCE_DELAY = 500; // ms

function log(...args) {
  if (DEBUG) {
    console.log("Content Script:", ...args);
  }
}

// --- Input Field Detection ---

// Prioritized selectors for known sites (like ChatGPT)
const specificSelectors = [
  '#prompt-textarea', // ChatGPT  'textarea[data-id="root"]', // ChatGPT alternative?
  '#chat-input', // Generic chat input ID
  'textarea[placeholder*="Send a message"]', // Common placeholder
  'textarea[placeholder*="Ask anything"]', // Another common one
  '[role="textbox"][contenteditable="true"]', // Common contenteditable pattern
];

// Generic fallback selectors
const genericSelectors = [
  'textarea',
  'input[type="text"]',
  '[contenteditable="true"]',
];

function findPromptBox() {
  log("Attempting to find prompt box...");
  let element = null;

  // Try specific selectors first
  for (const selector of specificSelectors) {
    element = document.querySelector(selector);
    if (element) {
      log(`Found input field using specific selector: ${selector}`);
      return element;
    }
  }
  log("No specific selectors matched. Trying generic selectors...");
  // Try generic selectors if specific ones fail
  for (const selector of genericSelectors) {
    // Be more careful with generic selectors - avoid tiny/hidden ones
    const potentialElements = document.querySelectorAll(selector);
    for (const el of potentialElements) {
        // Basic visibility and size check (customize as needed)
        const rect = el.getBoundingClientRect();
        if (rect.width > 50 && rect.height > 10 && el.offsetParent !== null) {
             log(`Found potentially suitable input field using generic selector: ${selector}`);
             return el; // Return the first suitable generic match
        }
    }
  }

  log("Could not find a suitable input field.");
  return null;
}

// --- Get Input Value ---

function getInputValue(element) {
  if (!element) return null;
  if (element.tagName === 'TEXTAREA' || element.tagName === 'INPUT') {    return element.value;
  } else if (element.isContentEditable) {
    return element.innerText; // Or innerHTML depending on needs
  }
  return null;
}

// --- Set Input Value (for Pasting) ---

function setInputValue(element, text) {
    if (!element) {
        log("Cannot set value, element not found.");
        return false;
    }
    log(`Attempting to set value for element:`, element);

    // Store current value if needed for comparison or undo
    // const oldValue = getInputValue(element);

    if (element.tagName === 'TEXTAREA' || element.tagName === 'INPUT') {
        element.value = text;
        log(`Set value for ${element.tagName}. New value: ${element.value}`);
        // Dispatch events to notify the page framework (React, Vue, etc.)
        element.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
        element.dispatchEvent(new Event('change', { bubbles: true, cancelable: true }));
    } else if (element.isContentEditable) {        element.innerText = text; // Or innerHTML
        log(`Set innerText for contentEditable. New text: ${element.innerText}`);
        // Dispatch events for contentEditable (might need different events depending on framework)
        element.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
        element.dispatchEvent(new Event('blur', { bubbles: true, cancelable: true })); // Sometimes needed
        element.dispatchEvent(new Event('focus', { bubbles: true, cancelable: true })); // Sometimes needed
    } else {
        log("Element is not a supported input type (textarea, input, contentEditable).");
        return false;
    }

    log("Dispatched input/change/blur/focus events.");
    return true;
}


// --- Send Update to Background ---

function sendUpdateToBackground() {
  if (!currentInputField) {
    // log("No active input field to send update from."); // Can be noisy
    return;
  }
  const currentValue = getInputValue(currentInputField);
  if (currentValue !== lastSentValue) {
    log(`Input changed. Sending updatePreviewToPanel. Length: ${currentValue?.length}`);
    lastSentValue = currentValue;
    chrome.runtime.sendMessage({
      type: 'updatePreviewToPanel',
      text: currentValue
    }).catch(error => {
      // Log error if background/panel is not listening (e.g., panel closed)
      // log("Failed to send updatePreviewToPanel (panel might be closed):", error.message);
    });
  }
}

// --- Debounced Send Update ---

function debouncedSendUpdate() {
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(sendUpdateToBackground, DEBOUNCE_DELAY);
}

// --- Event Listeners for Input Changes ---

function addInputListeners(element) {
  if (!element) return;
  log(`Adding input listeners to:`, element);  // Use 'input' event as it covers typing, pasting, etc.
  element.removeEventListener('input', debouncedSendUpdate); // Remove previous if any
  element.addEventListener('input', debouncedSendUpdate);
  // Optionally listen to 'change' or 'keyup' if needed, but 'input' is usually best
}

function removeInputListeners(element) {
    if (!element) return;
    log(`Removing input listeners from:`, element);
    element.removeEventListener('input', debouncedSendUpdate);
}


// --- Focus Tracking ---
// Use event delegation on the document to catch focus events more reliably
function handleFocusIn(event) {
    const target = event.target;
    // Check if the focused element matches our criteria
    if (target && (
        specificSelectors.some(sel => target.matches(sel)) ||
        (target.matches('textarea, input[type="text"], [contenteditable="true"]') && target.offsetParent !== null)
       )
      )
    {
        log("Focus detected on a potential input field:", target);
        if (target !== currentInputField) {
            log("Switching tracked input field.");
            if (currentInputField) {
                removeInputListeners(currentInputField);
            }
            currentInputField = target;
            lastSentValue = getInputValue(currentInputField); // Get initial value on focus
            addInputListeners(currentInputField);
            // Send initial state immediately on focus
            sendUpdateToBackground();
        }
    }
}

function handleFocusOut(event) {
    // Optional: Clear currentInputField or stop listening if focus moves outside relevant areas
    // const relatedTarget = event.relatedTarget;
    // if (currentInputField && (!relatedTarget || !currentInputField.contains(relatedTarget))) {
    //     log("Focus moved out of the tracked input field:", currentInputField);
    //     // removeInputListeners(currentInputField); // Decide if you want to stop listening on blur
    //     // currentInputField = null;
    // }
}

// Attach focus listeners to the document
document.addEventListener('focusin', handleFocusIn, true); // Use capture phase for focusin
// document.addEventListener('focusout', handleFocusOut, true); // Optional: Use capture phase for focusout


// --- Message Listener (from Background Script) ---

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Ignore messages from self or other content scripts
  if (sender.tab) {
    // log("Ignoring message from other content script:", message, sender);
    return false; // Indicate message not handled synchronously
  }
  if (!message || !message.type) {
      log("Received invalid message (no type):", message);
      return false;
  }

  log(`Message received from background:`, message);
  let requiresAsyncResponse = false; // Flag if sendResponse is called later

  switch (message.type) {
    case 'getCurrentInput':
      log("Received 'getCurrentInput' request from background.");
      // Try to find the input field *now* if not already tracked or if current is invalid
      if (!currentInputField || !document.contains(currentInputField)) {
          log("No valid currentInputField tracked, attempting to find one now...");
          currentInputField = findPromptBox();
      }

      if (currentInputField) {
        const text = getInputValue(currentInputField);
        log(`Found input field. Current value: "${text ? text.substring(0, 50) + '...' : ''}". Sending response.`);
        sendResponse({ success: true, text: text });
      } else {
        log("Could not find input field to get current value. Sending error response.");
        sendResponse({ success: false, error: "Could not find input field on the page." });
      }
      break; // Synchronous response sent

    case 'pasteText':
      log("Received 'pasteText' request from background.");
      if (!currentInputField || !document.contains(currentInputField)) {
          log("Paste target not found or invalid, attempting to find one now...");
          currentInputField = findPromptBox();
      }

      if (currentInputField && message.text !== undefined) {
        log(`Pasting text into:`, currentInputField);
        const success = setInputValue(currentInputField, message.text);
        if (success) {
            log("Pasting successful. Sending success response.");
            lastSentValue = message.text; // Update last sent value after paste
            sendResponse({ success: true });
        } else {
             log("Pasting failed (setInputValue returned false). Sending error response.");
             sendResponse({ success: false, error: "Failed to set value in the input field." });
        }
      } else if (!currentInputField) {
         log("Could not find input field to paste into. Sending error response.");
         sendResponse({ success: false, error: "Could not find target input field for pasting." });
      } else {
         log("No text provided for pasting. Sending error response.");
         sendResponse({ success: false, error: "No text provided in the paste request." });
      }
      break; // Synchronous response sent

    default:
      log(`Unhandled message type from background: ${message.type}`);
      break;
  }

  // Return true if sendResponse was called asynchronously (which it isn't in this version)
  // Return false or undefined otherwise.
   log(`Message handler finished for type '${message.type}'. Returning false (no async response).`);
  return false;
});

// --- Initial Setup ---

function initializeContentScript() {
    log("Content script initializing...");
    // Try to find the input field immediately on load/injection
    currentInputField = findPromptBox();
    if (currentInputField) {
        addInputListeners(currentInputField);
        lastSentValue = getInputValue(currentInputField);
        log("Initial input field found and listeners attached.", currentInputField);
        // Send initial state to panel if it's already open
        sendUpdateToBackground();
    } else {
        log("No initial input field found. Waiting for focus events.");
    }
    // Focus listener is already attached to the document
}

// Run initialization
initializeContentScript();

log("PromptIQ Content Script Loaded.");
