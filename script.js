// --- Configuration ---
// ★★★ Replace with your actual values ★★★
const API_KEY = 'AIzaSyBq2VjJnirR-vzN5w6Y0X3XHqxhhl2qeNw'; // Google Cloud Consoleで取得したAPIキー
const CLIENT_ID = '1032885094154-f7clcs1ssgdttl5j36bm183dfiq9gqi5.apps.googleusercontent.com'; // Google Cloud Consoleで取得したWebアプリケーション用クライアントID
const MANIFEST_FILE_ID = '1kGhBKf1QbQR4mNf_OjCfAKvwJ7jL4fwM'; // Google Drive上のmanifest.jsonのファイルID
// ★★★ End of replacements ★★★

const SCOPES = 'https://www.googleapis.com/auth/drive.readonly'; // Driveファイルの読み取り権限のみ要求
const CHECK_INTERVAL_MS = 60 * 1000; // 60秒ごとに更新をチェック
// ★★★ 画面サイズに応じた表示数調整のための設定 ★★★
const AREA_PER_TOPIC = 15000; // 1トピックあたりのおおよその必要面積 (ピクセル単位、要調整)
const MIN_TOPICS = 5;        // どんなに画面が小さくても最低表示する数 (任意)
const MAX_TOPICS_LIMIT = 10; // どんなに画面が大きくても最大表示する数 (任意)
// ★★★ End of new configuration ★★★

// --- Global Variables ---
let tokenClient;
let currentAccessToken = null;
let updateIntervalId = null;
let currentTopics = []; // 現在表示中のトピックを保持
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
        // GAPIクライアントを初期化
        await gapi.client.init({
            apiKey: API_KEY,
            discoveryDocs: ['https://www.googleapis.com/discovery/v1/apis/drive/v3/rest'],
        });
        console.log("script.js: GAPI client initialized successfully.");

        console.log("script.js: Loading Drive API...");
        // Drive API v3 をロード
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
        // GISトークンクライアントを初期化
        tokenClient = google.accounts.oauth2.initTokenClient({
            client_id: CLIENT_ID,
            scope: SCOPES,
            callback: tokenCallback, // トークン取得時のコールバック
            error_callback: (error) => { // エラー発生時のコールバック
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
 * GAPIとGISの両方の準備ができたらアプリのメイン処理（サインインボタン表示）を開始する
 */
function checkLibrariesAndStart() {
    console.log(`script.js: checkLibrariesAndStart() called. GAPI Ready=${isGapiClientReady}, GIS Ready=${isGisClientReady}`);
    // 両方のフラグが true になったら実行
    if (isGapiClientReady && isGisClientReady) {
        console.log("script.js: Both libraries ready. Enabling sign-in.");
        updateStatus('Ready. Please sign in.');
        // --- サインインボタン表示 ---
        signInContainer.innerHTML = ''; // 以前の内容をクリア
        const button = document.createElement('button');
        button.textContent = 'Sign in with Google';
        button.onclick = handleAuthClick; // クリック時のハンドラを設定
        signInContainer.appendChild(button); // ボタンをDOMに追加
        // --- ここでアプリの他の初期化処理が必要なら追加 ---
    }
}

// --- Authentication Callbacks and Handlers ---

/**
 * GISトークンクライアントのコールバック。アクセストークン取得時またはエラー時に呼ばれる。
 * @param {object} tokenResponse Contains the access token or an error.
 */
function tokenCallback(tokenResponse) {
    console.log("script.js: tokenCallback() called.");
    if (tokenResponse && tokenResponse.access_token) {
        console.log("script.js: Access token received.");
        currentAccessToken = tokenResponse.access_token; // トークンをグローバル変数に保存

        // GAPIクライアントにトークンを設定
        if (gapi && gapi.client) {
             gapi.client.setToken({ access_token: currentAccessToken });
             console.log("script.js: GAPI token set.");
        } else {
             // 通常ここには来ないはずだが念のため
             console.error("script.js: gapi.client not ready when setting token!");
             updateStatus('Error: Google API Client not ready.', true);
             return;
        }

        updateStatus('Sign-in successful. Fetching topics...');

        // サインインボタンを削除し、サインアウトボタンを表示
        signInContainer.innerHTML = '';
        
        //const button = document.createElement('button');
        //button.textContent = 'Sign Out';
        //button.onclick = handleSignoutClick;
        //signInContainer.appendChild(button);

        // 最初のデータ取得を実行
        fetchManifestAndTopics();

        // 定期更新のためのインターバルタイマーを開始
        console.log("script.js: Setting up interval timer...");
        if (updateIntervalId) {
            clearInterval(updateIntervalId); // 既存のタイマーがあればクリア
            console.log("script.js: Cleared previous interval timer.");
        }
        updateIntervalId = setInterval(fetchManifestAndTopics, CHECK_INTERVAL_MS);
        console.log("script.js: Interval timer started with ID:", updateIntervalId);

    } else {
        // アクセストークンが取得できなかった場合のエラー処理
        const errorMsg = tokenResponse?.error ? `${tokenResponse.error}: ${tokenResponse.error_description || tokenResponse.error_uri || 'No details'}` : 'Access token not received.';
        console.error("script.js: Token Callback Error:", tokenResponse);
        updateStatus(`Authentication failed: ${errorMsg}`, true);
        checkLibrariesAndStart(); // Show sign-in button again if needed
    }
}

/**
 * サインインボタンクリック時の処理。GISの認証フローを開始する。
 */
function handleAuthClick() {
    console.log("script.js: handleAuthClick() called.");
    if (!tokenClient) {
         console.error("script.js: Token client not initialized.");
         updateStatus("Sign-in is not ready yet.", true);
         return;
    }
    updateStatus('Requesting Google Sign-In...');
    signInContainer.innerHTML = '<span>Requesting Sign-In...</span>'; // ユーザーへのフィードバック

    // 既存のトークン情報をクリア
    currentAccessToken = null;
     if (gapi && gapi.client) { gapi.client.setToken(null); }

    console.log("script.js: handleAuthClick: BEFORE requestAccessToken call");
    try {
        // GISのトークン取得フローを開始 (通常ポップアップが開く)
        tokenClient.requestAccessToken({ prompt: 'consent' });
    } catch (err) {
         // requestAccessToken自体が同期エラーを投げることは稀だが念のため
         console.error("script.js: Error calling requestAccessToken:", err);
         updateStatus(`Sign-in initiation error: ${err.message}`, true);
         checkLibrariesAndStart(); // Show sign-in button again
    }
    console.log("script.js: handleAuthClick: AFTER requestAccessToken call (Popup initiation requested)");
}

/**
 * サインアウトボタンクリック時の処理。
 */
function handleSignoutClick() {
    console.log("script.js: handleSignoutClick() called.");
    // インターバルタイマーを停止
    if (updateIntervalId) {
        clearInterval(updateIntervalId);
        updateIntervalId = null;
        console.log("script.js: Interval timer cleared.");
    }

    const token = currentAccessToken;
    currentAccessToken = null; // グローバルトークンをクリア

    // GAPIクライアントのトークンもクリア
     if (gapi && gapi.client) {
         gapi.client.setToken(null);
     }

    // Google側でトークンを無効化 (任意だが推奨)
    if (token) {
        google.accounts.oauth2.revoke(token, () => {
            console.log('script.js: Access token revoked.');
        });
    }

    // 自動サインイン選択状態を無効化 (次回アクセス時に自動選択されなくなる)
    google.accounts.id.disableAutoSelect();

    // 表示内容と状態をクリア
    currentTopics = [];
    topicsContainer.innerHTML = '';
    signInContainer.innerHTML = ''; // サインアウトボタンをクリア
    updateStatus('Signed out.');
    checkLibrariesAndStart(); // 再度サインインボタンを表示
}


// --- Data Fetching & Display Functions ---

/**
 * ManifestファイルとTopicsファイルをGoogle Driveから取得し、表示を更新する。
 * 初回読み込み時とインターバルタイマーによって定期的に呼び出される。
 */
async function fetchManifestAndTopics() {
    // インターバル実行開始ログ
    console.log(`script.js: fetchManifestAndTopics: Called at ${new Date().toISOString()}`);

    // アクセストークンがなければ処理中断
    if (!currentAccessToken) {
        updateStatus('Not signed in. Cannot fetch data.', true);
        console.warn("script.js: fetchManifestAndTopics aborted, user not signed in.");
        // インターバルを止める（サインアウト処理が呼ばれていれば不要だが念のため）
        if (updateIntervalId) {
             clearInterval(updateIntervalId);
             updateIntervalId = null;
             console.log("script.js: Interval timer cleared because user is not signed in.");
        }
        return;
    }
    updateStatus('Checking for updated topics...');

    let manifestContent;
    try {
        console.log("script.js: Fetching manifest file:", MANIFEST_FILE_ID);
        manifestContent = await fetchDriveFileContent(MANIFEST_FILE_ID);
        console.log("script.js: Manifest file fetched successfully.");
    } catch (err) {
        // fetchDriveFileContent内でエラーログとステータス更新済みのはず
        // 必要であればここで追加のエラー処理
        return; // エラー時は処理中断
    }

    let manifestData;
    try {
        manifestData = JSON.parse(manifestContent);
    } catch (err) {
        updateStatus(`Error parsing manifest.json: ${err.message}`, true);
        console.error("script.js: Error parsing manifest:", err, "Content:", manifestContent);
        return; // エラー時は処理中断
    }

    // Manifestから最新トピックファイルの情報を取得
    const latestTopicsInfo = manifestData?.latest_topics_file;
    const topicsFileId = latestTopicsInfo?.id;

    if (!topicsFileId) {
        updateStatus('Could not find topics file ID in manifest.', true);
        console.error("script.js: Manifest structure issue or missing topics file ID:", manifestData);
        return; // エラー時は処理中断
    }

    updateStatus(`Found latest topics file ID: ${topicsFileId}. Fetching content...`);
    console.log(`script.js: Found latest topics file ID: ${topicsFileId}. Fetching content...`);

    let topicsFileContent;
    try {
        console.log("script.js: Fetching topics file:", topicsFileId);
        topicsFileContent = await fetchDriveFileContent(topicsFileId);
        console.log("script.js: Topics file fetched successfully.");
    } catch (err) {
        // fetchDriveFileContent内でエラーログとステータス更新済みのはず
        return; // エラー時は処理中断
    }

    let topicsData;
    try {
        topicsData = JSON.parse(topicsFileContent);
        const newTopics = topicsData?.topics || [];

        // 前回表示したトピックと比較（単純なJSON文字列比較）
        if (JSON.stringify(newTopics) !== JSON.stringify(currentTopics)) {
            console.log("script.js: Topics have changed, updating display.");
            currentTopics = newTopics; // 新しいトピックリストを保存
            updateStatus(`Topics updated (${currentTopics.length} items). Displaying...`);
            displayTopics(currentTopics); // 表示を更新
        } else {
            console.log("script.js: Topics checked, no changes detected.");
            updateStatus(`Topics checked, no changes detected (${currentTopics.length} items).`);
        }

    } catch (err) {
        updateStatus(`Error parsing topics file: ${err.message}`, true);
        console.error("script.js: Error parsing topics file:", err, "Content:", topicsFileContent);
        // エラー時は処理中断
    }
}

/**
 * Google Driveから指定されたファイルIDのファイル内容を取得する。
 * @param {string} fileId The ID of the file to fetch.
 * @returns {Promise<string>} A promise that resolves with the file content as a string.
 */
async function fetchDriveFileContent(fileId) {
    console.log(`script.js: Attempting to fetch file content for ID: ${fileId}`);
    if (!fileId) {
        console.error("script.js: fetchDriveFileContent called with no file ID.");
        throw new Error("File ID is required.");
    }
    if (!gapi || !gapi.client || !gapi.client.drive) {
         console.error("script.js: GAPI client or Drive API not ready for fetch.");
         throw new Error("GAPI Drive client not ready.");
    }

    try {
        // Drive API を呼び出してファイル内容を取得
        const response = await gapi.client.drive.files.get({
            fileId: fileId,
            alt: 'media' // ファイル内容を取得するためのパラメータ
        });
        console.log(`script.js: Successfully fetched content for file ID: ${fileId}`);
        // response.body にファイル内容が文字列として格納されている
        return response.body;
    } catch (err) {
        // API呼び出しでエラーが発生した場合
        console.error(`script.js: Drive API error fetching file ${fileId}:`, err);
        // 認証エラー (401/403) かどうかチェック
        if (err.status === 401 || err.status === 403) {
             const errorMsg = `Authorization error (${err.status}) fetching file ${fileId}. Token might be expired. Please sign in again.`;
             console.error(errorMsg);
             updateStatus(errorMsg, true);
             // トークン切れの可能性が高いので、サインアウト処理を呼んでインターバルを止める
             handleSignoutClick();
        } else {
            // その他のAPIエラー
            const errorMsg = `Failed to fetch file ${fileId}: ${err.result?.error?.message || err.message || 'Unknown Drive API error'}`;
            console.error(errorMsg);
            updateStatus(errorMsg, true);
        }
        // エラーを再スローして、呼び出し元 (fetchManifestAndTopics) にエラーを伝える
        throw err;
    }
}

/**
 * 取得したトピックを画面に表示する（要素を生成しアニメーション設定）。
 * 画面サイズに応じて表示数を調整する。
 * @param {string[]} topicsArray An array of topic strings.
 */
function displayTopics(topicsArray) {
    console.log(`script.js: displayTopics called with ${topicsArray.length} potential topics.`);
    topicsContainer.innerHTML = ''; // 既存のトピック要素をクリア

    if (!Array.isArray(topicsArray)) {
        console.error("script.js: Invalid topics data provided to displayTopics:", topicsArray);
        updateStatus("Error: Invalid topics data received.", true); // ステータス更新追加
        return;
    }
    if (topicsArray.length === 0) {
        console.log("script.js: No topics to display.");
        updateStatus("No topics found in the source file."); // ステータス更新追加
        return; // トピックがなければ何もしない
    }

    // --- 画面サイズに基づいて表示数を計算 ---
    const containerWidth = topicsContainer.offsetWidth;
    const containerHeight = topicsContainer.offsetHeight;
    const screenArea = containerWidth * containerHeight;

    // 面積から表示数を計算（最低数と最大数で制限）
    let calculatedMaxTopics = Math.floor(screenArea / AREA_PER_TOPIC);
    calculatedMaxTopics = Math.max(MIN_TOPICS, calculatedMaxTopics); // 最低数を保証
    calculatedMaxTopics = Math.min(MAX_TOPICS_LIMIT, calculatedMaxTopics); // 最大数で制限
    calculatedMaxTopics = Math.min(calculatedMaxTopics, topicsArray.length); // 利用可能なトピック数を超えないように

    console.log(`script.js: Screen area ${screenArea}px^2. Calculated max topics: ${calculatedMaxTopics}`);

    // --- 表示するトピックを選択 ---
    // 元の配列をシャッフルしてからスライスすると、毎回違うトピックが表示されやすくなる（任意）
    // const shuffledTopics = [...topicsArray].sort(() => 0.5 - Math.random());
    // const topicsToDisplay = shuffledTopics.slice(0, calculatedMaxTopics);
    // または、単純に先頭から取得
    const topicsToDisplay = topicsArray.slice(0, calculatedMaxTopics);

    console.log(`script.js: Displaying ${topicsToDisplay.length} topics.`);
    updateStatus(`Displaying ${topicsToDisplay.length} topics.`); // ステータス更新修正

    // --- トピック要素を生成して表示 ---
    topicsToDisplay.forEach((topicText, index) => {
        const topicElement = document.createElement('div');
        topicElement.classList.add('topic-item');
        topicElement.textContent = topicText;

        const { top, left } = getRandomPosition(topicsContainer);
        const duration = getRandomDuration(10, 25);
        const delay = getRandomDelay(5);

        topicElement.style.top = `${top}%`;
        topicElement.style.left = `${left}%`;
        topicElement.style.animationDuration = `${duration}s`;
        topicElement.style.animationDelay = `${delay}s`;
        topicElement.style.opacity = '0';
        topicElement.style.animationName = 'float, fadeIn';
        topicElement.style.animationTimingFunction = 'ease-in-out, ease-out';
        topicElement.style.animationIterationCount = 'infinite, 1';
        topicElement.style.animationDirection = 'alternate, normal';
        topicElement.style.animationFillMode = 'none, forwards';

        topicsContainer.appendChild(topicElement);
    });
     // console.log(`script.js: Finished creating ${topicsToDisplay.length} topic elements.`); // ログは上で表示済み
}

// --- Helper Functions ---

/**
 * 画面上のステータスメッセージを更新する。
 * @param {string} message The message to display.
 * @param {boolean} isError If true, display as an error.
 */
function updateStatus(message, isError = false) {
    console.log(`Status Update: ${message} ${isError ? '(Error)' : ''}`);
    if (statusDiv) {
        statusDiv.textContent = message;
        statusDiv.style.color = isError ? 'red' : 'rgba(255, 255, 255, 0.6)';
        statusDiv.style.fontWeight = isError ? 'bold' : 'normal';
    }
}

/**
 * コンテナ内でランダムな位置（top, leftの%）を生成する。
 * @param {HTMLElement} container - The container element.
 * @param {number} padding - Percentage padding from edges.
 * @returns {{top: number, left: number}} - Random position percentages.
 */
function getRandomPosition(container, padding = 10) {
    // Ensure padding doesn't exceed 50%
    const effectivePadding = Math.min(padding, 49);
    const top = effectivePadding + Math.random() * (100 - 2 * effectivePadding);
    const left = effectivePadding + Math.random() * (100 - 2 * effectivePadding);
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

// --- Script Execution Start ---

console.log("script.js: Execution started.");
updateStatus('Loading Google libraries...');

/**
 * Google API Client (gapi) の準備を開始する関数
 * gapiオブジェクトの存在を確認してから gapi.load を呼び出す
 */
function startGapiLoad() {
    if (typeof gapi !== 'undefined' && gapi.load) {
        console.log("script.js: gapi object found, calling gapi.load('client', ...)");
        // 'client'コンポーネントの読み込み完了後にinitializeGapiClientを実行
        gapi.load('client', initializeGapiClient);
    } else {
        // gapi または gapi.load がまだ利用できない場合は少し待ってリトライ
        console.log("script.js: gapi or gapi.load not found yet, retrying in 100ms...");
        setTimeout(startGapiLoad, 100);
    }
}

/**
 * Google Identity Services (GIS) の準備を開始する関数
 * google.accounts オブジェクトの存在を確認してから初期化処理を呼び出す
 */
function startGisLoad() {
    if (typeof google !== 'undefined' && typeof google.accounts !== 'undefined' && typeof google.accounts.oauth2 !== 'undefined') {
        console.log("script.js: google.accounts.oauth2 object found, calling initializeGisClient()");
        initializeGisClient();
    } else {
        // google.accounts.oauth2 がまだ利用できない場合は少し待ってリトライ
        console.log("script.js: google.accounts.oauth2 object not found yet, retrying in 100ms...");
        setTimeout(startGisLoad, 100);
    }
}
// --- Resize Event Listener ---
/**
 * ウィンドウリサイズ時にトピック表示を更新する関数
 */
function handleResize() {
    // 頻繁な再描画を防ぐためにタイマーを使用 (debounce)
    clearTimeout(resizeTimeout);
    resizeTimeout = setTimeout(() => {
        console.log("script.js: Window resized, redisplaying topics.");
        // currentTopics に保存されている最新のトピックリストを使って再描画
        if (currentTopics && currentTopics.length > 0) {
            displayTopics(currentTopics);
        } else {
            // トピックがまだ読み込まれていない場合は何もしないか、
            // 必要ならステータス更新などを行う
            console.log("script.js: Window resized, but no topics loaded yet.");
        }
    }, 250); // 250ミリ秒待ってから実行
}

// リサイズイベントリスナーを登録
window.addEventListener('resize', handleResize);

console.log("script.js: Resize listener added.");
// GAPIとGISのロードと初期化を開始するためのチェックを開始
startGapiLoad();
startGisLoad();

console.log("script.js: Initial load checks scheduled.");

// CSSにフェードインアニメーションを追加する例（style.cssに追加）
/*
@keyframes fadeIn {
  from { opacity: 0; }
  to   { opacity: 1; }
}
*/
