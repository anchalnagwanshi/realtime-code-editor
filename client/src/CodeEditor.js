// client/src/CodeEditor.js
import React, { useEffect, useRef, useState, useCallback } from 'react';
import { io } from 'socket.io-client';
import Editor from '@monaco-editor/react';
import axios from 'axios';
import { db, storage } from './firebase'; // Import storage
import { collection, doc, setDoc, getDoc, getDocs, deleteDoc } from "firebase/firestore"; // Import deleteDoc
import { ref, deleteObject, listAll, uploadBytes } from "firebase/storage"; // Import Storage functions like listAll, uploadBytes
import CodeVisualizerModal from './CodeVisualizerModal'; // <-- 1. IMPORT THE NEW COMPONENT

// Initialize Socket.IO client, connecting to your backend server
const socket = io(process.env.REACT_APP_SOCKET_SERVER_URL || 'http://localhost:3001');

// A generic Modal component
// MODIFIED: Made wider and taller to accommodate the visualizer
const ModalDialog = ({ title, message, onConfirm, onCancel, confirmText = "Confirm" }) => {
  return (
    <div style={{
      position: 'fixed', top: '0', left: '0', right: '0', bottom: '0',
      backgroundColor: 'rgba(0,0,0,0.7)', display: 'flex', justifyContent: 'center', alignItems: 'center',
      zIndex: 1000
    }}>
      <div style={{
        backgroundColor: '#282c34', padding: '20px', borderRadius: '8px',
        boxShadow: '0 4px 8px rgba(0,0,0,0.2)',
        width: '90%', // Make modal wider
        maxWidth: '1200px', // Max width for visualizer
        display: 'flex',
        flexDirection: 'column',
        maxHeight: '90vh' // Set max height for the whole modal
      }}>
        <h3 style={{ marginTop: 0, color: '#58a6ff', borderBottom: '1px solid #30363d', paddingBottom: '10px', flexShrink: 0 }}>{title}</h3>
        
        {/* This div will contain the content and scroll if needed */}
        <div style={{ overflowY: 'auto', flexGrow: 1, minHeight: '60vh' }}>
          {message}
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '15px', marginTop: '20px', paddingTop: '15px', borderTop: '1px solid #30363d', flexShrink: 0 }}>
          {onCancel && (
            <button
              onClick={onCancel}
              style={{
                padding: '10px 20px', backgroundColor: '#6c757d', color: 'white', border: 'none',
                borderRadius: '5px', cursor: 'pointer', transition: 'background-color 0.2s ease'
              }}
              onMouseEnter={(e) => e.target.style.backgroundColor = '#5a6268'}
              onMouseLeave={(e) => e.target.style.backgroundColor = '#6c757d'}
            >
              Cancel
            </button>
          )}
          <button
            onClick={onConfirm}
            style={{
              padding: '10px 20px', backgroundColor: onCancel ? '#dc3545' : '#0366d6', color: 'white', border: 'none',
              borderRadius: '5px', cursor: 'pointer', transition: 'background-color 0.2s ease'
            }}
            onMouseEnter={(e) => e.target.style.backgroundColor = onCancel ? '#c82333' : '#005cc5'}
            onMouseLeave={(e) => e.target.style.backgroundColor = onCancel ? '#dc3545' : '#0366d6'}
          >
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  );
};


export default function CodeEditor({ user, projectName, setProjectName }) {
  const [files, setFiles] = useState({ 'main.cpp': { code: '// Start coding...', language: 'cpp' } });
  const [activeFile, setActiveFile] = useState('main.cpp');
  const [output, setOutput] = useState('');
  const [roomInput, setRoomInput] = useState('');
  const [userInput, setUserInput] = useState('');
  const [messages, setMessages] = useState([]);
  const [chatInput, setChatInput] = useState('');
  const [roomParticipants, setRoomParticipants] = useState([]);

  // Modal States
  const [showConfirmDialog, setShowConfirmDialog] = useState(false);
  const [confirmMessage, setConfirmMessage] = useState('');
  const [confirmAction, setConfirmAction] = useState(() => () => {}); // Function to execute on confirm
  const [confirmTitle, setConfirmTitle] = useState('Confirmation');
  const [confirmText, setConfirmText] = useState('Confirm');
  const [confirmCancel, setConfirmCancel] = useState(() => () => setShowConfirmDialog(false));
  const [showChatModal, setShowChatModal] = useState(false);
  const [showParticipantsModal, setShowParticipantsModal] = useState(false);
  const [showFilesModal, setShowFilesModal] = useState(false); 
  
  // --- 2. ADD NEW STATE FOR VISUALIZER ---
  const [showVisualizerModal, setShowVisualizerModal] = useState(false);
  const [visualizerTrace, setVisualizerTrace] = useState(null); // This will hold the JSON data
  const [isLoading, setIsLoading] = useState(false); // To show loading state


  // State for other project assets (e.g., images, PDFs) stored in Firebase Storage
  const [projectAssets, setProjectAssets] = useState([]);
  const [savedProjectNames, setSavedProjectNames] = useState([]); // New state for saved project names

  // UI Resizing States
  const [ioWidth, setIoWidth] = useState(400); // Width for the Input/Output column
  const [inputHeight, setInputHeight] = useState(window.innerHeight * 0.4); 
  const [outputHeight, setOutputHeight] = useState(window.innerHeight * 0.4);

  // Refs
  const editorRef = useRef(null);
  const messagesEndRef = useRef(null);

  const isResizingIO = useRef(false); // Ref for Editor/IO resizer
  const isResizingInputOutput = useRef(false);

  const inputAreaRef = useRef(null); // Ref for the IO column wrapper

  const code = files[activeFile]?.code || '';
  const language = files[activeFile]?.language || 'cpp';

  const languageMap = {
    javascript: 63, python: 71, cpp: 54, c: 50, java: 62,
  };

  // --- Firebase Storage File Deletion Function ---
  const deleteFileFromFirebaseStorage = useCallback(async (filePath) => {
    try {
      const fileRef = ref(storage, filePath);
      await deleteObject(fileRef);
      console.log(`File '${filePath}' deleted successfully from Firebase Storage.`);
      return true; // Indicate success
    } catch (error) {
      console.error(`Error deleting file '${filePath}' from Firebase Storage:`, error);
      alert(`Failed to delete file from storage: ${error.message}`); // Keep alert for critical errors
      return false; // Indicate failure
    }
  }, []);

  
  // --- Socket.IO Event Handlers ---
  const handleCodeUpdate = useCallback(({ file, code }) => {
    setFiles(prev => ({
      ...prev,
      [file]: { ...prev[file], code }
    }));
  }, []);

  const handleReceiveMessage = useCallback((message) => {
    setMessages(prevMessages => [...prevMessages, message]);
  }, []);

  const handleRoomUsersUpdate = useCallback((users) => {
    setRoomParticipants(users);
  }, []);


  // --- Socket.IO Room Joining and Listeners ---
  useEffect(() => {
    if (user && projectName) {
      const userDetails = {
        userId: user.uid,
        displayName: user.displayName || user.email || 'Anonymous',
      };
      socket.emit('join-room', { room: projectName, userDetails });
      setMessages([]);
      setRoomParticipants([]);
    }
  }, [user, projectName]);

  useEffect(() => {
    socket.on('code-update', handleCodeUpdate);
    socket.on('receive-message', handleReceiveMessage);
    socket.on('room-users-update', handleRoomUsersUpdate);
    
    return () => {
      socket.off('code-update', handleCodeUpdate);
      socket.off('receive-message', handleReceiveMessage);
      socket.off('room-users-update', handleRoomUsersUpdate);
    };
  }, [projectName, handleCodeUpdate, handleReceiveMessage, handleRoomUsersUpdate]);


  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, showChatModal]);


  // --- Other Handlers (Code, Chat, Files, Resizing) ---

  const handleEditorChange = (value) => {
    setFiles(prev => ({
      ...prev,
      [activeFile]: { ...prev[activeFile], code: value },
    }));
    socket.emit('code-change', {
      room: projectName,
      file: activeFile,
      code: value,
    });
  };

  // --- 3. THIS IS THE NEW VISUALIZER FUNCTION ---
  const openVisualizer = async () => {
    setIsLoading(true);
    setVisualizerTrace(null);
    setOutput("⏳ Generating visualization...");

    try {
      const response = await axios.post(
        `${process.env.REACT_APP_BACKEND_URL}/visualize`,   // ✅ FORCED BACKEND URL
        { language, code },
        {
          headers: {
            "Content-Type": "application/json"
          }
        }
      );

      if (response.data && response.data.trace) {
        setVisualizerTrace(response.data.trace);
        setShowVisualizerModal(true);
        setOutput("✅ Visualization ready.");
      } else {
        setOutput(`❌ Visualizer error: ${response.data.error || "Unknown"}`);
      }
    } catch (error) {
      console.error("Visualizer error:", error);
      setOutput(`❌ Failed to get visualization:\n${error.message}`);
    }

    setIsLoading(false);
  };


  const runCode = async () => {
    const languageId = languageMap[language];
    if (!languageId) {
      setOutput('❌ Language not supported.');
      return;
    }
    setOutput('⏳ Running...');
    setIsLoading(true); // Disable buttons
    try {
      const res = await axios.post(
        'https://judge0-ce.p.rapidapi.com/submissions?base64_encoded=false&wait=true',
        { source_code: code, language_id: languageId, stdin: userInput },
        {
          headers: {
            'content-type': 'application/json',
            'X-RapidAPI-Key': 'b088ae6529msh4ecd3e4c6df3993p15b81bjsnf482c1d556f5',
            'X-RapidAPI-Host': 'judge0-ce.p.rapidapi.com',
          },
        }
      );
      const result = res.data;
      setOutput(result.stdout || result.stderr || '✅ No output');
      if (result.stderr) {
        setOutput(`❌ Error:\n${result.stderr}`);
      }
    } catch (err) {
      console.error("Error running code:", err);
      if (err.response) {
        if (err.response.status === 401 || err.response.status === 403) {
          setOutput('❌ Failed to run code: Invalid or missing RapidAPI Key. Please check your key.');
        } else if (err.response.status === 429) {
          setOutput('❌ Failed to run code: Rate limit exceeded. Please wait and try again.');
        } else {
          setOutput(`❌ Failed to run code: Server responded with status ${err.response.status}. Check console for details.`);
        }
      } else if (err.request) {
        setOutput('❌ Failed to run code: No response from server. Check your network connection or API host.');
      } else {
        setOutput('❌ Failed to run code. An unexpected error occurred. Check console for details.');
      }
    }
    setIsLoading(false); // Re-enable buttons
  };

  const saveProject = async () => {
    if (!user) {
      alert("⚠️ Please log in to save your project.");
      return;
    }
    if (!projectName) {
      alert("⚠️ Please enter a project name before saving.");
      return;
    }
    try {
      const docRef = doc(db, 'userCodes', user.uid, 'projects', projectName);
      await setDoc(docRef, {
        files,
        createdAt: new Date().toISOString(),
      });
      alert(`✅ Project '${projectName}' saved successfully!`);
      fetchSavedProjects(); // Refresh the list of saved projects
    } catch (error) {
      console.error("Error saving project:", error);
      alert("❌ Failed to save project.");
    }
  };

  const loadProject = async () => {
    if (!user) {
      alert("⚠️ Please log in to load projects.");
      return;
    }
    try {
      const projectsRef = collection(db, 'userCodes', user.uid, 'projects');
      const snap = await getDocs(projectsRef);

      if (snap.empty) {
        alert("❌ No saved projects found for your account.");
        return;
      }

      const names = [];
      snap.forEach(doc => names.push(doc.id));

      setConfirmTitle('Load Project');
      setConfirmMessage(
        <div>
          <p>Choose a project to load:</p>
          <ul style={{ listStyleType: 'none', padding: 0, margin: 0, maxHeight: '250px', overflowY: 'auto', border: '1px solid #444', borderRadius: '5px', padding: '10px', backgroundColor: '#161b22' }}>
            {names.map((name) => (
              <li key={name} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '5px', borderBottom: '1px solid #30363d' }}>
                <span style={{ cursor: 'pointer', color: '#58a6ff' }} onClick={() => handleLoadProjectSelection(name)}>{name}</span>
                <button
                  onClick={(e) => { e.stopPropagation(); handleDeleteProjectClick(name); }}
                  style={{
                    backgroundColor: '#dc3545', color: 'white', border: 'none', borderRadius: '3px',
                    padding: '3px 7px', cursor: 'pointer', fontSize: '0.7em', transition: 'background-color 0.2s ease'
                  }}
                  onMouseEnter={(e) => e.target.style.backgroundColor = '#c82333'}
                  onMouseLeave={(e) => e.target.style.backgroundColor = '#dc3545'}
                >
                  Delete
                </button>
              </li>
            ))}
          </ul>
          <p style={{ marginTop: '10px', fontSize: '0.9em', color: '#8b949e' }}>Click on a project name to load it.</p>
        </div>
      );
      // This modal is just for display, the actions are inline
      setConfirmAction(() => () => setShowConfirmDialog(false));
      setConfirmCancel(null); // Hide cancel button
      setConfirmText('Close');
      setShowConfirmDialog(true);

    } catch (error) {
      console.error("Error loading project list:", error);
      alert("❌ Failed to load project list.");
    }
  };

  const handleLoadProjectSelection = async (selectedProjectName) => {
    setShowConfirmDialog(false); // Close the project list dialog
    try {
      setProjectName(selectedProjectName);
      const docRef = doc(db, 'userCodes', user.uid, 'projects', selectedProjectName);
      const data = (await getDoc(docRef)).data();

      if (data && data.files) {
        setFiles(data.files);
        const firstFileName = Object.keys(data.files)[0];
        if (firstFileName) {
          setActiveFile(firstFileName);
        } else {
          setFiles({ 'main.cpp': { code: '// Start coding...', language: 'cpp' } });
          setActiveFile('main.cpp');
          console.warn("Loaded project had no files, reverting to default 'main.cpp'.");
        }
        alert(`✅ Project '${selectedProjectName}' loaded successfully!`);
      } else {
        console.warn("❌ Failed to load project data or project has no files for selected project.");
      }
    } catch (error) {
      console.error("Error loading project:", error);
      alert("❌ Failed to load project.");
    }
  };

  // New function to handle deletion of a project from Firestore
  const deleteProjectFromFirestore = useCallback(async (projectNameToDelete) => {
    try {
      const projectDocRef = doc(db, 'userCodes', user.uid, 'projects', projectNameToDelete);
      await deleteDoc(projectDocRef);
      console.log(`Project '${projectNameToDelete}' deleted successfully from Firestore.`);
      alert(`✅ Project '${projectNameToDelete}' deleted successfully!`);
      fetchSavedProjects(); // Refresh the list of saved projects after deletion
      // If the deleted project was the active one, clear projectName
      if (projectName === projectNameToDelete) {
        setProjectName(null); // Go back to the "Enter Room" screen
      }
      return true;
    } catch (error) {
      console.error(`Error deleting project '${projectNameToDelete}' from Firestore:`, error);
      alert(`❌ Failed to delete project: ${error.message}`);
      return false;
    }
  }, [user, projectName, setProjectName]); // Added setProjectName dependency

  // This now uses the generic modal state
  const showModal = (title, message, onConfirm, confirmText = "Confirm", onCancel = () => setShowConfirmDialog(false)) => {
    setConfirmTitle(title);
    setConfirmMessage(message);
    setConfirmAction(() => onConfirm);
    setConfirmCancel(() => onCancel);
    setConfirmText(confirmText);
    setShowConfirmDialog(true);
  };

  // Handler for clicking delete button next to a project name in the load list
  const handleDeleteProjectClick = (nameToDelete) => {
    // This will open a *new* confirmation dialog over the load dialog
    showModal(
      'Delete Project',
      `Are you sure you want to delete the project '${nameToDelete}'? This will delete all its code files. This cannot be undone.`,
      async () => {
        const success = await deleteProjectFromFirestore(nameToDelete);
        if (success) {
          setShowConfirmDialog(false); // Close the delete confirmation
        }
      }
    );
  };


  const createNewFile = () => {
    const name = prompt("Enter new filename (e.g., script.js):");
    if (!name) return;
    if (files[name]) {
      alert(`❌ File '${name}' already exists.`);
      return;
    }
    const lang = prompt("Enter language for the new file (e.g., javascript, cpp, python):", 'javascript');

    const newFiles = {
      ...files,
      [name]: { code: '', language: lang.toLowerCase() },
    };
    setFiles(newFiles);
    setActiveFile(name);
  };

  // Handles deletion of code editor files (stored in Firestore)
  const deleteCodeFile = (name) => {
    if (Object.keys(files).length <= 1) {
      alert("❌ Cannot delete the last file. At least one file is required.");
      return;
    }

    showModal(
      'Delete Code File',
      `Are you sure you want to delete the code file '${name}'? This cannot be undone.`,
      async () => {
        const { [name]: _, ...rest } = files;
        setFiles(rest);
        if (activeFile === name) {
          const remainingFileNames = Object.keys(rest);
          if (remainingFileNames.length > 0) {
            setActiveFile(remainingFileNames[0]);
          } else {
            setFiles({ 'main.cpp': { code: '// Start coding...', language: 'cpp' } });
            setActiveFile('main.cpp');
          }
        }
        alert(`✅ Code file '${name}' deleted.`);
        setShowConfirmDialog(false);
      }
    );
  };

  // Handles deletion of other project assets (stored in Firebase Storage)
  const deleteProjectAsset = (asset) => {
    showModal(
      'Delete Project Asset',
      `Are you sure you want to delete the asset '${asset.name}' from storage? This cannot be undone.`,
      async () => {
        const success = await deleteFileFromFirebaseStorage(asset.path);
        if (success) {
          setProjectAssets(prev => prev.filter(a => a.path !== asset.path));
          alert(`✅ Asset '${asset.name}' deleted from storage.`);
        }
        setShowConfirmDialog(false);
      }
    );
  };

  // Function to upload a file to Firebase Storage
  const uploadProjectAsset = async (file) => {
    if (!user || !projectName) {
      alert("Please log in and select a project to upload assets.");
      return;
    }
    if (!file) {
      alert("No file selected for upload.");
      return;
    }

    const filePath = `users/${user.uid}/projects/${projectName}/assets/${file.name}`;
    const fileRef = ref(storage, filePath);

    try {
      await uploadBytes(fileRef, file);
      alert(`✅ File '${file.name}' uploaded successfully!`);
      // After successful upload, refresh the asset list
      fetchProjectAssets();
    } catch (error) {
      console.error("Error uploading file:", error);
      alert(`❌ Failed to upload file: ${error.message}`);
    }
  };

  // Function to fetch project assets from Storage
  const fetchProjectAssets = useCallback(async () => {
    if (user && projectName) {
      try {
        const assetsPath = `users/${user.uid}/projects/${projectName}/assets`;
        const assetsRef = ref(storage, assetsPath);

        const res = await listAll(assetsRef);
        const assetList = res.items.map(itemRef => ({
          name: itemRef.name, // The file name
          path: itemRef.fullPath, // The full path in storage
        }));
        setProjectAssets(assetList);
      } catch (error) {
        console.error("Error listing project assets:", error);
        setProjectAssets([]); // Clear assets on error
      }
    } else {
      setProjectAssets([]);
    }
  }, [user, projectName]); // Dependencies for useCallback

  // Effect to fetch project assets on component mount or project change
  useEffect(() => {
    fetchProjectAssets();
  }, [fetchProjectAssets]); // Depend on the memoized fetchProjectAssets

  // New function to fetch list of saved project names from Firestore
  const fetchSavedProjects = useCallback(async () => {
    if (user) {
      try {
        const projectsRef = collection(db, 'userCodes', user.uid, 'projects');
        const snap = await getDocs(projectsRef);
        const names = [];
        snap.forEach(doc => names.push(doc.id));
        setSavedProjectNames(names);
      } catch (error) {
        console.error("Error fetching saved project names:", error);
        setSavedProjectNames([]);
      }
    } else {
      setSavedProjectNames([]);
    }
  }, [user]);

  // Effect to fetch saved project names on user change
  useEffect(() => {
    fetchSavedProjects();
  }, [fetchSavedProjects]);


  const sendMessage = () => {
    if (chatInput.trim() === '') return;
    const message = {
      text: chatInput,
      sender: user.displayName || user.email || 'Anonymous',
      timestamp: new Date().toLocaleTimeString(),
      userId: user.uid,
    };
    socket.emit('send-message', { room: projectName, message });
    setChatInput('');
  };

  // --- Resizing Logic ---
  const startResizingIO = useCallback((e) => { isResizingIO.current = true; e.preventDefault(); }, []);
  const startResizingInputOutput = useCallback((e) => { isResizingInputOutput.current = true; e.preventDefault(); }, []);


  const onMouseMove = useCallback((e) => {
    if (!inputAreaRef.current) { return; }

    if (isResizingIO.current) {
      const newWidth = window.innerWidth - e.clientX;
      setIoWidth(Math.max(200, Math.min(newWidth, window.innerWidth - 200))); // 200 is min editor width
    } else if (isResizingInputOutput.current) {
      const ioColumnRect = inputAreaRef.current.getBoundingClientRect();
      const newHeaderHeight = e.clientY - ioColumnRect.top;
      const totalHeight = ioColumnRect.height - 40; // 40 for "Input (stdin)" header
      setInputHeight(Math.max(50, Math.min(newHeaderHeight, totalHeight - 50)));
      setOutputHeight(totalHeight - newHeaderHeight);
    }
  }, [ioWidth]); 

  const onMouseUp = useCallback(() => {
    isResizingIO.current = false;
    isResizingInputOutput.current = false;
  }, []);

  useEffect(() => {
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, [onMouseMove, onMouseUp]);


  // Render the "Enter Room / Project Name" screen if projectName is null or empty
  if (!projectName) {
    return (
      <div style={{ height: '100vh', backgroundColor: '#0d1117', color: '#c9d1d9', display: 'flex', justifyContent: 'center', alignItems: 'center', flexDirection: 'column' }}>
        <h2 style={{ marginBottom: '1rem' }}>👋 Welcome, {user.displayName}</h2>
        <input
          value={roomInput}
          onChange={(e) => setRoomInput(e.target.value)}
          placeholder="Enter Room / Project Name"
          style={{
            padding: '10px',
            borderRadius: '5px',
            border: '1px solid #444',
            backgroundColor: '#161b22',
            color: '#c9d1d9',
            marginBottom: '1rem',
            width: '300px',
          }}
        />
        <button
          onClick={() => {
            setProjectName(roomInput);
            setRoomInput('');
          }}
          disabled={!roomInput.trim()}
          style={{
            padding: '12px 24px',
            fontSize: '16px',
            backgroundColor: '#0366d6',
            color: '#fff',
            borderRadius: '6px',
            border: 'none',
            cursor: 'pointer',
            boxShadow: '0 4px 6px rgba(0, 0, 0, 0.1)',
            transition: 'background-color 0.3s ease',
          }}
          onMouseEnter={(e) => e.target.style.backgroundColor = '#005cc5'}
          onMouseLeave={(e) => e.target.style.backgroundColor = '#0366d6'}
        >
          🚀 Enter Editor
        </button>
        <p style={{ marginTop: '1rem', fontSize: '0.9rem', color: '#8b949e' }}>
          Your User ID: {user.uid}
        </p>
      </div>
    );
  }

  // --- 4. MODIFY RENDERHEADERBUTTON TO HANDLE LOADING ---
  const renderHeaderButton = (text, onClick, styleProps = {}) => (
    <button
      onClick={onClick}
      disabled={isLoading} // Disable button when loading
      style={{
        padding: '8px 12px',
        backgroundColor: '#0366d6',
        color: 'white',
        border: 'none',
        borderRadius: '5px',
        cursor: isLoading ? 'not-allowed' : 'pointer', // Change cursor when loading
        transition: 'background-color 0.2s ease, opacity 0.2s ease',
        opacity: isLoading ? 0.6 : 1, // Fade button when loading
        ...styleProps,
      }}
      onMouseEnter={(e) => { if (!isLoading) e.target.style.backgroundColor = styleProps.backgroundColor ? `${styleProps.backgroundColor}90` : '#005cc5'}}
      onMouseLeave={(e) => { if (!isLoading) e.target.style.backgroundColor = styleProps.backgroundColor || '#0366d6'}}
    >
      {text}
    </button>
  );

  // --- Helper function for chat modal content ---
  const renderChatContent = () => (
    <div style={{ display: 'flex', flexDirection: 'column', height: '60vh' }}>
      <div style={{ flexGrow: 1, overflowY: 'auto', backgroundColor: '#0d1117', borderRadius: '5px', padding: '10px', marginBottom: '10px', border: '1px solid #30363d' }}>
        {messages.map((msg, index) => (
          <React.Fragment key={index}>
            <div style={{ marginBottom: '8px', padding: '5px', borderRadius: '5px', backgroundColor: msg.userId === user.uid ? '#21262d' : '#161b22' }}>
              <strong style={{ color: msg.userId === user.uid ? '#2ea44f' : '#58a6ff' }}>{msg.sender}</strong>
              <span style={{ fontSize: '0.7em', color: '#8b949e', marginLeft: '10px' }}>{msg.timestamp}</span>
            </div>
            <p style={{ margin: 0, wordBreak: 'break-word', marginLeft: '5px', marginBottom: '8px' }}>{msg.text}</p>
          </React.Fragment>
        ))}
        <div ref={messagesEndRef} />
      </div>
      <div style={{ padding: '10px', borderTop: '1px solid #30363d', display: 'flex', alignItems: 'center', gap: '5px', flexShrink: 0 }}>
        <input
          type="text"
          value={chatInput}
          onChange={(e) => setChatInput(e.target.value)}
          onKeyPress={(e) => { if (e.key === 'Enter') sendMessage(); }}
          placeholder="Type your message..."
          style={{
            flexGrow: 1, padding: '8px', borderRadius: '5px', border: '1px solid #444',
            backgroundColor: '#0d1117', color: '#c9d1d9',
          }}
        />
        <button
          onClick={sendMessage}
          style={{
            padding: '8px 15px', backgroundColor: '#0366d6', color: 'white', border: 'none',
            borderRadius: '5px', cursor: 'pointer', transition: 'background-color 0.2s ease'
          }}
          onMouseEnter={(e) => e.target.style.backgroundColor = '#005cc5'}
          onMouseLeave={(e) => e.target.style.backgroundColor = '#0366d6'}
        >
          Send
        </button>
      </div>
    </div>
  );

  // --- Helper function for participants modal content ---
  const renderParticipantsContent = () => (
    <ul style={{ listStyleType: 'none', padding: 0, margin: 0 }}>
      {roomParticipants.map((p, index) => (
        <li key={index} style={{ color: '#c9d1d9', fontSize: '1.1em', padding: '5px 0' }}>
          {p.displayName} {p.socketId === socket.id ? '(You)' : ''}
        </li>
      ))}
    </ul>
  );

  // --- Helper function for File Explorer modal content ---
  const renderFileExplorerContent = () => (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '50vh' }}>
      <h3 style={{ marginTop: 0, marginBottom: '15px', color: '#58a6ff' }}>Code Files</h3>
      <div style={{ overflowY: 'auto', flexGrow: 1, minHeight: '150px' }}>
        {Object.keys(files).map((name) => (
          <div
            key={name}
            onClick={() => {
              setActiveFile(name);
              setShowFilesModal(false); // Close modal on file select
            }}
            style={{
              padding: '8px',
              cursor: 'pointer',
              backgroundColor: activeFile === name ? '#21262d' : 'transparent', // Highlight active file
              borderRadius: '5px',
              marginBottom: '5px',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              border: activeFile === name ? '1px solid #30363d' : '1px solid transparent',
              transition: 'background-color 0.2s ease',
            }}
            onMouseEnter={(e) => e.currentTarget.style.backgroundColor = activeFile === name ? '#21262d' : '#161b2250'}
            onMouseLeave={(e) => e.currentTarget.style.backgroundColor = activeFile === name ? '#21262d' : 'transparent'}
          >
            <span>{name}</span>
            <button
              onClick={(e) => { e.stopPropagation(); deleteCodeFile(name); }}
              style={{
                backgroundColor: '#da3633', color: 'white', border: 'none', borderRadius: '3px',
                padding: '3px 7px', cursor: 'pointer', fontSize: '0.7em', transition: 'background-color 0.2s ease',
              }}
              onMouseEnter={(e) => e.target.style.backgroundColor = '#bd2c00'}
              onMouseLeave={(e) => e.target.style.backgroundColor = '#da3633'}
            >
              X
            </button>
          </div>
        ))}
      </div>
      <button
        onClick={createNewFile}
        style={{
          marginTop: '10px', padding: '8px 12px', backgroundColor: '#2ea44f', color: 'white',
          border: 'none', borderRadius: '5px', cursor: 'pointer', transition: 'background-color 0.2s ease',
        }}
        onMouseEnter={(e) => e.target.style.backgroundColor = '#2c974b'}
        onMouseLeave={(e) => e.target.style.backgroundColor = '#2ea44f'}
      >
        + New Code File
      </button>

      {/* Project Assets Section (Files from Firebase Storage) */}
      <h3 style={{ marginTop: '20px', marginBottom: '15px', color: '#58a6ff' }}>Project Assets</h3>
      <div style={{ overflowY: 'auto', flexGrow: 1, minHeight: '150px' }}>
        {projectAssets.length === 0 ? (
          <p style={{ fontSize: '0.9em', color: '#8b949e' }}>No assets found.</p>
        ) : (
          projectAssets.map((asset) => (
            <div
              key={asset.path}
              style={{
                padding: '8px', backgroundColor: '#161b22', borderRadius: '5px',
                marginBottom: '5px', display: 'flex', justifyContent: 'space-between',
                alignItems: 'center', border: '1px solid #30363d',
              }}
            >
              <span style={{ fontSize: '0.9em' }}>{asset.name}</span>
              <button
                onClick={() => deleteProjectAsset(asset)}
                style={{
                  backgroundColor: '#da3633', color: 'white', border: 'none',
                  borderRadius: '3px', padding: '3px 7px', cursor: 'pointer',
                  fontSize: '0.7em', transition: 'background-color 0.2s ease',
                }}
                onMouseEnter={(e) => e.target.style.backgroundColor = '#bd2c00'}
                onMouseLeave={(e) => e.target.style.backgroundColor = '#da3633'}
              >
                Delete
              </button>
            </div>
          ))
        )}
        {/* Upload Asset Button */}
        <input
          type="file"
          id="asset-upload"
          style={{ display: 'none' }}
          onChange={(e) => {
            if (e.target.files[0]) {
              uploadProjectAsset(e.target.files[0]);
            }
          }}
        />
        <button
          onClick={() => document.getElementById('asset-upload').click()}
          style={{
            marginTop: '10px', padding: '8px 12px', backgroundColor: '#007bff',
            color: 'white', border: 'none', borderRadius: '5px', cursor: 'pointer',
            transition: 'background-color 0.2s ease',
          }}
          onMouseEnter={(e) => e.target.style.backgroundColor = '#0056b3'}
          onMouseLeave={(e) => e.target.style.backgroundColor = '#007bff'}
        >
          ⬆️ Upload Asset
        </button>
      </div>
    </div>
  );

  // --- Main editor UI (Refactored) ---
  return (
    <div style={{ display: 'flex', height: 'calc(100vh - 60px)', backgroundColor: '#0d1117', color: '#c9d1d9', overflow: 'hidden' }}>
      
      {/* --- Editor Area (Column 1) --- */}
      <div className="editor-area" style={{ flexGrow: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <div style={{ padding: '10px 20px', backgroundColor: '#1e1e1e', borderBottom: '1px solid #30363d', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0, gap: '10px' }}>
          <h3 style={{ margin: 0, color: '#c9d1d9', whiteSpace: 'nowrap' }}>Project: {projectName}</h3>
          <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
            {renderHeaderButton('📁 Project Files', () => setShowFilesModal(true))}
            {renderHeaderButton(isLoading && !visualizerTrace ? 'Running...' : '▶️ Run Code', runCode, { backgroundColor: '#2ea44f' })}
            {renderHeaderButton(isLoading && visualizerTrace ? 'Visualizing...' : '👁️ Visualize', openVisualizer, { backgroundColor: '#17a2b8' })}
            {renderHeaderButton('💾 Save', saveProject, { backgroundColor: '#007bff' })}
            {renderHeaderButton('📂 Load', loadProject, { backgroundColor: '#8957e5' })}
            {renderHeaderButton('💬 Chat', () => setShowChatModal(true))}
            {renderHeaderButton('👥 Participants', () => setShowParticipantsModal(true))}
          </div>
        </div>

        {/* Monaco Editor */}
        <div style={{ flexGrow: 1, height: '100%', overflow: 'hidden' }}>
          <Editor
            height="100%"
            language={language}
            theme="vs-dark"
            value={code}
            onChange={handleEditorChange}
            onMount={(editor) => (editorRef.current = editor)}
            options={{
              minimap: { enabled: false },
              fontSize: 14,
              wordWrap: 'on',
              scrollBeyondLastLine: false,
            }}
          />
        </div>
      </div>

      {/* --- Resizer for Editor/IO --- */}
      <div
        onMouseDown={startResizingIO}
        style={{
          width: '5px',
          cursor: 'col-resize',
          backgroundColor: '#30363d',
          flexShrink: 0,
        }}
      />

      {/* --- Input and Output Area (Column 2) --- */}
      <div ref={inputAreaRef} style={{ width: ioWidth, display: 'flex', flexDirection: 'column', flexShrink: 0, backgroundColor: '#1e1e1e', borderLeft: '1px solid #30363d' }}>
        {/* Input Section */}
        <div style={{ height: inputHeight, display: 'flex', flexDirection: 'column', padding: '10px', borderBottom: '1px solid #30363d', overflow: 'hidden' }}>
          <h3 style={{ margin: '0 0 10px 0', color: '#c9d1d9', flexShrink: 0 }}>Input (stdin)</h3>
          <textarea
            value={userInput}
            onChange={(e) => setUserInput(e.target.value)}
            placeholder="Enter input for your code here..."
            style={{
              flexGrow: 1, padding: '8px', borderRadius: '5px', border: '1px solid #444',
              backgroundColor: '#0d1117', color: '#c9d1d9', resize: 'none', width: 'auto'
            }}
          />
        </div>

        {/* Resizer for Input/Output */}
        <div
          onMouseDown={startResizingInputOutput}
          style={{
            height: '5px',
            cursor: 'row-resize',
            backgroundColor: '#30363d',
            flexShrink: 0,
          }}
        />

        {/* Output Section */}
        <div style={{ display: 'flex', flexDirection: 'column', padding: '10px', flexGrow: 1, minHeight: '50px', overflow: 'hidden' }}>
          <h3 style={{ margin: '0 0 10px 0', color: '#c9d1d9', flexShrink: 0 }}>Output (stdout/stderr)</h3>
          <pre style={{ flexGrow: 1, padding: '8px', borderRadius: '5px', border: '1px solid #444', backgroundColor: '#0d1117', color: '#c9d1d9', overflow: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
            {output}
          </pre>
        </div>
      </div>


      {/* --- Modals Section --- */}

      {/* Custom Confirmation Dialog */}
      {showConfirmDialog && (
        <ModalDialog
          title={confirmTitle}
          message={confirmMessage}
          onConfirm={confirmAction}
          onCancel={confirmCancel}
          confirmText={confirmText}
        />
      )}

      {/* File Explorer Modal */}
      {showFilesModal && (
        <ModalDialog
          title="Project Explorer"
          message={renderFileExplorerContent()}
          onConfirm={() => setShowFilesModal(false)}
          confirmText="Close"
        />
      )}

      {/* Chat Modal */}
      {showChatModal && (
        <ModalDialog
          title="Room Chat"
          message={renderChatContent()}
          onConfirm={() => setShowChatModal(false)}
          confirmText="Close"
        />
      )}

      {/* Participants Modal */}
      {showParticipantsModal && (
        <ModalDialog
          title="Participants"
          message={renderParticipantsContent()}
          onConfirm={() => setShowParticipantsModal(false)}
          confirmText="Close"
        />
      )}

      {/* --- 6. ADD THE NEW VISUALIZER MODAL --- */}
      {showVisualizerModal && (
        <ModalDialog
          title="Code Visualizer"
          message={
            <CodeVisualizerModal 
              trace={visualizerTrace} 
              code={code}
              language={language}
              onClose={() => setShowVisualizerModal(false)} 
            />
          }
          onConfirm={() => {
            setShowVisualizerModal(false);
            setVisualizerTrace(null); // Clear the trace data
          }}
          confirmText="Close"
        />
      )}
    </div>
  );
}