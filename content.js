/**
 * @file content.js
 * Self-contained Client-Side Synchronizer for Google AI Studio
 */

"use strict";

console.log("[AI Studio Syncer] Script loaded on", window.location.href);

(function () {
    const isChromium = typeof window.showDirectoryPicker === "function";
    let dirHandle = null;
    let ruleInsertedForChat = false;
    let lastUrl = window.location.href;

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
        width: 300px !important;
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
        max-height: 120px !important;
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
        if (!content || !content.trim()) {
            throw new Error("Content is empty; refused to write empty file.");
        }

        const cleanPath = path.replace(/\\/g, "/").replace(/^\/+/, "");

        if (isChromium && dirHandle) {
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

    // --- 3. "Copy as Markdown" Extraction via Turn Dropdown ---
    function closeAnyOpenMenu() {
        const backdrop = document.querySelector(".cdk-overlay-backdrop");
        if (backdrop) backdrop.click();
        document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    }

    async function getMarkdownFromTurnDropdown(turnNode) {
        if (!turnNode) return null;

        const optionsBtn =
            turnNode.querySelector("ms-chat-turn-options button") ||
            turnNode.querySelector("button[aria-label*='options' i]") ||
            turnNode.querySelector("button[mattooltip*='options' i]") ||
            turnNode.querySelector(".actions button.mat-mdc-menu-trigger");

        if (!optionsBtn) return null;

        // Ensure actions container is interactive
        const actionsWrapper = optionsBtn.closest(".actions") || optionsBtn.parentElement;
        const prevPointerEvents = actionsWrapper ? actionsWrapper.style.pointerEvents : "";
        const prevOpacity = actionsWrapper ? actionsWrapper.style.opacity : "";
        if (actionsWrapper) {
            actionsWrapper.style.pointerEvents = "auto";
            actionsWrapper.style.opacity = "1";
        }

        try {
            optionsBtn.click();

            // Wait for Angular CDK overlay menu panel to attach to DOM
            let menuPanel = null;
            for (let i = 0; i < 15; i++) {
                await new Promise((r) => setTimeout(r, 40));
                const panels = document.querySelectorAll(".mat-mdc-menu-panel, .mat-menu-panel");
                if (panels.length > 0) {
                    menuPanel = panels[panels.length - 1];
                    break;
                }
            }

            if (!menuPanel) return null;

            const items = Array.from(
                menuPanel.querySelectorAll(".mat-mdc-menu-item, [role='menuitem'], button")
            );
            const copyMarkdownBtn = items.find((el) => {
                const label = (el.textContent || "").toLowerCase();
                return label.includes("markdown");
            });

            if (!copyMarkdownBtn) {
                closeAnyOpenMenu();
                return null;
            }

            copyMarkdownBtn.click();

            // Allow clipboard write event to settle
            await new Promise((r) => setTimeout(r, 100));

            const mdText = await navigator.clipboard.readText();
            return mdText && mdText.trim() ? mdText : null;
        } catch (e) {
            console.warn("[AI Studio Syncer] Dropdown clipboard read failed:", e);
            return null;
        } finally {
            if (actionsWrapper) {
                actionsWrapper.style.pointerEvents = prevPointerEvents;
                actionsWrapper.style.opacity = prevOpacity;
            }
            closeAnyOpenMenu();
        }
    }

    // --- 4. Fallback DOM Parsing Engine ---
    function extractFilesFromNode(turnNode) {
        const files = [];

        // Exclude thoughts and reasoning chunks
        const codeBlocks = Array.from(turnNode.querySelectorAll("ms-code-block")).filter(
            (node) => !node.closest("ms-thought-chunk, .thought-panel")
        );

        for (const block of codeBlocks) {
            const pre = block.querySelector("pre");
            if (!pre) continue;

            const codeEl = pre.querySelector("code") || pre;
            // Use textContent so collapsed/visibility:hidden panels do NOT return ""
            let text = (codeEl.textContent || codeEl.innerText || "").replace(/\r\n/g, "\n").trim();
            if (!text) continue;

            let path = "";
            const lines = text.split("\n");
            const firstLine = lines[0].trim();
            const match = firstLine.match(
                /^(?:\[FILE:\s*|(?:\/\/|#|\/\*)\s*(?:file(?:path)?:)?\s*)([a-zA-Z0-9_\-\.\/]+\.[a-zA-Z0-9]+)\]?/i
            );

            if (match) {
                path = match[1];
                text = lines.slice(1).join("\n").trim();
            } else {
                let prev = block.previousElementSibling;
                while (prev && !path) {
                    const prevText = (prev.textContent || prev.innerText || "").trim();
                    const prevMatch = prevText.match(
                        /(?:\[FILE:\s*|File:\s*`?)([a-zA-Z0-9_\-\.\/]+\.[a-zA-Z0-9]+)`?\]?/i
                    );
                    if (prevMatch) {
                        path = prevMatch[1];
                        break;
                    }
                    if (prevText.length > 0) break;
                    prev = prev.previousElementSibling;
                }
            }

            if (path && path.includes(".") && text.length > 0) {
                files.push({ path: path.trim(), content: text + "\n" });
            }
        }

        // Secondary fallback: parse raw text content from cloned turn node
        if (files.length === 0) {
            const clone = turnNode.cloneNode(true);
            clone.querySelectorAll("ms-thought-chunk, .thought-panel").forEach((e) => e.remove());
            // Use textContent because detached nodes in Blink return "" for innerText
            const rawText = (clone.textContent || clone.innerText || "").replace(/\r\n/g, "\n");
            return parseRawMarkdown(rawText);
        }

        return files;
    }

    function parseRawMarkdown(text) {
        if (!text) return [];
        const files = [];
        const regex = /(?:(?:\[FILE:\s*|File:\s*`?)([a-zA-Z0-9_\-\.\/]+\.[a-zA-Z0-9]+)`?\]?\s*\n\s*)?```(?:[\w+-]+)?(?::|\s+file=|\s+filename=)?([^\s\n]*?)?\n([\s\S]*?)```/gi;
        let match;

        while ((match = regex.exec(text)) !== null) {
            let path = match[1] || match[2] || "";
            let code = match[3] || "";

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

            const trimmed = code.trim();
            if (path && path.includes(".") && trimmed.length > 0) {
                files.push({ path: path.trim(), content: trimmed + "\n" });
            }
        }
        return files;
    }

    // --- 5. First-Turn-Only Prompt Insertion ---
    function isFirstTurn() {
        const turns = document.querySelectorAll("ms-chat-turn");
        return turns.length === 0;
    }

    function insertRuleIfFirstTurn() {
        if (ruleInsertedForChat) return false;

        // If there are already turns, this conversation has already started
        if (!isFirstTurn()) {
            ruleInsertedForChat = true;
            return false;
        }

        const input =
            document.querySelector("textarea[formcontrolname='promptText']") ||
            document.querySelector("textarea[aria-label*='Enter a prompt' i]") ||
            document.querySelector("textarea[aria-label*='Type something' i]") ||
            document.querySelector("textarea[aria-label*='prompt' i]") ||
            document.querySelector("textarea[placeholder*='prompt' i]") ||
            document.querySelector("ms-chat-prompt textarea") ||
            document.querySelector("div[contenteditable='true']") ||
            document.querySelector("textarea");

        if (!input) return false;

        const val = input.tagName === "TEXTAREA" ? input.value : input.innerText;
        if (val.includes(PROTOCOL_TAG)) {
            ruleInsertedForChat = true;
            return false;
        }

        input.focus();

        const addition = (val.trim() ? "\n\n" : "") + FORMAT_INSTRUCTION.trim();
        const ok = document.execCommand("insertText", false, addition);

        if (!ok) {
            if (input.tagName === "TEXTAREA") input.value = val + addition;
            else input.innerText = val + addition;
            input.dispatchEvent(new Event("input", { bubbles: true }));
            input.dispatchEvent(new Event("change", { bubbles: true }));
        }

        // Place cursor at the start of the prompt box if it was previously empty
        if (!val.trim() && input.setSelectionRange) {
            input.setSelectionRange(0, 0);
        }

        ruleInsertedForChat = true;
        return true;
    }

    // Auto-inject only when focusing input on the first turn
    document.addEventListener("focusin", (e) => {
        const t = e.target;
        if (t && (t.tagName === "TEXTAREA" || t.isContentEditable) && !t.closest("#ai-sync-panel-host")) {
            insertRuleIfFirstTurn();
        }
    });

    // Reset injection flag if user navigates to a brand new chat
    setInterval(() => {
        if (window.location.href !== lastUrl) {
            lastUrl = window.location.href;
            if (isFirstTurn()) {
                ruleInsertedForChat = false;
            } else {
                ruleInsertedForChat = true;
            }
        }
    }, 500);

    // If loaded on a page with existing turns, mark inserted so it never triggers
    if (!isFirstTurn()) {
        ruleInsertedForChat = true;
    }

    // --- 6. UI Builder ---
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
        ${isChromium ? `<button class="ai-sync-btn" id="ai-btn-folder">📁 Select Project Folder</button>` : ""}
        <button class="ai-sync-btn primary" id="ai-btn-sync">⚡ Sync Latest Response</button>
      </div>
      <div id="ai-sync-log"></div>
    `;

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
            log("Extracting response files...");

            let files = [];

            // Primary: Use "Copy as markdown" from turn options dropdown
            try {
                const mdText = await getMarkdownFromTurnDropdown(latestTurn);
                if (mdText) {
                    files = parseRawMarkdown(mdText);
                    if (files.length > 0) {
                        log(`Found ${files.length} file(s) via Markdown copy.`);
                    }
                }
            } catch (err) {
                console.warn("[AI Studio Syncer] Dropdown Markdown extraction failed:", err);
            }

            // Fallback: Use direct DOM parsing if dropdown copy was unavailable
            if (files.length === 0) {
                files = extractFilesFromNode(latestTurn);
                if (files.length > 0) {
                    log(`Found ${files.length} file(s) via DOM nodes.`);
                }
            }

            if (files.length === 0) {
                log("No code blocks with [FILE: path] found.", true);
                return;
            }

            let saved = 0;
            for (const file of files) {
                try {
                    await commitFile(file.path, file.content);
                    log(`✓ Saved ${file.path} (${file.content.length} chars)`);
                    saved++;
                } catch (err) {
                    log(`✕ Error ${file.path}: ${err.message}`, true);
                }
            }

            if (saved > 0) {
                log(`Successfully synced ${saved} file(s)!`);
            }
        });
    }

    setInterval(buildUI, 1000);
    buildUI();
})();