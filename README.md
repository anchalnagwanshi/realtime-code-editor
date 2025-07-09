# 🧑‍💻 Realtime Collaborative Code Editor

A full-stack real-time code editor with integrated chat, voice/video calling (WebRTC), Google login, and Firebase integration. Collaborate on code, communicate live, and manage projects in one seamless platform.

## 🚀 Features

- 🔄 Real-Time Code Sync (via Socket.IO)
- 🗣️ Integrated Chat
- 📹 Video & 🎤 Audio Calling with WebRTC
- 🔐 Google Authentication (via Firebase)
- 💾 Save & 📂 Load Projects (via Firestore)
- ☁️ Upload/Delete Project Assets (via Firebase Storage)
- 💻 Code Execution (Judge0 API integration)
- 🎯 Language Support: C++, Python, Java, JavaScript, C
- 📁 Multiple Files per Project
- 📤 Cloud Asset Uploads
- 📱 Responsive & Intuitive UI

## 🧱 Tech Stack

### Frontend
- React.js
- Monaco Editor (`@monaco-editor/react`)
- Firebase (Auth, Firestore, Storage)
- WebRTC (Peer-to-peer calling)
- Judge0 API (for code execution)

### Backend
- Node.js
- Express.js
- Socket.IO

## 📁 Project Structure

```text
📦 realtime-code-editor/
├── 📁 client/                          # React frontend
│   ├── App.js                         # Handles layout, auth, and CodeEditor rendering
│   ├── CodeEditor.js                  # Core collaborative editor (chat, video call, storage)
│   ├── firebase.js                    # Firebase Auth + Firestore + Storage config
│   ├── index.js                       # Entry point for React app
│   └── ...                            # Other React components or utilities
│
├── 📁 server/                          # Backend server
│   └── server.js                      # Express + Socket.IO server for code sync & WebRTC signaling
│
├── .env                               # Environment variables (API keys, server URL)
├── package.json                       # Project metadata and frontend dependencies
├── README.md                          # Project documentation (this file)
└── .gitignore                         # Files and folders to ignore in Git
```

## 🔧 Setup Instructions

### 1️⃣ Prerequisites
- Node.js
- Firebase project (with Firestore, Auth, and Storage enabled)
- RapidAPI account (for Judge0)

---

### 2️⃣ Clone the Repository

```bash
git clone https://github.com/your-username/realtime-code-editor.git
cd realtime-code-editor
```

---

### 3️⃣ Setup Firebase

Update `firebase.js` with your own Firebase project config:

```js
const firebaseConfig = {
  apiKey: "YOUR_API_KEY",
  authDomain: "YOUR_PROJECT.firebaseapp.com",
  projectId: "YOUR_PROJECT_ID",
  storageBucket: "YOUR_PROJECT.appspot.com",
  messagingSenderId: "YOUR_SENDER_ID",
  appId: "YOUR_APP_ID"
};
```

---

### 4️⃣ Install Dependencies

#### Backend

```bash
cd server
npm install
node server.js
```

#### Frontend

```bash
cd client
npm install
npm start
```
