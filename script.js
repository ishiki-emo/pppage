// --- Configuration ---
// ★★★ Replace with your actual values ★★★
const API_KEY = 'AIzaSyBq2VjJnirR-vzN5w6Y0X3XHqxhhl2qeNw'; // Google Cloud Consoleで取得したAPIキー
const CLIENT_ID = '1032885094154-crvf5r36l2h3b4jvgdbdt5vovp3ftjrs.apps.googleusercontent.com'; // Google Cloud Consoleで取得したWebアプリケーション用クライアントID
const MANIFEST_FILE_ID = '1djWkY2cKlIWf6if1qyP5RVMTRED67zP1'; // Google Drive上のmanifest.jsonのファイルID
// ★★★ End of replacements ★★★

const SCOPES = 'https://www.googleapis.com/auth/drive.readonly'; // Driveファイルの読み取り権限のみ要求
const CHECK_INTERVAL_MS = 60 * 1000; // 60秒ごとに更新をチェック

// --- Global Variables ---
let tokenClient;
let gapiInited = false;
let gisInited = false;
let currentAccessToken = null;
let updateIntervalId = null;
let currentTopics = []; // 現在表示中のトピックを保持

// --- DOM Elements ---
const topicsContainer = document.getElementById('topics-container');
const statusDiv = document.getElementById('status');
const signInContainer = document.getElementById('sign-in-container');

// --- Initialization ---

/**
 * Called after the Google API client library loads.
 * Initializes the API client.
 */
function gapiLoaded() {
    gapi.load('client', initializeGapiClient);
}

/**
 * Initializes the Google API client with API key.
 * Loads the Drive API.
 */
async function initializeGapiClient() {
    try {
        await gapi.client.init({
            apiKey: API_KEY,
            discoveryDocs: ['https://www.googleapis.com/discovery/v1/apis/drive/v3/rest'],
        });
        gapiInited = true;
        updateStatus('Google API Client initialized.');
        maybeEnableButtons();
        // Drive APIをロード（discoveryDocsで指定したので不要な場合もあるが念のため）
        await gapi.client.load('drive', 'v3');
        updateStatus('Google Drive API loaded.');
    } catch (err) {
        console.error("Error initializing GAPI client:", err);
        updateStatus(`Error initializing Google API Client: ${err.message}`, true);
    }
}

/**
 * Called after the Google Identity Services library loads.
 * Initializes the token client for OAuth 2.0.
 */
function gisLoaded() {
    try {
        tokenClient = google.accounts.oauth2.initTokenClient({
            client_id: CLIENT_ID,
            scope: SCOPES,
            callback: tokenCallback, // Called when user grants or denies access
            error_callback: (error) => {
                console.error("GIS Error Callback:", error);
                updateStatus(`Sign-in error: ${error.message || 'Unknown GIS error'}`, true);
            }
        });
        gisInited = true;
        updateStatus('Google Sign-In initialized.');
        maybeEnableButtons();
    } catch (err) {
        console.error("Error initializing GIS client:", err);
        updateStatus(`Error initializing Google Sign-In: ${err.message}`, true);
    }
}

/**
 * Checks if both GAPI and GIS are initialized, then enables sign-in.
 */
function maybeEnableButtons() {
    if (gapiInited && gisInited) {
        updateStatus('Ready. Please sign in.');
        // Create a Sign-In button or prompt
        signInContainer.innerHTML = ''; // Clear previous content
        const button = document.createElement('button');
        button.textContent = 'Sign in with Google';
        button.onclick = handleAuthClick;
        signInContainer.appendChild(button);
    }
}

// --- Authentication ---

/**
 * Callback function executed when the user responds to the OAuth flow.
 * @param {object} tokenResponse Contains the access token or an error.
 */
function tokenCallback(tokenResponse) {
    if (tokenResponse && tokenResponse.access_token) {
        currentAccessToken = tokenResponse.access_token;
        gapi.client.setToken({ access_token: currentAccessToken });
        updateStatus('Sign-in successful. Fetching topics...');
        signInContainer.innerHTML = ''; // Clear sign-in button
        const button = document.createElement('button');
        button.textContent = 'Sign Out';
        button.onclick = handleSignoutClick;
        signInContainer.appendChild(button);

        // Fetch initial data and start timer
        fetchManifestAndTopics();
        if (updateIntervalId) clearInterval(updateIntervalId); // Clear existing timer if any
        updateIntervalId = setInterval(fetchManifestAndTopics, CHECK_INTERVAL_MS);

    } else {
        const errorMsg = tokenResponse?.error ? `${tokenResponse.error}: ${tokenResponse.error_description || tokenResponse.error_uri || 'No details'}` : 'Access token not received.';
        console.error("Token Callback Error:", tokenResponse);
        updateStatus(`Authentication failed: ${errorMsg}`, true);
        // Show sign-in button again if needed
        maybeEnableButtons();
    }
}

/**
 * Initiates the OAuth 2.0 flow.
 */
function handleAuthClick() {
    updateStatus('Requesting Google Sign-In...');
    signInContainer.innerHTML = '<span>Requesting Sign-In...</span>'; // Provide feedback
    if (currentAccessToken) {
        // If already have a token (might be expired), clear it first
        // google.accounts.oauth2.revoke(currentAccessToken, () => {}); // Optionally revoke
        currentAccessToken = null;
        gapi.client.setToken(null);
    }
    // Prompt the user to select an account and grant access.
    tokenClient.requestAccessToken({ prompt: 'consent' }); // Use 'consent' to always ask for permission initially
}

/**
 * Signs the user out.
 */
function handleSignoutClick() {
    if (updateIntervalId) clearInterval(updateIntervalId);
    updateIntervalId = null;

    if (currentAccessToken) {
        google.accounts.oauth2.revoke(currentAccessToken, () => {
            console.log('Token revoked.');
        });
        currentAccessToken = null;
        gapi.client.setToken(null);
    }
    // Optionally clear auto-select state
    google.accounts.id.disableAutoSelect();

    currentTopics = []; // Clear displayed topics
    topicsContainer.innerHTML = ''; // Clear display
    signInContainer.innerHTML = ''; // Clear signout button
    updateStatus('Signed out.');
    maybeEnableButtons(); // Show sign-in button again
}


// --- Data Fetching & Display ---

/**
 * Fetches the manifest file, then the topics file from Google Drive.
 */
async function fetchManifestAndTopics() {
    if (!currentAccessToken) {
        updateStatus('Not signed in.', true);
        // Optionally trigger sign-in again or just wait
        // handleAuthClick();
        return;
    }
    updateStatus('Checking for updated topics...');

    let manifestContent;
    try {
        manifestContent = await fetchDriveFileContent(MANIFEST_FILE_ID);
    } catch (err) {
        updateStatus(`Error fetching manifest: ${err.message}`, true);
        console.error("Error fetching manifest:", err);
        // Decide how to handle error - maybe retry later?
        return;
    }

    let manifestData;
    try {
        manifestData = JSON.parse(manifestContent);
    } catch (err) {
        updateStatus(`Error parsing manifest.json: ${err.message}`, true);
        console.error("Error parsing manifest:", err);
        return;
    }

    const latestTopicsInfo = manifestData?.latest_topics_file;
    const topicsFileId = latestTopicsInfo?.id;

    if (!topicsFileId) {
        updateStatus('Could not find topics file ID in manifest.', true);
        console.error("Manifest structure issue:", manifestData);
        return;
    }

    updateStatus(`Found latest topics file ID: ${topicsFileId}. Fetching content...`);

    let topicsFileContent;
    try {
        topicsFileContent = await fetchDriveFileContent(topicsFileId);
    } catch (err) {
        updateStatus(`Error fetching topics file (${topicsFileId}): ${err.message}`, true);
        console.error(`Error fetching topics file ${topicsFileId}:`, err);
        return;
    }

    let topicsData;
    try {
        topicsData = JSON.parse(topicsFileContent);
        const newTopics = topicsData?.topics || [];
        // Simple check if topics actually changed (by converting to string)
        if (JSON.stringify(newTopics) !== JSON.stringify(currentTopics)) {
            currentTopics = newTopics;
            updateStatus(`Topics updated (${currentTopics.length} items). Displaying...`);
            displayTopics(currentTopics);
        } else {
            updateStatus(`Topics checked, no changes detected (${currentTopics.length} items).`);
        }

    } catch (err) {
        updateStatus(`Error parsing topics file: ${err.message}`, true);
        console.error("Error parsing topics file:", err);
    }
}

/**
 * Fetches the content of a file from Google Drive using its ID.
 * @param {string} fileId The ID of the file to fetch.
 * @returns {Promise<string>} A promise that resolves with the file content as a string.
 */
async function fetchDriveFileContent(fileId) {
    if (!fileId) {
        throw new Error("File ID is required.");
    }
    try {
        const response = await gapi.client.drive.files.get({
            fileId: fileId,
            alt: 'media' // Important: gets the file content
        });
        // response.body contains the file content as a string
        return response.body;
    } catch (err) {
        console.error(`Drive API error fetching file ${fileId}:`, err);
        // Check for specific auth errors (e.g., 401, 403)
        if (err.status === 401 || err.status === 403) {
             updateStatus('Authorization error. Please try signing in again.', true);
             handleSignoutClick(); // Force sign out on auth error
             throw new Error(`Authorization error (${err.status})`);
        }
        throw new Error(`Failed to fetch file ${fileId}: ${err.result?.error?.message || err.message || 'Unknown Drive API error'}`);
    }
}

/**
 * Clears existing topics and displays the new ones with animation.
 * @param {string[]} topicsArray An array of topic strings.
 */
function displayTopics(topicsArray) {
    topicsContainer.innerHTML = ''; // Clear previous topics

    if (!Array.isArray(topicsArray)) {
        console.error("Invalid topics data provided:", topicsArray);
        return;
    }

    topicsArray.forEach(topicText => {
        const topicElement = document.createElement('div');
        topicElement.classList.add('topic-item');
        topicElement.textContent = topicText;

        // Apply random position and animation timings
        const { top, left } = getRandomPosition(topicsContainer);
        const duration = getRandomDuration(10, 20); // seconds
        const delay = getRandomDelay(5); // seconds

        topicElement.style.top = `${top}%`;
        topicElement.style.left = `${left}%`;
        topicElement.style.animationDuration = `${duration}s`;
        topicElement.style.animationDelay = `${delay}s`;

        topicsContainer.appendChild(topicElement);
    });
     updateStatus(`Displaying ${topicsArray.length} topics.`);
}

// --- Helper Functions ---

/**
 * Updates the status message display.
 * @param {string} message The message to display.
 * @param {boolean} isError If true, display as an error.
 */
function updateStatus(message, isError = false) {
    console.log(`Status: ${message}`); // Log to console as well
    if (statusDiv) {
        statusDiv.textContent = message;
        statusDiv.style.color = isError ? 'red' : 'rgba(255, 255, 255, 0.6)';
        statusDiv.style.fontWeight = isError ? 'bold' : 'normal';
    }
}

/**
 * Generates random top/left percentages within the container.
 * Adjust padding to keep elements away from edges.
 */
function getRandomPosition(container, padding = 10) {
    const top = padding + Math.random() * (100 - 2 * padding);
    const left = padding + Math.random() * (100 - 2 * padding);
    return { top, left };
}

/** Generates random animation duration in seconds. */
function getRandomDuration(min, max) {
    return min + Math.random() * (max - min);
}

/** Generates random animation delay in seconds. */
function getRandomDelay(max) {
    return Math.random() * max;
}

// --- Global Execution ---
// Assign the library load callbacks to the window object
// so they can be called by the script loaders.
window.gapiLoaded = gapiLoaded;
window.gisLoaded = gisLoaded;

// Initial status
updateStatus('Loading Google libraries...');
