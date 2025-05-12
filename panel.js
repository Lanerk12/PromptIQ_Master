// panel.js

// --- Constants & Global Variables ---
const DEBUG = true; // Set to true for detailed console logs
let currentTabId = null;
let firebaseInitialized = false;
let auth = null; // Firebase Auth service
let currentUser = null; // Store the current logged-in user object
let authStateListenerUnsubscribe = null; // To store the unsubscribe function
let panelMessageListenerAdded = false; // Flag to ensure listener is added only once

// --- Firebase Configuration ---
// IMPORTANT: Replace with your actual Firebase config object
const firebaseConfig = {
    apiKey: "AIzaSyCF10-Urey-QiBaPQ8ZqR3G2uuMFQ51W7A",
    authDomain: "promptiq-backend.firebaseapp.com",
    projectId: "promptiq-backend",
    storageBucket: "promptiq-backend.firebasestorage.app",
    messagingSenderId: "383186298585",
    appId: "1:383186298585:web:8e1851835ca2d28e2940c8",
    measurementId: "G-9FHWFS7Z9G"
  };

// --- DOM Element Variables ---
// Declared globally, assigned in getElements()
let authSection, loggedInSection, enhancerSection, separator;
let emailInput, passwordInput, loginButton, signupButton, logoutButton, authError;
let userEmailDisplay;
let strengthSlider, strengthValue;
let originalPreviewBox, enhancedPreviewBox;
let enhanceButton, pasteButton;
let statusDiv; // For general status/error messages

// --- Logging Function ---
function log(...args) {  if (DEBUG) {
    console.log("Panel:", ...args);
  }
}

// --- Status Update Function ---
function updateStatus(message, type = 'info') { // type can be 'info', 'success', 'error', 'loading'
    if (!statusDiv) {
        statusDiv = document.getElementById('status');
        if (!statusDiv) {
            log("Error: statusDiv element not found during updateStatus call.");
            return; // Exit if still not found
        }
    }
    statusDiv.textContent = message;    const validTypes = ['info', 'success', 'error', 'loading'];
    const className = validTypes.includes(type) ? `status-${type}` : 'status-info';
    statusDiv.classList.remove('status-info', 'status-success', 'status-error', 'status-loading');
    statusDiv.classList.add('status-message', className); // Use classes for styling
    log(`Status Updated (${type}):`, message);
}


// --- Firebase Initialization ---
function initializeFirebase() {
    log("Attempting Firebase Initialization...");
    try {
        if (!firebase?.apps?.length) {
            firebase.initializeApp(firebaseConfig);
            log("Firebase Initialized Successfully.");
        } else {
            firebase.app(); // Get default app
            log("Firebase already initialized.");
        }
        auth = firebase.auth();
        firebaseInitialized = true;
        log("Firebase Auth service obtained.");
        setupAuthListener(); // Setup listener AFTER auth is initialized
    } catch (error) {
        console.error("Firebase Initialization Failed:", error);
        const errorMsg = `Critical Error: Firebase Initialization Failed. Check console and config. ${error.message}`;
        updateStatus(errorMsg, 'error');        document.body.innerHTML = `<div style="color: red; padding: 15px; font-family: sans-serif;">Error initializing Firebase. Check console. Error: ${error.message}</div>`;
        firebaseInitialized = false;    }
}

// --- Get Current Tab ID ---
async function getCurrentTabId() {
    log("Getting current tab ID...");
    try {
        // For side panels, chrome.tabs.getCurrent() is often unreliable. Query is better.
        const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
        if (tabs && tabs.length > 0 && tabs[0].id) {
            currentTabId = tabs[0].id;
            log("Current Tab ID (via query):", currentTabId);
        } else {
            log("Could not get active tab ID via query. Tabs found:", tabs);            updateStatus("Error: Could not identify the target tab.", 'error');
            currentTabId = null;        }
    } catch (error) {
        console.error("Error getting current tab ID:", error);
        updateStatus(`Error getting tab ID: ${error.message}`, 'error');
        currentTabId = null;
    }
}


// --- Get DOM Elements ---
function getElements() {
    log("Getting DOM elements...");
    let allFound = true;
    const missingElements = [];

    const getElement = (id) => {
        const element = document.getElementById(id);
        if (!element) {
            console.error(`Critical Error: Element with ID '${id}' not found in panel.html!`);
            missingElements.push(id);
            allFound = false;
        }
        return element;
    };    authSection = getElement('authSection');
    loggedInSection = getElement('loggedInSection');
    enhancerSection = getElement('enhancerSection');
    separator = getElement('separator');

    emailInput = getElement('emailInput');
    passwordInput = getElement('passwordInput');
    loginButton = getElement('loginButton');
    signupButton = getElement('signupButton');
    logoutButton = getElement('logoutButton');
    authError = getElement('authError');
    userEmailDisplay = getElement('userEmail');

    strengthSlider = getElement('strengthSlider');
    strengthValue = getElement('strengthValue');    originalPreviewBox = getElement('originalPreviewBox');
    enhancedPreviewBox = getElement('enhancedPreviewBox');
    enhanceButton = getElement('enhanceButton');
    pasteButton = getElement('pasteButton');    statusDiv = getElement('status');

    if (!allFound) {
        updateStatus(`Error: UI elements missing: ${missingElements.join(', ')}. Check panel.html IDs.`, 'error');
        log("One or more essential elements could not be found.");
        return false; // Indicate failure
    }

    log("All essential DOM elements found.");
    return true; // Indicate success
}


// --- Update UI Based on Authentication State ---
function updateUIForAuthState(user) {
    log("Updating UI for Auth State. User:", user ? user.email : 'null');

    if (!authSection || !loggedInSection || !enhancerSection) { // Check minimal required elements
        log("UI elements not ready during auth state update. Retrying element retrieval.");
        if (!getElements()) {
             log("Failed to get elements during auth state update retry.");
             return; // Abort if elements are still missing
        }
    }

    if (user) {
        currentUser = user;
        authSection.style.display = 'none';
        loggedInSection.style.display = 'block';
        enhancerSection.style.display = 'block';
        separator.style.display = 'block';
        userEmailDisplay.textContent = user.email || 'Logged In';
        if (authError) authError.textContent = '';

        originalPreviewBox.value = 'Requesting input from page...';
        enhancedPreviewBox.value = '';
        enhanceButton.disabled = true;
        pasteButton.disabled = true;
        updateStatus('Logged in. Requesting page input...');
        // IMPORTANT: Request input *after* UI update seems complete
        setTimeout(requestCurrentInput, 50); // Small delay might help stability

    } else {
        currentUser = null;
        authSection.style.display = 'block';
        loggedInSection.style.display = 'none';
        enhancerSection.style.display = 'none';
        separator.style.display = 'none';
        userEmailDisplay.textContent = '';

        loginButton.disabled = false;
        signupButton.disabled = false;

        originalPreviewBox.value = 'Please log in.';
        enhancedPreviewBox.value = '';
        enhanceButton.disabled = true;
        pasteButton.disabled = true;        updateStatus('Please log in or sign up.');

        emailInput.value = '';
        passwordInput.value = '';
        if (authError) authError.textContent = '';
    }
}


// --- Firebase Auth Listener Setup ---
function setupAuthListener() {
    if (!auth) {
        log("Cannot setup auth listener, Firebase Auth not initialized.");
        return;
    }
    log("Setting up Firebase Auth State Listener...");

    if (typeof authStateListenerUnsubscribe === 'function') {
        authStateListenerUnsubscribe();
        log("Detached previous auth state listener.");
    }

    authStateListenerUnsubscribe = auth.onAuthStateChanged(user => {
        log("onAuthStateChanged triggered. User:", user ? user.email : 'null');        // Ensure DOM is ready before updating UI
        if (document.readyState === 'loading') {
             log("Auth state change before DOM ready, deferring UI update.");
             document.addEventListener('DOMContentLoaded', () => {
                 log("DOMContentLoaded after auth change, updating UI.");
                 if (!authSection) getElements(); // Ensure elements grabbed
                 updateUIForAuthState(user);
             }, { once: true });
        } else {
             if (!authSection) getElements(); // Ensure elements grabbed
             updateUIForAuthState(user);
        }
    });
    log("Auth state listener attached successfully.");
}


// --- Event Handlers (Login, Signup, Logout, Slider, Enhance, Paste) ---
// (Keep these handlers as they were in the previous version, assuming they worked once logged in)
// ... handleLoginClick ...
// ... handleSignupClick ...
// ... handleLogoutClick ...
// ... handleSliderInput ...
// ... handleEnhanceClick ...
// ... handlePasteClick ...
// [Copy the full implementations for these functions from the previous working version you provided]
// --- Event Handlers (Copy from previous version) ---

function handleLoginClick() {
    log("Login button clicked.");
    if (!firebaseInitialized || !auth) {
        updateStatus("Error: Firebase not ready. Please reload extension.", 'error');
        if (authError) authError.textContent = 'Initialization error. Cannot log in.';
        return;
    }

    const email = emailInput.value.trim();
    const password = passwordInput.value; // No trim on password
    if (authError) authError.textContent = '';

    if (!email || !password) {
        if (authError) authError.textContent = 'Please enter both email and password.';
        return;
    }

    loginButton.disabled = true;
    signupButton.disabled = true;
    if (authError) authError.textContent = 'Logging in...';
    updateStatus("Logging in...", 'loading');

    auth.signInWithEmailAndPassword(email, password)
        .then((userCredential) => {
            log("Logged in successfully:", userCredential.user.email);
            if (authError) authError.textContent = '';
            // UI update is handled by onAuthStateChanged
        })
        .catch((error) => {
            console.error("Login Error:", error);
            if (authError) authError.textContent = `Login failed: ${error.message}`;
            updateStatus(`Login failed: ${error.message}`, 'error');
            // Re-enable buttons on failure            loginButton.disabled = false;
            signupButton.disabled = false;
        });
}

function handleSignupClick() {
    log("Signup button clicked.");
    if (!firebaseInitialized || !auth) {
        updateStatus("Error: Firebase not ready. Please reload extension.", 'error');
        if (authError) authError.textContent = 'Initialization error. Cannot sign up.';
        return;
    }

    const email = emailInput.value.trim();
    const password = passwordInput.value;
    if (authError) authError.textContent = '';

    if (!email || !password) {
        if (authError) authError.textContent = 'Please enter both email and password.';
        return;
    }
    if (password.length < 6) {
         if (authError) authError.textContent = 'Password should be at least 6 characters.';
        return;
    }

    loginButton.disabled = true;
    signupButton.disabled = true;
    if (authError) authError.textContent = 'Signing up...';
    updateStatus("Signing up...", 'loading');

    auth.createUserWithEmailAndPassword(email, password)
        .then((userCredential) => {
            log("Signed up successfully:", userCredential.user.email);            if (authError) authError.textContent = '';
            // UI update handled by onAuthStateChanged
        })
        .catch((error) => {
            console.error("Signup Error:", error);
            if (authError) authError.textContent = `Signup failed: ${error.message}`;
            updateStatus(`Signup failed: ${error.message}`, 'error');
            // Re-enable buttons on failure
            loginButton.disabled = false;
            signupButton.disabled = false;
        });
}


function handleLogoutClick() {
    log("Logout button clicked.");
    if (!firebaseInitialized || !auth || !auth.currentUser) { // Check if user is actually logged in
        updateStatus("Error: Not logged in or Firebase not ready.", 'error');
        return;
    }
    updateStatus("Logging out...", 'loading');
    logoutButton.disabled = true; // Disable during logout

    auth.signOut()
        .then(() => {
            log("Logged out successfully.");
            // UI update handled by onAuthStateChanged
        })
        .catch((error) => {
            console.error("Logout Error:", error);
            updateStatus(`Logout failed: ${error.message}`, 'error');
             if (auth && auth.currentUser && logoutButton) {
                 logoutButton.disabled = false; // Re-enable on error if still logged in
             }
        });
}

function handleSliderInput() {
    if (strengthValue && strengthSlider) {
        strengthValue.textContent = strengthSlider.value;
    }
}

async function handleEnhanceClick() {
    log("Enhance button clicked.");
    if (!enhanceButton || !pasteButton || !originalPreviewBox || !strengthSlider) {
         updateStatus("Error: UI elements missing for enhancement.", 'error');
         return;
    }

    updateStatus("Starting enhancement...", 'loading');
    enhanceButton.disabled = true;
    pasteButton.disabled = true; // Disable paste while enhancing

    const user = auth?.currentUser; // Use optional chaining
    if (!user) {
        updateStatus('Please log in to enhance prompts.', 'error');
        enhanceButton.disabled = false; // Re-enable button
        return;
    }    let idToken;
    try {
        log("Getting Firebase ID token...");
        updateStatus("Getting authentication token...", 'loading');
        idToken = await user.getIdToken(true); // Force refresh
        if (!idToken) {
            throw new Error("Could not retrieve ID token (null or empty).");        }
        log("Successfully retrieved ID token.");
    } catch (error) {
        console.error("Error getting ID token:", error);
        updateStatus('Authentication error. Please try logging out and back in.', 'error');
        enhanceButton.disabled = false; // Re-enable button
        return;
    }    const promptText = originalPreviewBox.value;
    const strength = parseInt(strengthSlider.value, 10);

    // Check if prompt text is meaningful
    const placeholderTexts = [
        'Requesting input from page...',
        'Input field is empty.',
        'Please log in.',
        'Error: Target tab ID not known.',
        'Error loading input.',
        'Waiting for input from page...'
    ];
    if (!promptText || placeholderTexts.includes(promptText.trim()) || promptText.trim().length === 0) {
        updateStatus('Cannot enhance empty or placeholder input. Type something in the page.', 'error');        enhanceButton.disabled = false; // Re-enable button
        return;
    }

    log(`Sending enhance request to background (Strength: ${strength})`);
    updateStatus('Enhancing prompt via background...', 'loading');    chrome.runtime.sendMessage(
        {
            type: 'enhancePromptRequest',
            prompt: promptText,            strength: strength,
            idToken: idToken // Send the token
        },
        (response) => {
            log("Received response from background for enhance request:", response);

            // Default state after response: re-enable enhance, keep paste disabled until success
            enhanceButton.disabled = false;
            pasteButton.disabled = true; // Keep disabled until success

            if (chrome.runtime.lastError) {
                console.error("Panel Error sending enhance request:", chrome.runtime.lastError.message);
                updateStatus(`Error communicating with background: ${chrome.runtime.lastError.message}`, 'error');
            } else if (response && response.error) {                console.error("Panel received enhancement error:", response.error);
                updateStatus(`Enhancement failed: ${response.error}`, 'error');
                 if (enhancedPreviewBox) enhancedPreviewBox.value = ''; // Clear enhanced preview on error
            } else if (response && response.success && response.enhancedText !== undefined) {                log("Panel received enhanced text.");
                if (enhancedPreviewBox) enhancedPreviewBox.value = response.enhancedText; // Update enhanced preview
                updateStatus('Enhancement successful!', 'success');
                pasteButton.disabled = false; // Enable paste button ONLY on success
            } else {
                console.warn("Panel received unexpected response for enhancement:", response);
                updateStatus('Unknown error during enhancement.', 'error');
                 if (enhancedPreviewBox) enhancedPreviewBox.value = ''; // Clear enhanced preview on unknown error
            }
        }
    );
}


function handlePasteClick() {
    log("Paste button clicked.");
     if (!pasteButton || !enhancedPreviewBox) {
         updateStatus("Error: UI elements missing for paste.", 'error');
         return;
    }
    const textToPaste = enhancedPreviewBox.value;

    if (!textToPaste) {        updateStatus('Nothing to paste. Enhance first.', 'error');
        return;
    }
    if (!currentTabId) {
        updateStatus('Error: Target tab ID not known. Cannot paste.', 'error');
        return;
    }

    updateStatus('Pasting...', 'loading');
    pasteButton.disabled = true; // Disable while pasting

    chrome.runtime.sendMessage(
        {
            type: "pasteTextToContent",
            tabId: currentTabId, // Send target tab ID
            text: textToPaste        },
        (response) => {
            log("Received response from background for paste request:", response);            // Re-enable paste button after attempt by default
            let enablePaste = true;

            if (chrome.runtime.lastError) {
                console.error("Panel Error sending paste request:", chrome.runtime.lastError.message);
                updateStatus(`Paste failed: ${chrome.runtime.lastError.message}`, 'error');
            } else if (response && response.error) {
                console.error("Panel received paste error from background:", response.error);
                updateStatus(`Paste failed: ${response.error}`, 'error');
            } else if (response && response.success) {
                log("Paste successful.");
                updateStatus('Pasted successfully!', 'success');
                // Optionally disable paste button again after successful paste?
                // enablePaste = false; // Uncomment to disable after success
            } else {
                console.warn("Panel received unexpected response for paste:", response);
                updateStatus('Paste failed. Content script might not be responding.', 'error');
            }

            // Re-enable button if it exists and enablePaste is true
             if (pasteButton) {
                 pasteButton.disabled = !enablePaste;
             }
        }
    );
}


// --- Request Input from Content Script ---
// panel.js (Focus on getCurrentInputFromContent callback)

// ... (Keep the rest of your panel.js code from the previous version I provided) ...// --- Request Input from Content Script ---
function requestCurrentInput() {
    log("Attempting to request current input...");
    if (!currentTabId) {
        log("Cannot request input, currentTabId is null.");
        if (currentUser && originalPreviewBox) {
            originalPreviewBox.value = "Error: Target tab ID not known.";
             if (enhanceButton) enhanceButton.disabled = true;
        }
        return;
    }
    if (!currentUser) {
        log("Not requesting input as user is not logged in.");
         if (originalPreviewBox) originalPreviewBox.value = 'Please log in.';
        return;
    }

    log(`Sending getCurrentInputFromContent request to background (for tab ${currentTabId})...`);
    if (originalPreviewBox) originalPreviewBox.value = 'Requesting input from page...'; // Placeholder
    if (enhanceButton) enhanceButton.disabled = true; // Disable enhance while requesting

    try {
        chrome.runtime.sendMessage(
            { type: "getCurrentInputFromContent", tabId: currentTabId },
            (response) => {
                // **** START OF CALLBACK ****
                log(">>>> Callback for getCurrentInputFromContent EXECUTED <<<<"); // Log entry into callback

                // Check for runtime error (e.g., port closed) *immediately*
                if (chrome.runtime.lastError) {
                    console.error("Panel: CRITICAL - chrome.runtime.lastError detected in callback:", chrome.runtime.lastError.message);
                    if (currentUser) {
                        updateStatus(`Error getting input: ${chrome.runtime.lastError.message}`, "error");
                        if (originalPreviewBox) {
                            originalPreviewBox.value = '';
                            originalPreviewBox.placeholder = "Error loading input.";
                        }
                        if (enhanceButton) enhanceButton.disabled = true;
                    }
                     log("<<<< Callback for getCurrentInputFromContent ENDING (runtime.lastError) <<<<");
                    return; // Stop processing
                }

                // If no runtime error, log the received response
                 log("Panel: Received response object for getCurrentInput:", response);

                // Now process the actual response content
                if (!originalPreviewBox) {
                     log("Panel: originalPreviewBox not found in callback. Aborting UI update.");
                     log("<<<< Callback for getCurrentInputFromContent ENDING (!originalPreviewBox) <<<<");
                     return; // Exit if preview box isn't ready
                }

                if (response && response.success === false && response.error) {
                    console.error("Panel: Error explicitly returned from background/content getting input:", response.error);
                    updateStatus(`Error getting input: ${response.error}`, 'error');
                    originalPreviewBox.value = '';
                    originalPreviewBox.placeholder = "Error loading input.";
                    if (enhanceButton) enhanceButton.disabled = true;                } else if (response && response.success === true && typeof response.text === 'string') {
                    log("Panel: Successfully received current input:", response.text);
                    originalPreviewBox.value = response.text;
                    originalPreviewBox.placeholder = "Input from page shown here.";
                    if (enhanceButton) {
                        enhanceButton.disabled = !response.text.trim();
                    }
                    updateStatus(response.text.trim() ? "Ready." : "Ready. Waiting for input in page...", "info");
                } else if (response && (response.text === null || response.text === undefined)) {
                     log("Panel: Initial input response was null/undefined, waiting for live updates.");
                     originalPreviewBox.value = '';
                     originalPreviewBox.placeholder = "Waiting for input from page...";
                     if (enhanceButton) enhanceButton.disabled = true;
                     updateStatus("Ready. Waiting for input in page...", "info");
                } else {
                    console.error("Panel: Unexpected response format when requesting input:", response);
                    updateStatus("Error: Unexpected response getting input.", "error");
                    originalPreviewBox.value = '';
                    originalPreviewBox.placeholder = "Error loading input.";
                    if (enhanceButton) enhanceButton.disabled = true;
                }
                log("<<<< Callback for getCurrentInputFromContent ENDING (processed response) <<<<");
                // **** END OF CALLBACK ****
            } // End of callback function
        ); // End of sendMessage
        log("getCurrentInputFromContent message sent successfully from panel.");
    } catch (error) {
        console.error("Panel: Synchronous error sending getCurrentInput message:", error);
        updateStatus(`Error sending request: ${error.message}`, 'error');
        if (originalPreviewBox) {
             originalPreviewBox.value = '';
             originalPreviewBox.placeholder = "Error sending request.";
        }
        if (enhanceButton) enhanceButton.disabled = true;
    }
}

// ... (Keep the rest of your panel.js code) ...


// --- Message Listener (from Background Script) ---
function handleBackgroundMessage(message, sender, sendResponse) {
    if (sender.tab || !message || !message.type) {
         // log("Ignoring message not from background or without type:", message, sender); // Reduce noise
         return false;
    }

    log("Message received from background:", message);
    let messageHandled = false;

    switch (message.type) {
        case "updatePreview":
            // log(`Panel: Received updatePreview. Text: ${message.text?.substring(0, 50)}...`); // Reduce noise
            if (currentUser && originalPreviewBox) {
                 originalPreviewBox.value = message.text || 'Input field is empty.';
                 if (enhancedPreviewBox) enhancedPreviewBox.value = '';
                 if (pasteButton) pasteButton.disabled = true;
                 if (enhanceButton) {
                    enhanceButton.disabled = !(originalPreviewBox.value.trim());                 }
                 if (!statusDiv || !statusDiv.className.includes('status-error')) {
                      // updateStatus('Input updated from page.'); // Can be noisy
                 }
            } else if (!currentUser && originalPreviewBox) {
                 originalPreviewBox.value = 'Please log in.';
            }
            messageHandled = true;
            break;

        case "statusUpdate":
            log(`Panel: Received statusUpdate: ${message.text} (${message.statusType})`);
            updateStatus(message.text, message.statusType || 'info');
            messageHandled = true;
            break;

        default:
            log(`Unknown message type from background: ${message.type}`);
            break;
    }

    // Return false as we are not using sendResponse asynchronously here
    // log(`handleBackgroundMessage finished. Message handled: ${messageHandled}. Returning false.`); // Reduce noise
    return false;
}


// --- Setup Event Listeners ---
function setupEventListeners() {
    log("Setting up event listeners...");
    if (!loginButton || !signupButton || !logoutButton || !strengthSlider || !enhanceButton || !pasteButton) {
        log("Cannot setup listeners, elements missing.");
        updateStatus("Error: Failed to setup UI interactions.", 'error');
        return;
    }

    // Remove existing listeners first
    loginButton.removeEventListener('click', handleLoginClick);
    signupButton.removeEventListener('click', handleSignupClick);
    logoutButton.removeEventListener('click', handleLogoutClick);
    strengthSlider.removeEventListener('input', handleSliderInput);
    enhanceButton.removeEventListener('click', handleEnhanceClick);
    pasteButton.removeEventListener('click', handlePasteClick);

    // Add listeners
    loginButton.addEventListener('click', handleLoginClick);
    signupButton.addEventListener('click', handleSignupClick);
    logoutButton.addEventListener('click', handleLogoutClick);
    strengthSlider.addEventListener('input', handleSliderInput);
    enhanceButton.addEventListener('click', handleEnhanceClick);
    pasteButton.addEventListener('click', handlePasteClick);

    handleSliderInput(); // Call once to set initial value

    log("Event listeners set up.");}

// --- Initialize Panel ---
async function initializePanel() {
    log("Initializing panel...");

    // 1. Get DOM Elements FIRST
    if (!getElements()) {
        log("Panel initialization failed: elements could not be found.");
        return; // Stop initialization
    }

    // 2. Setup Listener for Messages from Background Script EARLY
    // Ensure it's only added once
    if (!panelMessageListenerAdded && chrome.runtime && chrome.runtime.onMessage) {
         chrome.runtime.onMessage.addListener(handleBackgroundMessage);
         panelMessageListenerAdded = true;
         log("Background message listener added.");
    } else if (panelMessageListenerAdded) {        log("Background message listener already exists.");
    } else {
        log("Error: chrome.runtime.onMessage not available to add listener.");
        updateStatus("Error: Cannot listen for background messages.", "error");
        return; // Stop if messaging isn't available
    }

    // 3. Initialize Firebase (triggers auth listener setup)
    initializeFirebase(); // Needs to run before auth-dependent steps

    // 4. Get Tab ID
    await getCurrentTabId(); // Wait for this

    // 5. Setup Event Listeners for buttons etc.
    setupEventListeners();

    // 6. Final check and initial state update
    log("Initial panel setup process complete.");
    // UI state should be set by the onAuthStateChanged listener.
    // Force an update based on current state in case listener fired too early.
    if (firebaseInitialized && auth) {
        log("Forcing initial UI update based on current auth state...");
        updateUIForAuthState(auth.currentUser);
    } else if (!firebaseInitialized) {
         log("Firebase not ready during final check, UI shows login.");
         updateUIForAuthState(null); // Ensure login state if firebase failed
    } else {
        log("Firebase ready, but auth object missing? Relying on auth listener.");
        // Auth listener should handle this case
    }
}

// --- Initialization Sequence ---
// Use DOMContentLoaded to ensure HTML is parsed, then initialize
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializePanel);
} else {
    // DOMContentLoaded has already fired
    initializePanel();
}

log("panel.js script loaded.");

