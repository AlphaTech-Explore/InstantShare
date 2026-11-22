# ShareMe - Zero-Auth Instant Media Stream

A modern, responsive real-time photo & video sharing platform requiring **no signups, no passwords, and no login**. Any user on the same network can view, upload, and stream media instantly without needing to download files first.

## ✨ Features
- **Zero Authentication**: Drag and drop photos or videos directly from any browser.
- **In-Browser Streaming**: Videos (MP4, WebM, MOV) stream directly with audio and native controls; photos open in crisp full-resolution modals.
- **Real-Time WebSocket Sync**: When any device uploads a file, it pops up immediately on all other connected screens without refreshing.
- **Multi-Device Support**: Built-in **"Connect Device"** modal with automatic QR Code generation and copy-link button.
- **Format Filter**: Filter by Photos, Videos, or view All.
- **Persistent Storage**: Saved in `uploads/` with a lightweight metadata index `data.json`.

---

## 🚀 How to Run

1. Open your terminal in this project folder:
   ```bash
   cd "e:\Antigravity Drafts\ShareMe"
   ```
2. Start the server:
   ```bash
   node server.js
   ```
3. Open in your browser:
   - On this PC: [http://localhost:3000](http://localhost:3000)
   - On other phones/tablets on the same Wi-Fi: [http://10.43.205.66:3000](http://10.43.205.66:3000) *(or click "Connect Device" in the header to scan the QR code)*
