/**
 * @file content.js
 * Self-contained Client-Side Synchronizer for Google AI Studio
 */

"use strict";

console.log("[AI Studio Syncer] Script loaded on", window.location.href);

(function () {
    const isChromium = typeof window.showDirectoryPicker === "function";
    let dirHandle = null;

    const PROTOCOL_TAG = "[CRITICAL FORMATTING RULE]";
    const FORMAT_INSTRUCTION = `\n\n${PROTOCOL_TAG}: When generating code, always specify the relative file path either as a header immediately preceding the code block like:
[FILE: src/components/Button.tsx]
\`\`\`tsx
// code...
\`\`\`
Or as the first line comment inside the block (e.g., // filepath: src/components/Button.tsx).`;

    // --- 1. Programmatic Style Injection ---
    function injectStyles() {
        if (document.getElementById("ai-sync-injected-css")) return;
        const styleEl = document.createElement("style");
        styleEl.id = "ai-sync-injected-css";
        styleEl.textContent = `
      #ai-sync-panel-host {
        position: fixed !important;
        bottom: 24px !important;
        right: 24px !important;
        z-index: 2147483647 !important;
        width: 320px !important;
        background: #1e1f20 !important;
        color: #e3e3e3 !important;
        border: 1px solid #3c4043 !important;
        border-radius: 10px !important;
        box-shadow: 0 10px 30px rgba(0,0,0,0.7) !important;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif !important;
        font-size: 13px !important;
        padding: 14px !important;
        display: flex !important;
        flex-direction: column !important;
        gap: 10px !important;
        box-sizing: border-box !important;
      }
      #ai-sync-panel-host * {
        box-sizing: border-box !important;
      }
      #ai-sync-panel-host header {
        display: flex !important;
        justify-content: space-between !important;
        font-weight: 600 !important;
        border-bottom: 1px solid #333538 !important;
        padding-bottom: 6px !important;
      }
      .ai-sync-btn {
        background: #2a2b2e !important;
        color: #e3e3e3 !important;
        border: 1px solid #444746 !important;
        padding: 8px 10px !important;
        border-radius: 6px !important;
        cursor: pointer !important;
        font-size: 12px !important;
        font-weight: 500 !important;
        text-align: center !important;
      }
      .ai-sync-btn:hover {
        background: #37393d !important;
      }
      .ai-sync-btn.primary {
        background: #1a73e8 !important;
        color: #ffffff !important;
        border-color: #1a73e8 !important;
      }
      .ai-sync-btn.primary:hover {
        background: #1765cc !important;
      }
      #ai-sync-log {
        max-height: 100px !important;
        overflow-y: auto !important;
        background: #121316 !important;
        padding: 6px !important;
        border-radius: 4px !important;
        font-family: monospace !important;
        font-size: 11px !important;
        color: #81c995 !important;
        display: none !important;
      }
    `;
        (document.head || document.documentElement).appendChild(styleEl);
    }

    // --- 2. File Writing Engine ---
    async function commitFile(path, content) {
        const cleanPath = path.replace(/\\/g, "/").replace(/^\/+/, "");

        if (isChromium && dirHandle) {
            // Chrome/Edge: Direct folder writing
            const parts = cleanPath.split("/").filter(Boolean);
            const fileName = parts.pop();

            let currentDir = dirHandle;
            for (const folder of parts) {
                currentDir = await currentDir.getDirectoryHandle(folder, { create: true });
            }
            const fileHandle = await currentDir.getFileHandle(fileName, { create: true });
            const writable = await fileHandle.createWritable();
            await writable.write(content);
            await writable.close();
        } else {
            // Firefox / Fallback: Native HTML5 download trigger
            const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = cleanPath.split("/").pop();
            document.documentElement.appendChild(a);
            a.click();
            a.remove();
            setTimeout(() => URL.revokeObjectURL(url), 2000);
        }
    }

    // --- 3. Parsing Logic (Ignores Model Thoughts) ---
    function extractFilesFromNode(turnNode) {
        const files = [];

        // Strip thoughts/reasoning completely
        const codeBlocks = Array.from(turnNode.querySelectorAll("ms-code-block")).filter(
            (node) => !node.closest("ms-thought-chunk, .thought-panel")
        );

        for (const block of codeBlocks) {
            const code = block.querySelector("pre code") || block.querySelector("pre");
            if (!code) continue;

            let text = code.innerText.trim();
            let path = "";

            const lines = text.split("\n");
            const firstLine = lines[0].trim();
            const match = firstLine.match(
                /^(?:\[FILE:\s*|(?:\/\/|#|\/\*)\s*(?:file(?:path)?:)?\s*)([a-zA-Z0-9_\-\.\/]+\.[a-zA-Z0-9]+)\]?/i
            );

            if (match) {
                path = match[1];
                text = lines.slice(1).join("\n").trimStart();
            } else {
                let prev = block.previousElementSibling;
                if (prev) {
                    const prevMatch = prev.innerText.trim().match(
                        /(?:\[FILE:\s*|File:\s*`?)([a-zA-Z0-9_\-\.\/]+\.[a-zA-Z0-9]+)`?\]?/i
                    );
                    if (prevMatch) path = prevMatch[1];
                }
            }

            if (path && path.includes(".")) {
                files.push({ path: path.trim(), content: text });
            }
        }

        // Fallback: Check raw Markdown if elements are unrendered
        if (files.length === 0) {
            const clone = turnNode.cloneNode(true);
            clone.querySelectorAll("ms-thought-chunk, .thought-panel").forEach((e) => e.remove());
            return parseRawMarkdown(clone.innerText);
        }

        return files;
    }

    function parseRawMarkdown(text) {
        const files = [];
        const regex = /(?:\[FILE:\s*([a-zA-Z0-9_\-\.\/]+\.[a-zA-Z0-9]+)\]\s*\n)?```(?:[\w+-]+)?(?::|\s+file=|\s+filename=)?([^\s\n]*?)?\n([\s\S]*?)```/gi;
        let match;

        while ((match = regex.exec(text)) !== null) {
            let path = match[1] || match[2] || "";
            let code = match[3];

            if (!path) {
                const firstLine = code.split("\n")[0].trim();
                const m = firstLine.match(
                    /^(?:\/\/|#|\/\*)\s*(?:file(?:path)?:)?\s*([a-zA-Z0-9_\-\.\/]+\.[a-zA-Z0-9]+)/i
                );
                if (m) {
                    path = m[1];
                    code = code.substring(code.indexOf("\n") + 1);
                }
            }

            if (path && path.includes(".")) {
                files.push({ path: path.trim(), content: code.trimStart() });
            }
        }
        return files;
    }

    // --- 4. Angular-Compatible Textbox Insertion ---
    function insertRule() {
        const input =
            document.querySelector("textarea[aria-label*='Type something' i]") ||
            document.querySelector("ms-chat-prompt textarea") ||
            document.querySelector("textarea[placeholder*='Type' i]") ||
            document.querySelector("textarea[aria-label*='prompt' i]") ||
            document.querySelector("div[contenteditable='true']") ||
            document.querySelector("textarea");

        if (!input) return false;

        const val = input.tagName === "TEXTAREA" ? input.value : input.innerText;
        if (val.includes(PROTOCOL_TAG)) return false;

        input.focus();

        // execCommand ensures Angular registers the changes into its Reactive Form
        const addition = (val.trim() ? "\n\n" : "") + FORMAT_INSTRUCTION.trim();
        const ok = document.execCommand("insertText", false, addition);

        if (!ok) {
            if (input.tagName === "TEXTAREA") input.value = val + addition;
            else input.innerText = val + addition;
            input.dispatchEvent(new Event("input", { bubbles: true }));
            input.dispatchEvent(new Event("change", { bubbles: true }));
        }
        return true;
    }

    // Auto-inject whenever clicking/focusing any prompt input
    document.addEventListener("focusin", (e) => {
        const t = e.target;
        if (t && (t.tagName === "TEXTAREA" || t.isContentEditable) && !t.closest("#ai-sync-panel-host")) {
            insertRule();
        }
    });

    // --- 5. UI Builder (Attached to documentElement to survive Angular resets) ---
    function buildUI() {
        injectStyles();
        if (document.getElementById("ai-sync-panel-host")) return;

        const panel = document.createElement("div");
        panel.id = "ai-sync-panel-host";

        panel.innerHTML = `
      <header>
        <span>⚡ AI Studio Syncer</span>
        <span style="font-size:10px;color:#8ab4f8;">${isChromium ? "Chrome" : "Firefox"}</span>
      </header>
      <div id="ai-sync-status" style="font-size:11px;color:#9aa0a6;">
        ${isChromium ? "Target: <i>No folder selected</i>" : "Target: <i>Direct Browser Downloads</i>"}
      </div>
      <div style="display:flex;flex-direction:column;gap:6px;">
        ${isChromium ? `<button class="ai-sync-btn" id="ai-btn-folder">Select Project Folder</button>` : ""}
        <button class="ai-sync-btn" id="ai-btn-insert">📝 Put Rule in Textbox</button>
        <button class="ai-sync-btn primary" id="ai-btn-sync">⚡ Sync Latest Response</button>
      </div>
      <div id="ai-sync-log"></div>
    `;

        // Append to documentElement so Angular can never overwrite it
        (document.documentElement || document.body).appendChild(panel);

        const logDiv = panel.querySelector("#ai-sync-log");
        const statusText = panel.querySelector("#ai-sync-status");

        function log(msg, isErr = false) {
            logDiv.style.display = "block";
            const line = document.createElement("div");
            line.style.color = isErr ? "#f28b82" : "#81c995";
            line.textContent = `> ${msg}`;
            logDiv.appendChild(line);
            logDiv.scrollTop = logDiv.scrollHeight;
        }

        panel.querySelector("#ai-btn-insert").addEventListener("click", () => {
            if (insertRule()) log("Rule added to prompt!");
            else log("Rule already present or input not found.", true);
        });

        if (isChromium) {
            panel.querySelector("#ai-btn-folder").addEventListener("click", async () => {
                try {
                    dirHandle = await window.showDirectoryPicker({ mode: "readwrite" });
                    statusText.innerHTML = `Target: <b style="color:#81c995;">${dirHandle.name}</b>`;
                    log(`Connected to: ${dirHandle.name}`);
                } catch (e) {
                    if (e.name !== "AbortError") log(`Error: ${e.message}`, true);
                }
            });
        }

        panel.querySelector("#ai-btn-sync").addEventListener("click", async () => {
            const turns = document.querySelectorAll("ms-chat-turn .chat-turn-container.model");
            if (turns.length === 0) {
                log("No AI responses found on page.", true);
                return;
            }

            if (isChromium && !dirHandle) {
                alert("Please click 'Select Project Folder' first!");
                return;
            }

            const latestTurn = turns[turns.length - 1].closest("ms-chat-turn");
            const files = extractFilesFromNode(latestTurn);

            if (files.length === 0) {
                log("No code blocks with [FILE: path] found.", true);
                return;
            }

            for (const file of files) {
                try {
                    await commitFile(file.path, file.content);
                    log(`✓ Saved ${file.path}`);
                } catch (err) {
                    log(`✕ Error ${file.path}: ${err.message}`, true);
                }
            }
        });
    }

    // Persistence heartbeat: keeps UI alive across navigation
    setInterval(buildUI, 1000);
    buildUI();
})();