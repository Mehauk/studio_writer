let dirHandle = null;
const DB_NAME = "AISyncDB";
const STORE_NAME = "handles";
const KEY_NAME = "projectDir";

// --- IndexedDB: Store & Restore Folder Handle ---
function getDB() {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, 1);
        req.onupgradeneeded = () => req.result.createObjectStore(STORE_NAME);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

async function saveHandle(handle) {
    const db = await getDB();
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).put(handle, KEY_NAME);
    return tx.complete;
}

async function loadHandle() {
    const db = await getDB();
    const tx = db.transaction(STORE_NAME, "readonly");
    return new Promise((resolve) => {
        const req = tx.objectStore(STORE_NAME).get(KEY_NAME);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => resolve(null);
    });
}

// --- File System Operations ---
async function verifyPermission(fileHandle, readWrite = true) {
    const options = { mode: readWrite ? "readwrite" : "read" };
    if ((await fileHandle.queryPermission(options)) === "granted") return true;
    if ((await fileHandle.requestPermission(options)) === "granted") return true;
    return false;
}

async function writeLocalFile(rootHandle, relativePath, content) {
    // Normalize and split path
    const parts = relativePath.replace(/\\/g, "/").split("/").filter(Boolean);
    const fileName = parts.pop();

    // Traverse and auto-create nested directories
    let currentDir = rootHandle;
    for (const folder of parts) {
        currentDir = await currentDir.getDirectoryHandle(folder, { create: true });
    }

    // Create/overwrite file
    const fileHandle = await currentDir.getFileHandle(fileName, { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(content);
    await writable.close();
}

// --- Markdown Code Parsing ---
function parseMarkdownForFiles(text) {
    const files = [];

    // Pattern 1: Header immediately preceding code block: [FILE: path/to/file] or `path/to/file` or ### path/to/file
    // Pattern 2: First line inside code block: // filepath: path/to/file or # path/to/file
    // Pattern 3: Code fence info string: ```lang:path/to/file.ext or ```js filename="path/to/file.ext"
    const codeBlockRegex = /(?:(?:\*\*|###?|\[)?(?:File:?|FILE:?)?\s*`?([a-zA-Z0-9_\-\.\/]+?\.[a-zA-Z0-9]+)`?\]?\s*\n)?```(?:[\w+-]+)?(?::|\s+file=|\s+filename=)?([^\s\n]*?)?\n([\s\S]*?)```/gi;

    let match;
    while ((match = codeBlockRegex.exec(text)) !== null) {
        let filePath = match[1] || match[2] || "";
        let codeContent = match[3];

        // If path was not above the block or in fence, check first line comments
        if (!filePath) {
            const firstLine = codeContent.split("\n")[0].trim();
            const commentMatch = firstLine.match(/^(?:\/\/|#|\/\*)\s*(?:file(?:path)?:)?\s*([a-zA-Z0-9_\-\.\/]+?\.[a-zA-Z0-9]+)/i);
            if (commentMatch) {
                filePath = commentMatch[1];
                // Strip out the declaration comment from the actual file contents
                codeContent = codeContent.substring(codeContent.indexOf("\n") + 1);
            }
        }

        if (filePath && filePath.includes(".")) {
            files.push({
                path: filePath.trim(),
                content: codeContent.trimStart()
            });
        }
    }

    return files;
}

// --- UI Construction ---
function createUI() {
    if (document.getElementById("ai-sync-widget")) return;

    const widget = document.createElement("div");
    widget.id = "ai-sync-widget";
    widget.innerHTML = `
    <header>
      <span>⚡ AI Studio Code Syncer</span>
    </header>
    <div id="ai-sync-status">📁 Project: <i>None selected</i></div>
    <div class="ai-sync-btn-group">
      <button class="ai-sync-btn" id="btn-select-folder">Select Project Folder</button>
      <button class="ai-sync-btn primary" id="btn-sync-clipboard">📋 Sync from Clipboard</button>
      <button class="ai-sync-btn" id="btn-sync-dom">🔍 Sync Latest on Screen</button>
    </div>
    <div id="ai-sync-log"></div>
  `;

    document.body.appendChild(widget);

    const statusText = document.getElementById("ai-sync-status");
    const logDiv = document.getElementById("ai-sync-log");

    function log(msg) {
        logDiv.style.display = "block";
        const line = document.createElement("div");
        line.textContent = `> ${msg}`;
        logDiv.appendChild(line);
        logDiv.scrollTop = logDiv.scrollHeight;
    }

    // 1. Select Folder
    document.getElementById("btn-select-folder").addEventListener("click", async () => {
        try {
            dirHandle = await window.showDirectoryPicker({ mode: "readwrite" });
            await saveHandle(dirHandle);
            statusText.innerHTML = `📁 Project: <b class="ai-sync-active">${dirHandle.name}</b>`;
            log(`Connected to folder: ${dirHandle.name}`);
        } catch (err) {
            if (err.name !== "AbortError") log(`Error selecting folder: ${err.message}`);
        }
    });

    // Handler for syncing extracted files
    async function processAndWrite(markdownText) {
        if (!dirHandle) {
            alert("Please select your project directory first!");
            return;
        }

        const permitted = await verifyPermission(dirHandle, true);
        if (!permitted) {
            log("Error: Folder permission denied.");
            return;
        }

        const files = parseMarkdownForFiles(markdownText);
        if (files.length === 0) {
            log("No code blocks with file paths found.");
            return;
        }

        for (const file of files) {
            try {
                await writeLocalFile(dirHandle, file.path, file.content);
                log(`✓ Wrote ${file.path}`);
            } catch (e) {
                log(`✕ Failed ${file.path}: ${e.message}`);
            }
        }
    }

    // 2. Sync from Clipboard
    // (Works reliably when clicking AI Studio's native "Copy as Markdown" button)
    document.getElementById("btn-sync-clipboard").addEventListener("click", async () => {
        try {
            const text = await navigator.clipboard.readText();
            await processAndWrite(text);
        } catch (err) {
            log("Clipboard read failed: " + err.message);
        }
    });

    // 3. Sync directly by inspecting DOM
    document.getElementById("btn-sync-dom").addEventListener("click", async () => {
        // Collect text from markdown/rendered response containers
        const turnElements = document.querySelectorAll("ms-chat-turn, ms-prompt-run-output");
        let targetText = "";

        if (turnElements.length > 0) {
            targetText = turnElements[turnElements.length - 1].innerText;
        } else {
            targetText = document.body.innerText;
        }

        await processAndWrite(targetText);
    });

    // Auto-restore previously selected folder on load
    loadHandle().then((savedHandle) => {
        if (savedHandle) {
            dirHandle = savedHandle;
            statusText.innerHTML = `📁 Project: <b class="ai-sync-active">${dirHandle.name}</b> (saved)`;
            log(`Restored session for: ${dirHandle.name}`);
        }
    });
}

// Injected when the document loads
createUI();