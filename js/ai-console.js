import { apiFetch, byId, requireAuth } from "./api.js";

function initAiConsole() {
  const form = byId("aiConsoleForm");
  const output = byId("aiConsoleOutput");
  if (!form || !output) return;

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!requireAuth()) return;
    const prompt = new FormData(form).get("prompt");
    const submit = form.querySelector("[type='submit']");
    const originalText = submit?.textContent || "";
    if (submit) {
      submit.disabled = true;
      submit.textContent = "Running...";
    }
    output.textContent = "Running NVIDIA Maverick...";

    try {
      const result = await apiFetch("/api/ai/chat", {
        method: "POST",
        body: JSON.stringify({ prompt })
      });
      output.textContent = result.content;
    } catch (error) {
      output.textContent = error.message;
    } finally {
      if (submit) {
        submit.disabled = false;
        submit.textContent = originalText;
      }
    }
  });
}

document.addEventListener("DOMContentLoaded", initAiConsole);
