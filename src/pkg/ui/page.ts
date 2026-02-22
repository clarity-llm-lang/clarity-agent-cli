export function buildUiPage(): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Clarity Agent CLI Broker</title>
    <style>
      :root {
        --bg: #f2f9fc;
        --panel: #ffffff;
        --ink: #102531;
        --muted: #4d6672;
        --line: #c9dde6;
        --brand: #0f7395;
        --brand-2: #18a079;
        --warn: #915120;
      }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        font-family: "IBM Plex Sans", "Segoe UI", sans-serif;
        color: var(--ink);
        background: radial-gradient(circle at 20% 0%, #dff3fc 0%, var(--bg) 45%, #e9f8f1 100%);
      }
      header {
        padding: 20px;
        border-bottom: 1px solid var(--line);
        background: linear-gradient(120deg, #f8fdff, #ecf9f2);
      }
      h1 {
        margin: 0;
        font-size: 26px;
        letter-spacing: 0.2px;
      }
      p {
        margin: 8px 0 0;
        color: var(--muted);
      }
      main {
        display: grid;
        grid-template-columns: 1fr;
        gap: 16px;
        padding: 16px;
        max-width: 1080px;
        margin: 0 auto;
      }
      .panel {
        background: var(--panel);
        border: 1px solid var(--line);
        border-radius: 16px;
        padding: 14px;
      }
      .meta {
        display: flex;
        gap: 12px;
        flex-wrap: wrap;
        color: var(--muted);
        font-size: 13px;
      }
      .questions {
        display: grid;
        gap: 12px;
      }
      .card {
        border: 1px solid var(--line);
        border-radius: 12px;
        padding: 12px;
        background: #fcfeff;
      }
      .card h3 {
        margin: 0;
        font-size: 16px;
      }
      .card .k {
        display: inline-block;
        font-family: "IBM Plex Mono", "Menlo", monospace;
        background: #e7f6fd;
        border: 1px solid #b5dff0;
        padding: 2px 8px;
        border-radius: 999px;
        font-size: 12px;
      }
      .q {
        margin-top: 10px;
        white-space: pre-wrap;
        font-family: "IBM Plex Mono", "Menlo", monospace;
        font-size: 13px;
        background: #0e1d25;
        color: #d8f4ff;
        padding: 12px;
        border-radius: 10px;
        min-height: 56px;
      }
      textarea {
        margin-top: 10px;
        width: 100%;
        min-height: 72px;
        border-radius: 10px;
        border: 1px solid var(--line);
        padding: 10px;
        resize: vertical;
        font-family: "IBM Plex Mono", "Menlo", monospace;
      }
      .actions {
        margin-top: 10px;
        display: flex;
        gap: 8px;
      }
      button {
        border: 0;
        border-radius: 10px;
        padding: 8px 12px;
        cursor: pointer;
        color: white;
        font-weight: 600;
        background: var(--brand);
      }
      button.cancel {
        background: var(--warn);
      }
      .events {
        font-family: "IBM Plex Mono", "Menlo", monospace;
        font-size: 12px;
        background: #0d1a21;
        color: #d8ecf5;
        border-radius: 10px;
        padding: 10px;
        max-height: 220px;
        overflow: auto;
      }
      @media (max-width: 720px) {
        h1 { font-size: 22px; }
      }
    </style>
  </head>
  <body>
    <header>
      <h1>Clarity Agent CLI Broker</h1>
      <p>Live operator console for pending HITL questions.</p>
    </header>
    <main>
      <section class="panel">
        <div class="meta" id="meta"></div>
      </section>
      <section class="panel">
        <h2>Pending Questions</h2>
        <div id="questions" class="questions"></div>
      </section>
      <section class="panel">
        <h2>Event Stream</h2>
        <div id="events" class="events"></div>
      </section>
    </main>
    <script>
      const params = new URLSearchParams(location.search);
      const token = params.get("token") || "";
      const state = {
        questions: [],
        events: []
      };

      function esc(value) {
        return String(value)
          .replaceAll("&", "&amp;")
          .replaceAll("<", "&lt;")
          .replaceAll(">", "&gt;");
      }

      function authHeaders() {
        return token ? { "Authorization": "Bearer " + token } : {};
      }

      function nowIso() {
        return new Date().toISOString();
      }

      function eventUrl(path) {
        if (!token) return path;
        const join = path.includes("?") ? "&" : "?";
        return path + join + "token=" + encodeURIComponent(token);
      }

      function renderMeta() {
        const el = document.getElementById("meta");
        el.innerHTML = [
          "<span>pending=" + state.questions.length + "</span>",
          "<span>updated=" + esc(nowIso()) + "</span>",
          "<span>auth=" + (token ? "token" : "none") + "</span>"
        ].join(" | ");
      }

      async function answerQuestion(key, text) {
        const response = await fetch(eventUrl("/answer"), {
          method: "POST",
          headers: {
            "content-type": "application/json",
            ...authHeaders()
          },
          body: JSON.stringify({ key, response: text })
        });
        if (!response.ok) {
          const body = await response.text();
          throw new Error("answer failed (" + response.status + "): " + body);
        }
      }

      async function cancelQuestion(key) {
        const response = await fetch(eventUrl("/cancel"), {
          method: "POST",
          headers: {
            "content-type": "application/json",
            ...authHeaders()
          },
          body: JSON.stringify({ key })
        });
        if (!response.ok) {
          const body = await response.text();
          throw new Error("cancel failed (" + response.status + "): " + body);
        }
      }

      function renderQuestions() {
        const host = document.getElementById("questions");
        if (state.questions.length === 0) {
          host.innerHTML = "<p>No pending questions.</p>";
          return;
        }

        host.innerHTML = state.questions.map((item) => {
          const key = esc(item.key || "");
          const timestamp = Number(item.timestamp || 0);
          const age = Number(item.ageSeconds || 0);
          return (
            '<article class="card" data-key="' + key + '">' +
            '<h3><span class="k">' + key + "</span></h3>" +
            '<div class="meta">age=' + age + "s | timestamp=" + new Date(timestamp).toISOString() + "</div>" +
            '<div class="q">' + esc(item.question || "") + "</div>" +
            '<textarea data-response="' + key + '" placeholder="Type your response"></textarea>' +
            '<div class="actions">' +
            '<button data-answer="' + key + '">Answer</button>' +
            '<button class="cancel" data-cancel="' + key + '">Cancel</button>' +
            "</div>" +
            "</article>"
          );
        }).join("");
      }

      function pushEvent(event) {
        state.events.push(event);
        state.events = state.events.slice(-120);
        const host = document.getElementById("events");
        host.innerHTML = state.events.map((row) => esc(JSON.stringify(row))).join("\n");
        host.scrollTop = host.scrollHeight;
      }

      async function refreshQuestions() {
        const response = await fetch(eventUrl("/questions"), {
          headers: {
            ...authHeaders()
          }
        });
        if (!response.ok) {
          throw new Error("failed to load questions (" + response.status + ")");
        }
        state.questions = await response.json();
        renderQuestions();
        renderMeta();
      }

      function bindActions() {
        document.addEventListener("click", async (event) => {
          const target = event.target;
          if (!(target instanceof HTMLElement)) {
            return;
          }
          const answerKey = target.getAttribute("data-answer");
          if (answerKey) {
            const input = document.querySelector(
              'textarea[data-response="' + CSS.escape(answerKey) + '"]'
            );
            const value = input && "value" in input ? String(input.value || "") : "";
            try {
              await answerQuestion(answerKey, value);
              pushEvent({ type: "answered", key: answerKey, ts: nowIso() });
              await refreshQuestions();
            } catch (error) {
              pushEvent({ type: "error", action: "answer", key: answerKey, message: String(error) });
            }
            return;
          }
          const cancelKey = target.getAttribute("data-cancel");
          if (cancelKey) {
            try {
              await cancelQuestion(cancelKey);
              pushEvent({ type: "cancelled", key: cancelKey, ts: nowIso() });
              await refreshQuestions();
            } catch (error) {
              pushEvent({ type: "error", action: "cancel", key: cancelKey, message: String(error) });
            }
          }
        });
      }

      function startEvents() {
        try {
          const stream = new EventSource(eventUrl("/events"));
          stream.onmessage = (event) => {
            try {
              const data = JSON.parse(event.data);
              pushEvent(data);
              refreshQuestions().catch((error) => {
                pushEvent({ type: "error", action: "refresh", message: String(error) });
              });
            } catch {
              pushEvent({ type: "raw", data: event.data });
            }
          };
          stream.onerror = () => {
            pushEvent({ type: "warning", message: "event stream disconnected" });
            stream.close();
            setTimeout(startEvents, 2000);
          };
        } catch (error) {
          pushEvent({ type: "error", action: "events", message: String(error) });
        }
      }

      bindActions();
      refreshQuestions()
        .then(() => pushEvent({ type: "ready", ts: nowIso() }))
        .catch((error) => pushEvent({ type: "error", action: "initial-load", message: String(error) }));
      startEvents();
      setInterval(() => {
        refreshQuestions().catch((error) => pushEvent({ type: "error", action: "poll", message: String(error) }));
      }, 5000);
    </script>
  </body>
</html>`;
}
