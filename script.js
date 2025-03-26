// --- Configuration ---
// ★★★ Replace with your actual values ★★★
const API_KEY = 'AIzaSyBq2VjJnirR-vzN5w6Y0X3XHqxhhl2qeNw'; // Google Cloud Consoleで取得したAPIキー
const CLIENT_ID = '1032885094154-f7clcs1ssgdttl5j36bm183dfiq9gqi5.apps.googleusercontent.com'; // Google Cloud Consoleで取得したWebアプリケーション用クライアントID
const MANIFEST_FILE_ID = '1djWkY2cKlIWf6if1qyP5RVMTRED67zP1'; // Google Drive上のmanifest.jsonのファイルID
// ★★★ End of replacements ★★★

const SCOPES = 'https://www.googleapis.com/auth/drive.readonly'; // Driveファイルの読み取り権限のみ要求
const CHECK_INTERVAL_MS = 60 * 1000; // 60秒ごとに更新をチェック

// --- Global Variables ---
let tokenClient;
let currentAccessToken = null;
let updateIntervalId = null;
let currentTopics = [];
// フラグで両ライブラリの準備完了を管理
let isGapiClientReady = false;
let isGisClientReady = false;

// --- DOM Elements ---
const topicsContainer = document.getElementById('topics-container');
const statusDiv = document.getElementById('status');
const signInContainer = document.getElementById('sign-in-container');

// --- Core Initialization ---

/**
 * GAPIクライアントの初期化処理（gapi.loadのコールバックから呼ばれる）
 */
async function initializeGapiClient() {
    console.log("script.js: initializeGapiClient() called");
    try {
        console.log("script.js: Initializing GAPI client with API key...");
        await gapi.client.init({
            apiKey: API_KEY,
            discoveryDocs: ['https://www.googleapis.com/discovery/v1/apis/drive/v3/rest'],
        });
        console.log("script.js: GAPI client initialized successfully.");

        console.log("script.js: Loading Drive API...");
        await gapi.client.load('drive', 'v3');
        console.log("script.js: Drive API loaded successfully.");

        isGapiClientReady = true; // GAPI準備完了フラグを立てる
        checkLibrariesAndStart(); // 両方準備できたかチェック

    } catch (err) {
        console.error("script.js: Error in initializeGapiClient:", err);
        updateStatus(`Error initializing Google API Client: ${err.message}`, true);
    }
}

/**
 * GISトークンクライアントの初期化処理
 */
function initializeGisClient() {
    console.log("script.js: initializeGisClient() called");
    try {
        console.log("script.js: Initializing GIS token client...");
        tokenClient = google.accounts.oauth2.initTokenClient({
            client_id: CLIENT_ID,
            scope: SCOPES,
            callback: tokenCallback, // トークン取得時のコールバック
            error_callback: (error) => {
                console.error("script.js: GIS Error Callback:", error);
                updateStatus(`Sign-in error: ${error.message || 'Unknown GIS error'}`, true);
            }
        });
        isGisClientReady = true; // GIS準備完了フラグを立てる
        console.log("script.js: GIS token client initialized successfully.");
        checkLibrariesAndStart(); // 両方準備できたかチェック

    } catch (err) {
        console.error("script.js: Error initializing GIS client:", err);
        updateStatus(`Error initializing Google Sign-In: ${err.message}`, true);
    }
}

/**
 * GAPIとGISの両方の準備ができたらアプリのメイン処理を開始する
 */
function checkLibrariesAndStart() {
    console.log(`script.js: checkLibrariesAndStart() called. GAPI Ready=${isGapiClientReady}, GIS Ready=${isGisClientReady}`);
    if (isGapiClientReady && isGisClientReady) {
        console.log("script.js: Both libraries ready. Enabling sign-in.");
        updateStatus('Ready. Please sign in.');
        // --- サインインボタン表示 ---
        signInContainer.innerHTML = '';
        const button = document.createElement('button');
        button.textContent = 'Sign in with Google';
        button.onclick = handleAuthClick;
        signInContainer.appendChild(button);
        // --- ここでアプリの他の初期化処理が必要なら追加 ---
    }
}

// --- Authentication Callbacks and Handlers (変更なし) ---

function tokenCallback(tokenResponse) {
    // ... (前回のコードと同じ) ...
    if (tokenResponse && tokenResponse.access_token) {
        currentAccessToken = tokenResponse.access_token;
        // ★ gapi.client が利用可能か一応確認
        if (gapi && gapi.client) {
             gapi.client.setToken({ access_token: currentAccessToken });
        } else {
             console.error("gapi.client not ready when setting token!");
             updateStatus('Error: Google API Client not ready.', true);
             return;
        }
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
        // ... (エラー処理、前回のコードと同じ) ...
        const errorMsg = tokenResponse?.error ? `${tokenResponse.error}: ${tokenResponse.error_description || tokenResponse.error_uri || 'No details'}` : 'Access token not received.';
        console.error("Token Callback Error:", tokenResponse);
        updateStatus(`Authentication failed: ${errorMsg}`, true);
        checkLibrariesAndStart(); // Show sign-in button again if needed
    }
}

function handleAuthClick() {
    if (!tokenClient) {
         console.error("Token client not initialized.");
         updateStatus("Sign-in is not ready yet.", true);
         return;
    }
    updateStatus('Requesting Google Sign-In...');
    signInContainer.innerHTML = '<span>Requesting Sign-In...</span>';
    // ...(前回のコードと同じ)...
    tokenClient.requestAccessToken({ prompt: 'consent' });
}

function handleSignoutClick() {
    // ...(前回のコードと同じ)...
     if (updateIntervalId) clearInterval(updateIntervalId);
    updateIntervalId = null;
    // ...(トークンrevokeなど)...
     currentAccessToken = null;
     if (gapi && gapi.client) {
         gapi.client.setToken(null);
     }
    // ...(状態クリアなど)...
    currentTopics = [];
    topicsContainer.innerHTML = '';
    signInContainer.innerHTML = '';
    updateStatus('Signed out.');
    checkLibrariesAndStart(); // Show sign-in button again
}

// --- Data Fetching & Display Functions (変更なし) ---
async function fetchManifestAndTopics() { /* ... 前回のコードと同じ ... */ }
async function fetchDriveFileContent(fileId) { /* ... 前回のコードと同じ ... */ }
function displayTopics(topicsArray) { /* ... 前回のコードと同じ ... */ }

// --- Helper Functions (変更なし) ---
function updateStatus(message, isError = false) { /* ... 前回のコードと同じ ... */ }
function getRandomPosition(container, padding = 10) { /* ... 前回のコードと同じ ... */ }
function getRandomDuration(min, max) { /* ... 前回のコードと同じ ... */ }
function getRandomDelay(max) { /* ... 前回のコードと同じ ... */ }


// --- Script Execution Start ---

console.log("script.js: Execution started.");
updateStatus('Loading Google libraries...');

/**
 * Google API Client (gapi) の準備を開始する関数
 */
function startGapiLoad() {
    // gapiオブジェクトが存在するか確認してからgapi.loadを呼ぶ
    if (typeof gapi !== 'undefined') {
        console.log("script.js: gapi object found, calling gapi.load('client', ...)");
        // 'client'コンポーネントの読み込み完了後にinitializeGapiClientを実行
        gapi.load('client', initializeGapiClient);
    } else {
        // gapiが見つからない場合は少し待ってリトライ
        console.log("script.js: gapi object not found yet, retrying in 100ms...");
        setTimeout(startGapiLoad, 100);
    }
}

/**
 * Google Identity Services (GIS) の準備を開始する関数
 */
function startGisLoad() {
    // google.accounts オブジェクトが存在するか確認
    if (typeof google !== 'undefined' && typeof google.accounts !== 'undefined') {
        console.log("script.js: google.accounts object found, calling initializeGisClient()");
        initializeGisClient();
    } else {
        // google.accounts が見つからない場合は少し待ってリトライ
        console.log("script.js: google.accounts object not found yet, retrying in 100ms...");
        setTimeout(startGisLoad, 100);
    }
}

// GAPIとGISのロードと初期化を開始
startGapiLoad();
startGisLoad();

console.log("script.js: Initial load checks scheduled.");
