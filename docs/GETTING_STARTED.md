# Getting Started with Open Comet

Welcome to the future of autonomous browsing. Open Comet is an AI agent that lives in your browser, helping you automate complex, multi-step tasks simply by describing them.

## Prerequisites

To run Open Comet, you will need:

1.  **Chromium-based Browser**: Chrome, Brave, Edge, or Arc.
2.  **API Keys**: At least one API key from a supported provider:
    -   **OpenAI**: [platform.openai.com](https://platform.openai.com/)
    -   **Anthropic**: [console.anthropic.com](https://console.anthropic.com/)
    -   **Google Gemini**: [ai.google.dev](https://ai.google.dev/)
    -   **DeepSeek**: [platform.deepseek.com](https://platform.deepseek.com/)
    -   **Groq**: [console.groq.com](https://console.groq.com/)

---

## Installation

Since Open Comet is currently in developer preview, it must be installed as an **Unpacked Extension**:

1.  **Get the Source**:
    - **Download**: Get the [Open Comet v1.1.0 release](https://github.com/princechouhan19/OpenCometAI/releases/tag/v1.1.0) and unzip it.
    - **Clone**: Alternatively, run `git clone https://github.com/princechouhan19/OpenCometAI.git`
2.  **Open Extensions Page**: In your browser, navigate to `chrome://extensions`.
3.  **Enable Developer Mode**: Toggle the switch in the top-right corner.
4.  **Load Unpacked**: Click the "Load unpacked" button and select the root directory (unzipped folder or cloned repo).
5.  **Pin Extension**: For the best experience, pin Open Comet to your toolbar.

---

## Local-Only Setup

No account or license activation is required.

- Open Comet runs in local-first mode.
- Configure only your preferred provider/model and API key (or use Ollama locally).
- Local data controls are available in-app:
  - **History → Clear** removes saved task history.
  - **Token & Cost Usage → Clear all usage data** removes local usage counters.

---

## Your First Task

1.  **Configure Settings**: Go to **Settings** in the side panel.
2.  **Select Model**: Choose your preferred provider (OpenAI, Anthropic, etc.) and model.
3.  **Enter API Key**: Paste your API key for the selected provider.
4.  **Run a Task**: Go to any website and type a command:
    -   *"Summarize this page into 3 bullet points."*
    -   *"Find the cheapest laptop on this page and tell me the price."*
5.  **Observe**: Watch as the agent captures context and reasons through the steps.

---

## Execution Modes

-   **Ask Mode (Default)**: The agent pauses before every action (click, type, etc.) and waits for your approval. Best for sensitive tasks or learning how the agent works.
-   **Auto Mode**: The agent runs continuously until the task is complete. Ideal for research and high-volume data extraction.

> [!TIP]
> You can switch between modes at any time using the toggle at the bottom of the side panel.
