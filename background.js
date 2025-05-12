// background.js (Complete Replacement - 2025-04-29)

const DEBUG = true;
const CLOUD_FUNCTION_URL = 'https://us-central1-promptiq-backend.cloudfunctions.net/enhancePromptProxy';

let sidePanelTabId = null; // Track the tab associated with the *active* side panel instance
let sidePanelWindowId = null; // Track the window associated with the *active* side panel instance
let latestEnhancedText = null; // Store the last successful enhancement

// --- Logging Function ---
function log(...args) {
    if (DEBUG) {
        const timestamp = new Date().toISOString(); // Use ISO for better sorting/parsing
        console.log(`BG [${timestamp}]:`, ...args);
    }
}

// --- Open Side Panel Function ---
async function openSidePanelForTab(tab) {
    if (!tab || !tab.windowId || !tab.id) {
        log("Cannot open side panel, invalid tab provided:", tab);
        return;
    }
    const targetWindowId = tab.windowId;
    log(`Attempting to open side panel for tab ${tab.id} in window ${targetWindowId}...`);

    try {
        // MV3 sidePanel API opens per window. If already open in the window, it should just focus.
        await chrome.sidePanel.open({ windowId: targetWindowId });
        log(`Side panel open requested for window ${targetWindowId}.`);
        // Track the window and potentially the tab that triggered the open
        sidePanelWindowId = targetWindowId;
        // Panel should confirm its tab ID on connection/message
        // sidePanelTabId = tab.id;
    } catch (error) {        console.error(`Error opening side panel for window ${targetWindowId}:`, error);
    }
}

// --- Handle Extension Icon Click ---
chrome.action.onClicked.addListener(async (tab) => {
    log("Extension icon clicked on tab:", tab.id, tab.url);
    if (tab && tab.id) {
        // Optional: Check if the URL is supported before opening
        // You might have more specific checks based on your manifest content_scripts matches
        log(`Opening side panel for tab: ${tab.id}`);
        await openSidePanelForTab(tab);
    } else {
        log("Icon clicked but couldn't get valid tab information.");
    }
});


// --- Main Message Listener ---
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    log(`Message received:`, message, `From Sender:`, sender);

    // Determine if the sender is the side panel or a content script
    const isFromSidePanel = !sender.tab; // Messages from extension pages (like side panel) don't have sender.tab
    const isFromContentScript = !!sender.tab;
    const senderTabId = sender.tab ? sender.tab.id : null;

    let messageHandled = false; // Flag to track if we processed the message type
    let requiresAsyncResponse = false; // Flag to indicate if sendResponse will be called later

    // --- Message Handling Logic ---
    switch (message.type) {
        case 'panelReady': // Panel sends message when it's loaded and knows its tab ID
            if (isFromSidePanel && message.tabId && message.windowId) { // Ensure windowId is also sent
                 sidePanelTabId = message.tabId; // Store the panel's associated tab ID
                 sidePanelWindowId = message.windowId; // Store the panel's window ID
                 log(`Panel ready message received. Associated Tab ID: ${sidePanelTabId}, Window ID: ${sidePanelWindowId}`);
                 messageHandled = true;
                 // Optionally send confirmation back or request initial input here
                 // sendResponse({ success: true, message: "Panel registered." });
            } else {
                 log("Received 'panelReady' but sender is not panel or tabId/windowId missing.", message, sender);
            }
            break;

        case 'getCurrentInputFromContent':
            // Request comes from the panel (isFromSidePanel should be true)
            // It needs the input from the content script in a specific tab (message.tabId)
            log(`Received '${message.type}' request from panel for tab ${message.tabId}`);
            if (!isFromSidePanel) {
                log(`Warning: '${message.type}' received from unexpected sender:`, sender);
                sendResponse({ success: false, error: "Invalid sender for this message type." });
                messageHandled = true; // Handled (with error)
                requiresAsyncResponse = false; // Sync response
            } else if (!message.tabId) {
                log("Error: No tabId provided by panel for getCurrentInputFromContent");
                sendResponse({ success: false, error: "Panel did not specify target tab ID." });
                messageHandled = true; // Handled (with error)
                requiresAsyncResponse = false; // Sync response
            } else {
                const targetTabId = message.tabId;
                requiresAsyncResponse = true; // IMPORTANT! We need to wait for content script                messageHandled = true;

                log(`Sending 'getCurrentInput' message to content script in tab ${targetTabId}`);
                chrome.tabs.sendMessage(
                    targetTabId,
                    { type: 'getCurrentInput' },
                    (contentResponse) => {
                        // This callback executes when the content script replies (or fails)
                        log(`Received response from content script (tab ${targetTabId}) for 'getCurrentInput':`, contentResponse);

                        if (chrome.runtime.lastError) {
                            log(`Error messaging content script in tab ${targetTabId}:`, chrome.runtime.lastError.message);
                            try {
                                sendResponse({ success: false, error: `Failed to communicate with content script: ${chrome.runtime.lastError.message}` });                                log(`Sent error response back to panel (content script comms failure).`);
                            } catch (e) {
                                log(`Error sending error response back to panel (port likely closed):`, e);
                            }                        } else if (contentResponse && contentResponse.success === true && typeof contentResponse.text === 'string') {
                            log(`Successfully received input from content script.`);
                            try {
                                sendResponse({ success: true, text: contentResponse.text });
                                log(`Sent success response back to panel with input text.`);
                            } catch (e) {
                                log(`Error sending success response back to panel (port likely closed):`, e);
                            }
                        } else {
                            // Handle cases where content script sends success:false or unexpected format
                            const errorMsg = contentResponse?.error || "Unknown error or unexpected response from content script.";
                            log(`Content script responded with error or unexpected format:`, errorMsg, contentResponse);
                             try {
                                sendResponse({ success: false, error: errorMsg });
                                log(`Sent error response back to panel (content script error/format).`);
                            } catch (e) {
                                log(`Error sending error response back to panel (port likely closed):`, e);
                            }
                        }
                    } // End of content script callback
                ); // End of chrome.tabs.sendMessage
                log(`Async message sent to content script (tab ${targetTabId}). Waiting for its response...`);
            }
            break; // End case 'getCurrentInputFromContent'

        case 'updatePreviewToPanel':
             // Request comes from content script (isFromContentScript should be true)
             // It sends the latest input text to be displayed in the panel
             if (isFromContentScript) { // *** Only check if it's from content script ***
                 log(`Received '${message.type}' from content script (tab ${senderTabId}). Text length: ${message.text?.length}. Attempting to forward to panel.`);

                 // Log if the window ID isn't known yet, but still try to send
                 if (!sidePanelWindowId) {
                    log(`Note: Side panel window ID is not yet known by background script, but attempting to forward update anyway.`);
                 }

                 // Forward this message to the side panel using runtime.sendMessage
                 // The panel should be listening regardless of whether the background knows its window ID yet.
                 chrome.runtime.sendMessage({
                     type: 'updatePreview', // Panel listens for this type
                     text: message.text
                 }).catch(error => {
                     // This catch is important if the panel isn't open or listening
                     // Don't log aggressively if it's the common "no receiving end" error
                     if (error && error.message && !error.message.includes("Receiving end does not exist")) {
                        log(`Error forwarding 'updatePreviewToPanel' to panel:`, error.message);
                     } else if (!error) {
                        log(`Unknown error forwarding 'updatePreviewToPanel' to panel.`);
                     } else {
                        // Log less verbosely for the common case
                        // log(`Panel not ready or closed when trying to forward 'updatePreviewToPanel'.`);
                     }
                 });                 messageHandled = true;
                 // No response needed back to content script for this
                 requiresAsyncResponse = false; // Sync processing
             } else {
                 // This case should ideally not happen if the message type is correct
                 log(`Warning: '${message.type}' received but sender is not a content script:`, sender);                 messageHandled = true; // Handled (ignored)
                 requiresAsyncResponse = false; // Sync processing
             }
             break; // End case 'updatePreviewToPanel'


        case 'pasteTextToContent':
            // Request comes from the panel (isFromSidePanel should be true)
            // It wants to paste text into a specific tab (message.tabId)
            log(`Received '${message.type}' request from panel for tab ${message.tabId}. Text length: ${message.text?.length}`);
            if (!isFromSidePanel) {
                 log(`Warning: '${message.type}' received from unexpected sender:`, sender);
                 sendResponse({ success: false, error: "Invalid sender for this message type." });
                 messageHandled = true; // Handled (with error)
                 requiresAsyncResponse = false; // Sync response
            } else if (!message.tabId || message.text === undefined || message.text === null) { // Check text validity
                log("Error: Missing tabId or invalid text for pasteTextToContent");
                sendResponse({ success: false, error: "Missing target tab ID or text to paste." });
                messageHandled = true; // Handled (with error)
                requiresAsyncResponse = false; // Sync response
            } else {
                const targetTabId = message.tabId;
                requiresAsyncResponse = true; // Wait for content script confirmation
                messageHandled = true;

                log(`Sending 'pasteText' message to content script in tab ${targetTabId}`);
                chrome.tabs.sendMessage(
                    targetTabId,
                    { type: 'pasteText', text: message.text },                    (contentResponse) => {
                         log(`Received response from content script (tab ${targetTabId}) for 'pasteText':`, contentResponse);
                         if (chrome.runtime.lastError) {
                             log(`Error messaging content script for paste in tab ${targetTabId}:`, chrome.runtime.lastError.message);                              try {
                                 sendResponse({ success: false, error: `Paste failed (comms error): ${chrome.runtime.lastError.message}` });
                                 log(`Sent error response back to panel (paste comms failure).`);
                             } catch (e) { log(`Error sending paste error response back to panel:`, e); }
                         } else if (contentResponse && contentResponse.success) {
                             log(`Paste successful in content script.`);
                              try {
                                 sendResponse({ success: true });
                                 log(`Sent success response back to panel for paste.`);
                             } catch (e) { log(`Error sending paste success response back to panel:`, e); }
                         } else {
                             const errorMsg = contentResponse?.error || "Paste failed in content script.";
                             log(`Paste failed in content script:`, errorMsg, contentResponse);
                             try {
                                 sendResponse({ success: false, error: errorMsg });
                                 log(`Sent error response back to panel (paste failure in content).`);
                             } catch (e) { log(`Error sending paste failure response back to panel:`, e); }
                         }
                    } // End content script callback
                ); // End sendMessage
                 log(`Async message sent to content script (tab ${targetTabId}) for paste. Waiting for response...`);
            }            break; // End case 'pasteTextToContent'

            case 'enhancePromptRequest':
                // Request comes from the panel (isFromSidePanel should be true)
                log(`Received '${message.type}' request from panel.`);
                if (!isFromSidePanel) {
                    log(`Warning: '${message.type}' received from unexpected sender:`, sender);
                    sendResponse({ success: false, error: "Invalid sender." });
                    requiresAsyncResponse = false; // Sync response
                    messageHandled = true;
                } else if (!message.prompt || typeof message.strength !== 'number' || !message.idToken) {
                    log("Error: Missing prompt, strength, or idToken for enhancement request.");
                    sendResponse({ success: false, error: "Missing required fields for enhancement." });
                    requiresAsyncResponse = false; // Sync response
                    messageHandled = true;
                } else {
                    // This path requires an async response
                    requiresAsyncResponse = true;
                    messageHandled = true;
                    log(`Calling Cloud Function proxy for enhancement...`);

                    // --- Call Cloud Function ---
                    if (!CLOUD_FUNCTION_URL || CLOUD_FUNCTION_URL === 'YOUR_CLOUD_FUNCTION_PROXY_URL') { // Check placeholder too
                        log("Error: CLOUD_FUNCTION_URL is not configured correctly.");
                        sendResponse({ success: false, error: "Server endpoint not configured. Please contact support." });
                        requiresAsyncResponse = false; // Sent sync error response
                    } else {
                        // Perform the asynchronous fetch
                        fetch(CLOUD_FUNCTION_URL, {
                            method: 'POST',
                            headers: {
                                'Content-Type': 'application/json',
                                'Authorization': `Bearer ${message.idToken}` // Send Firebase token
                            },
                            body: JSON.stringify({
                                prompt: message.prompt,
                                strength: message.strength
                            })
                        })
                        .then(response => { // Handle the response
                            log(`Cloud Function response status: ${response.status}`);
                            // Store status before consuming body
                            const status = response.status;
                            // Try to get text/json regardless of status for better error reporting
                            // Return an object containing status, text, and ok status
                            return response.text().then(text => ({ status, text, ok: response.ok }));
                        })
                        .then(({ status, text, ok }) => { // Handle the parsed text/status object
                            let data;
                            try {
                                data = JSON.parse(text); // Try parsing JSON
                            } catch (e) {
                                // If JSON parsing fails, use raw text for error message
                                log(`Cloud Function response was not valid JSON: ${text}`);
                                // If the original status was OK, this is an unexpected format error
                                if (ok) {
                                    throw new Error("Invalid JSON response format from enhancement service.");
                                } else {
                                // Otherwise, use the text in the error from the non-OK response
                                    throw new Error(`Cloud Function Error ${status}: ${text || 'Empty response body'}`);
                                }
                            }

                            // Now check the parsed data and original status
                            if (!ok) {
                                // Throw error using parsed message if available, otherwise use text
                                throw new Error(`Cloud Function Error ${status}: ${data?.error || text || 'Unknown error'}`);
                            }

                            // If response is OK and data is valid
                            if (data && data.success === true && typeof data.enhancedText === 'string') {
                                log("Cloud Function returned enhanced text.");
                                latestEnhancedText = data.enhancedText; // Store it
                                try {
                                    sendResponse({ success: true, enhancedText: data.enhancedText });
                                    log("Sent enhanced text back to panel.");
                                } catch (e) {                                    log("Error sending enhancement success to panel (port likely closed):", e.message);
                                }                            } else {
                                // Handle cases where response is OK but data indicates failure or wrong format
                                log("Error: Cloud Function response format unexpected or indicates failure:", data);
                                throw new Error(data?.error || "Invalid response format or failure indicated by enhancement service.");
                            }
                        })
                        .catch(error => { // Handle any errors from fetch() or .then() blocks
                            console.error("Error during enhancement fetch/processing:", error);
                            try {
                                sendResponse({ success: false, error: `Enhancement failed: ${error.message}` });                                log("Sent enhancement failure back to panel.");
                            } catch (e) {
                                log("Error sending enhancement failure to panel (port likely closed):", e.message);
                            }
                        });
                        // Note: sendResponse is called inside .then() or .catch(), which is asynchronous
                    }
                    // --- End Cloud Function Call ---
                }
                break; // End case 'enhancePromptRequest'


        // Add other message types as needed
        default:
            log(`Unhandled message type: ${message.type}`);
            // Optionally send a response for unhandled types
            // sendResponse({ success: false, error: `Unknown message type: ${message.type}` });
            messageHandled = false; // Explicitly mark as not handled
            requiresAsyncResponse = false; // Sync processing (no response needed)
            break;
    } // End switch

    // --- Return Value ---
    // Return true IF AND ONLY IF sendResponse will be called asynchronously.
    // Otherwise, the message channel closes prematurely for async responses.
    if (requiresAsyncResponse) {
        log(`Message type '${message.type}' requires async response. Returning true.`);
    } else {
         log(`Message type '${message.type}' processed synchronously or not handled. Returning false/undefined.`);
    }
    return requiresAsyncResponse;
});

log("Background script loaded and listeners attached.");

// Optional: Keep-alive for Manifest V3 service worker (use only if needed)
/*
let keepAliveInterval;
chrome.runtime.onConnect.addListener(port => {
  if (port.name === 'keepAlive') {
    log("Keep-alive connection established.");
    keepAliveInterval = setInterval(() => {
      try {
        port.postMessage({ message: 'ping' });
        log("Sent keep-alive ping.");
      } catch (e) {
        log("Keep-alive port disconnected. Clearing interval.", e);
        clearInterval(keepAliveInterval);
      }
    }, 25 * 1000); // Send ping every 25 seconds

    port.onDisconnect.addListener(() => {
      log("Keep-alive port disconnected externally. Clearing interval.");
      clearInterval(keepAliveInterval);
    });
  }
});
*/
