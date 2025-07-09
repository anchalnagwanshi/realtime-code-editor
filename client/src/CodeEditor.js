import React, { useEffect, useRef, useState, useCallback } from 'react';
import { io } from 'socket.io-client';
import Editor from '@monaco-editor/react';
import axios from 'axios';
import { db, storage } from './firebase'; // Import storage
import { collection, doc, setDoc, getDoc, getDocs, deleteDoc } from "firebase/firestore"; // Import deleteDoc
import { ref, deleteObject, listAll, uploadBytes } from "firebase/storage"; // Import Storage functions like listAll, uploadBytes

// Initialize Socket.IO client, connecting to your backend server
const socket = io(process.env.REACT_APP_SOCKET_SERVER_URL || 'http://localhost:3001');

// Define STUN servers for NAT traversal. These are public, free STUN servers.
const iceServers = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
  ],
};

// Custom Confirmation Dialog Component
const ConfirmationDialog = ({ message, onConfirm, onCancel }) => {
  return (
    <div style={{
      position: 'fixed', top: '0', left: '0', right: '0', bottom: '0',
      backgroundColor: 'rgba(0,0,0,0.7)', display: 'flex', justifyContent: 'center', alignItems: 'center',
      zIndex: 1000
    }}>
      <div style={{ backgroundColor: '#282c34', padding: '20px', borderRadius: '8px', boxShadow: '0 4px 8px rgba(0,0,0,0.2)', maxWidth: '400px', textAlign: 'center' }}>
        <p style={{ marginBottom: '20px', fontSize: '1.1em', color: '#c9d1d9' }}>{message}</p>
        <div style={{ display: 'flex', justifyContent: 'center', gap: '15px' }}>
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
          <button
            onClick={onConfirm}
            style={{
              padding: '10px 20px', backgroundColor: '#dc3545', color: 'white', border: 'none',
              borderRadius: '5px', cursor: 'pointer', transition: 'background-color 0.2s ease'
            }}
            onMouseEnter={(e) => e.target.style.backgroundColor = '#c82333'}
            onMouseLeave={(e) => e.target.style.backgroundColor = '#dc3545'}
          >
            Confirm
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
  // roomParticipants should ideally store objects with { socketId, displayName, isAvailableForCall }
  const [roomParticipants, setRoomParticipants] = useState([]);

  // WebRTC States
  const [localStream, setLocalStream] = useState(null);
  const peerConnections = useRef({}); // map of socketId => RTCPeerConnection
  const remoteStreams = useRef({});    // map of socketId => MediaStream
  const [remoteStreamIds, setRemoteStreamIds] = useState([]); // just for rendering video tiles
  const [isCalling, setIsCalling] = useState(false); // True if user has initiated a call
  const [incomingCall, setIncomingCall] = useState(null); // Stores { callerId, callerDisplayName }
  const [callStatus, setCallStatus] = useState('idle'); // 'idle', 'calling', 'receiving', 'connected'

  // File Deletion States for Confirmation Dialog
  const [showConfirmDialog, setShowConfirmDialog] = useState(false);
  const [confirmMessage, setConfirmMessage] = useState('');
  const [confirmAction, setConfirmAction] = useState(() => () => {}); // Function to execute on confirm

  // State for other project assets (e.g., images, PDFs) stored in Firebase Storage
  const [projectAssets, setProjectAssets] = useState([]);
  const [savedProjectNames, setSavedProjectNames] = useState([]); // New state for saved project names

  // UI Resizing States
  const [fileExplorerWidth, setFileExplorerWidth] = useState(200);
  const [chatWidth, setChatWidth] = useState(300);
  const [editorHeight, setEditorHeight] = useState(window.innerHeight * 0.5);
  const [inputHeight, setInputHeight] = useState(100);
  const [outputHeight, setOutputHeight] = useState(100);

  // Refs
  const editorRef = useRef(null);
  const messagesEndRef = useRef(null);

  const isResizingFileExplorer = useRef(false);
  const isResizingChat = useRef(false);
  const isResizingEditorInput = useRef(false);
  const isResizingInputOutput = useRef(false);

  const mainContentAreaRef = useRef(null);
  const inputAreaRef = useRef(null);

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

  // --- WebRTC Call Functions ---

  const endCall = useCallback(() => {
    // Stop local tracks
    if (localStream) {
      localStream.getTracks().forEach(track => track.stop());
      setLocalStream(null);
    }

    // Close all peer connections
    for (const socketId in peerConnections.current) {
      if (peerConnections.current[socketId]) {
        peerConnections.current[socketId].close();
        delete peerConnections.current[socketId];
      }
    }
    // Clear remote streams and their IDs
    remoteStreams.current = {};
    setRemoteStreamIds([]);

    setIsCalling(false);
    setIncomingCall(null);
    setCallStatus('idle');

    // Notify server that call is ended for this user
    socket.emit('call-ended', { room: projectName });
    console.log('Call ended.');
  }, [localStream, projectName]);

  const createPeerConnection = useCallback((remoteSocketId) => {
    const pc = new RTCPeerConnection(iceServers);

    peerConnections.current[remoteSocketId] = pc;

    if (localStream) {
      localStream.getTracks().forEach(track => pc.addTrack(track, localStream));
    }

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        socket.emit('webrtc-ice-candidate', {
          room: projectName,
          candidate: event.candidate,
          targetSocketId: remoteSocketId,
          senderSocketId: socket.id,
        });
      }
    };

    pc.ontrack = (event) => {
      if (!remoteStreams.current[remoteSocketId]) {
        remoteStreams.current[remoteSocketId] = new MediaStream();
      }
      // Add tracks to the remote stream
      event.streams[0].getTracks().forEach(track => {
        remoteStreams.current[remoteSocketId].addTrack(track);
      });
      setRemoteStreamIds(prev => {
        // Ensure unique IDs and trigger re-render
        const newSet = new Set([...prev, remoteSocketId]);
        return Array.from(newSet);
      });
    };

    pc.onconnectionstatechange = () => {
      console.log(`PC with ${remoteSocketId} connection state: ${pc.connectionState}`);
      if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed' || pc.connectionState === 'closed') {
        console.log(`Peer ${remoteSocketId} disconnected or failed. Removing stream.`);
        if (peerConnections.current[remoteSocketId]) {
          peerConnections.current[remoteSocketId].close();
          delete peerConnections.current[remoteSocketId];
        }
        if (remoteStreams.current[remoteSocketId]) {
          delete remoteStreams.current[remoteSocketId];
        }
        setRemoteStreamIds(prev => prev.filter(id => id !== remoteSocketId));
        // If this was the only connected peer, end the call
        if (Object.keys(peerConnections.current).length === 0 && callStatus === 'connected') {
          endCall();
        }
      } else if (pc.connectionState === 'connected') {
        setCallStatus('connected'); // If any peer is connected, set status to connected
      }
    };

    return pc;
  }, [localStream, projectName, endCall, callStatus]);


  // --- Start Call (call all peers in the room) ---
  const startCall = async () => {
    if (callStatus !== 'idle') {
      alert("A call is already in progress or being received.");
      return;
    }
    setIsCalling(true);
    setCallStatus('calling');

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      setLocalStream(stream);

      // Emit call request to the server. The server will notify available peers.
      socket.emit('call-request', {
        room: projectName,
        callerId: socket.id,
        callerDisplayName: user.displayName || user.email || 'Anonymous',
      });

      // Optionally, create offers to existing available peers known locally
      for (const participant of roomParticipants) {
        if (participant.socketId !== socket.id && participant.isAvailableForCall) {
          const pc = createPeerConnection(participant.socketId);
          const offer = await pc.createOffer();
          await pc.setLocalDescription(offer);
          socket.emit('webrtc-offer', {
            room: projectName,
            offer: pc.localDescription,
            targetSocketId: participant.socketId,
            senderSocketId: socket.id,
          });
        }
      }

    } catch (error) {
      console.error('Error starting call:', error);
      alert('Failed to start call: Please ensure microphone and camera permissions are granted.');
      setIsCalling(false);
      setCallStatus('idle');
    }
  };

  const acceptCall = useCallback(async () => {
    if (!incomingCall) return;

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      setLocalStream(stream);

      // Retrieve the PC created when the offer was received
      const pc = peerConnections.current[incomingCall.callerId];
      if (!pc) {
        console.error('PeerConnection not found for incoming call. Re-creating.');
        const newPc = createPeerConnection(incomingCall.callerId);
        stream.getTracks().forEach(track => newPc.addTrack(track, stream));
      } else {
        stream.getTracks().forEach(track => pc.addTrack(track, stream));
      }

      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      socket.emit('webrtc-answer', {
        room: projectName,
        answer: pc.localDescription,
        targetSocketId: incomingCall.callerId,
        senderSocketId: socket.id,
      });

      setCallStatus('connected');
      setIncomingCall(null);
      socket.emit('call-accepted', {
        room: projectName,
        callerSocketId: incomingCall.callerId,
        calleeSocketId: socket.id,
      });

    } catch (error) {
      console.error('Error accepting call:', error);
      alert('Failed to accept call.');
      endCall();
    }
  }, [incomingCall, projectName, createPeerConnection, endCall]);

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
    // Assuming 'users' is now an array of objects: [{ socketId, displayName, isAvailableForCall }]
    setRoomParticipants(users);
  }, []);

  const handleIncomingCall = useCallback(({ callerId, callerDisplayName }) => {
    // Only process incoming call if currently idle
    if (callStatus === 'idle') {
      setIncomingCall({ callerId, callerDisplayName });
      setCallStatus('receiving');
      alert(`Incoming call from ${callerDisplayName}!`);
      // Create peer connection immediately to prepare for the offer
      createPeerConnection(callerId);
    } else {
      console.log(`Busy: Ignoring incoming call from ${callerDisplayName}`);
      // Send a 'busy' signal back to the caller
      socket.emit('call-busy', { targetSocketId: callerId, room: projectName });
    }
  }, [callStatus, projectName, createPeerConnection]);

  const handleWebRTCOffer = useCallback(async ({ offer, senderSocketId }) => {
    console.log('Received WebRTC Offer from:', senderSocketId);

    const pc = peerConnections.current[senderSocketId] || createPeerConnection(senderSocketId);

    try {
      await pc.setRemoteDescription(new RTCSessionDescription(offer));
      // If we are currently "receiving" a call, the acceptCall function will create the answer.
      // This block might be needed for multi-peer offers or re-negotiations.
      // For a simple client receiving an initial offer, `acceptCall` will handle the answer.
    } catch (error) {
      console.error('Error handling offer:', error);
      if (pc) {
          pc.close();
          delete peerConnections.current[senderSocketId];
      }
    }
  }, [projectName, createPeerConnection]);

  const handleWebRTCAnswer = useCallback(async ({ answer, senderSocketId }) => {
    console.log('Received WebRTC Answer from:', senderSocketId);
    const pc = peerConnections.current[senderSocketId];
    if (pc && pc.signalingState !== 'stable') {
      try {
        await pc.setRemoteDescription(new RTCSessionDescription(answer));
        setCallStatus('connected'); // Set overall call status to connected if at least one peer is connected
      } catch (error) {
        console.error('Error handling answer:', error);
      }
    }
  }, []);

  const handleWebRTCICECandidate = useCallback(async ({ candidate, senderSocketId }) => {
    const pc = peerConnections.current[senderSocketId];
    if (pc && candidate) {
      try {
        await pc.addIceCandidate(new RTCIceCandidate(candidate));
      } catch (error) {
        console.error('Error adding received ICE candidate:', error);
      }
    }
  }, []);

  const handleCallEstablished = useCallback(({ remoteSocketId }) => {
    console.log('Call established with:', remoteSocketId);
    setCallStatus('connected');
    setIncomingCall(null);
    setIsCalling(false);
  }, []);

  const handleCallEnded = useCallback(() => {
    console.log('Call ended by remote peer.');
    endCall();
  }, [endCall]);

  const handleCallEndedByDisconnect = useCallback(({ disconnectedSocketId }) => {
    console.log(`Partner ${disconnectedSocketId} disconnected, ending call for that peer.`);
    if (peerConnections.current[disconnectedSocketId]) {
      peerConnections.current[disconnectedSocketId].close();
      delete peerConnections.current[disconnectedSocketId];
    }
    if (remoteStreams.current[disconnectedSocketId]) {
      delete remoteStreams.current[disconnectedSocketId];
    }
    setRemoteStreamIds(prev => prev.filter(id => id !== disconnectedSocketId));

    if (Object.keys(peerConnections.current).length === 0) {
      endCall();
      alert('Your call partner disconnected.');
    }
  }, [endCall]);


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
    socket.on('incoming-call', handleIncomingCall);
    socket.on('webrtc-offer', handleWebRTCOffer);
    socket.on('webrtc-answer', handleWebRTCAnswer);
    socket.on('webrtc-ice-candidate', handleWebRTCICECandidate);
    socket.on('call-established', handleCallEstablished);
    socket.on('call-ended', handleCallEnded);
    socket.on('call-ended-by-disconnect', handleCallEndedByDisconnect);

    return () => {
      socket.off('code-update', handleCodeUpdate);
      socket.off('receive-message', handleReceiveMessage);
      socket.off('room-users-update', handleRoomUsersUpdate);
      socket.off('incoming-call', handleIncomingCall);
      socket.off('webrtc-offer', handleWebRTCOffer);
      socket.off('webrtc-answer', handleWebRTCAnswer);
      socket.off('webrtc-ice-candidate', handleWebRTCICECandidate);
      socket.off('call-established', handleCallEstablished);
      socket.off('call-ended', handleCallEnded);
      socket.off('call-ended-by-disconnect', handleCallEndedByDisconnect);
      endCall();
    };
  }, [projectName, endCall, handleCodeUpdate, handleReceiveMessage, handleRoomUsersUpdate,
    handleIncomingCall, handleWebRTCOffer, handleWebRTCAnswer, handleWebRTCICECandidate,
    handleCallEstablished, handleCallEnded, handleCallEndedByDisconnect]);


  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);


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

  const runCode = async () => {
    const languageId = languageMap[language];
    if (!languageId) {
      setOutput('❌ Language not supported.');
      return;
    }
    setOutput('⏳ Running...');
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

      setConfirmMessage(
        <div>
          <p>Choose a project to load:</p>
          <ul style={{ listStyleType: 'none', padding: 0, margin: 0, maxHeight: '150px', overflowY: 'auto', border: '1px solid #444', borderRadius: '5px', padding: '10px', backgroundColor: '#161b22' }}>
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
      setConfirmAction(() => () => setShowConfirmDialog(false)); // Close dialog if no selection is made via buttons
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
  }, [user, projectName]);

  // Handler for clicking delete button next to a project name in the load list
  const handleDeleteProjectClick = (nameToDelete) => {
    setConfirmMessage(`Are you sure you want to delete the project '${nameToDelete}'? This will delete all its code files. This cannot be undone.`);
    setConfirmAction(() => async () => {
      const success = await deleteProjectFromFirestore(nameToDelete);
      if (success) {
        // No need to filter savedProjectNames here, fetchSavedProjects will refresh
      }
      setShowConfirmDialog(false);
    });
    setShowConfirmDialog(true);
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

    setConfirmMessage(`Are you sure you want to delete the code file '${name}'? This cannot be undone.`);
    setConfirmAction(() => async () => {
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
    });
    setShowConfirmDialog(true);
  };

  // Handles deletion of other project assets (stored in Firebase Storage)
  const deleteProjectAsset = (asset) => {
    setConfirmMessage(`Are you sure you want to delete the asset '${asset.name}' from storage? This cannot be undone.`);
    setConfirmAction(() => async () => {
      const success = await deleteFileFromFirebaseStorage(asset.path);
      if (success) {
        setProjectAssets(prev => prev.filter(a => a.path !== asset.path));
        alert(`✅ Asset '${asset.name}' deleted from storage.`);
      }
      setShowConfirmDialog(false);
    });
    setShowConfirmDialog(true);
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
  const startResizingFileExplorer = useCallback((e) => { isResizingFileExplorer.current = true; e.preventDefault(); }, []);
  const startResizingChat = useCallback((e) => { isResizingChat.current = true; e.preventDefault(); }, []);
  const startResizingEditorInput = useCallback((e) => { isResizingEditorInput.current = true; e.preventDefault(); }, []);
  const startResizingInputOutput = useCallback((e) => { isResizingInputOutput.current = true; e.preventDefault(); }, []);


  const onMouseMove = useCallback((e) => {
    if (!mainContentAreaRef.current || !inputAreaRef.current) { return; }
    if (isResizingFileExplorer.current) {
      const newWidth = e.clientX;
      setFileExplorerWidth(Math.max(100, Math.min(newWidth, window.innerWidth - chatWidth - 200)));
    } else if (isResizingChat.current) {
      const newWidth = window.innerWidth - e.clientX;
      setChatWidth(Math.max(200, Math.min(newWidth, window.innerWidth - fileExplorerWidth - 200)));
    } else if (isResizingEditorInput.current) {
      const mainContentRect = mainContentAreaRef.current.getBoundingClientRect();
      const newEditorHeight = e.clientY - mainContentRect.top - 60; // 60 for header height
      setEditorHeight(Math.max(100, newEditorHeight));
    } else if (isResizingInputOutput.current) {
      const inputRect = inputAreaRef.current.getBoundingClientRect();
      const deltaY = e.clientY - inputRect.bottom;
      setInputHeight(prev => Math.max(50, prev + deltaY));
      setOutputHeight(prev => Math.max(50, prev - deltaY));
    }
  }, [fileExplorerWidth, chatWidth]);

  const onMouseUp = useCallback(() => {
    isResizingFileExplorer.current = false;
    isResizingChat.current = false;
    isResizingEditorInput.current = false;
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


  // Inline VideoTiles component or render directly
  const VideoTiles = ({ localStream, remoteStreamIds }) => {
    return (
      <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: '10px' }}>
        {/* Local Video */}
        {localStream && (
          <video
            key="local"
            autoPlay
            muted
            playsInline
            ref={el => { if (el) el.srcObject = localStream; }}
            style={{ width: '160px', height: '120px', borderRadius: '8px', border: '2px solid #58a6ff' }}
          />
        )}

        {/* Remote Videos */}
        {remoteStreamIds.map(socketId => (
          <video
            key={socketId}
            autoPlay
            playsInline
            ref={el => {
              if (el) el.srcObject = remoteStreams.current[socketId];
            }}
            style={{ width: '240px', height: '180px', borderRadius: '8px', border: '2px solid #2ea44f' }}
          />
        ))}
      </div>
    );
  };


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

  // Main editor UI
  return (
    <div style={{ display: 'flex', height: 'calc(100vh - 60px)', backgroundColor: '#0d1117', color: '#c9d1d9', overflow: 'hidden' }}>
      {/* File Explorer / Sidebar */}
      <div style={{ width: fileExplorerWidth, borderRight: '1px solid #30363d', padding: '10px', display: 'flex', flexDirection: 'column', flexShrink: 0 }}>
        <h3 style={{ marginTop: 0, marginBottom: '15px', color: '#58a6ff' }}>Code Files</h3>
        <div style={{ overflowY: 'auto', flexGrow: 1 }}>
          {Object.keys(files).map((name) => (
            <div
              key={name}
              onClick={() => setActiveFile(name)}
              style={{
                padding: '8px',
                cursor: 'pointer',
                backgroundColor: activeFile === name ? '#161b22' : 'transparent',
                borderRadius: '5px',
                marginBottom: '5px',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                border: activeFile === name ? '1px solid #30363d' : '1px solid transparent',
                transition: 'background-color 0.2s ease',
              }}
              onMouseEnter={(e) => e.currentTarget.style.backgroundColor = activeFile === name ? '#161b22' : '#161b2250'}
              onMouseLeave={(e) => e.currentTarget.style.backgroundColor = activeFile === name ? '#161b22' : 'transparent'}
            >
              <span>{name}</span>
              <button
                onClick={(e) => { e.stopPropagation(); deleteCodeFile(name); }} // Use deleteCodeFile
                style={{
                  backgroundColor: '#da3633',
                  color: 'white',
                  border: 'none',
                  borderRadius: '3px',
                  padding: '3px 7px',
                  cursor: 'pointer',
                  fontSize: '0.7em',
                  transition: 'background-color 0.2s ease',
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
            marginTop: '10px',
            padding: '8px 12px',
            backgroundColor: '#2ea44f',
            color: 'white',
            border: 'none',
            borderRadius: '5px',
            cursor: 'pointer',
            transition: 'background-color 0.2s ease',
          }}
          onMouseEnter={(e) => e.target.style.backgroundColor = '#2c974b'}
          onMouseLeave={(e) => e.target.style.backgroundColor = '#2ea44f'}
        >
          + New Code File
        </button>

        {/* Project Assets Section (Files from Firebase Storage) */}
        <h3 style={{ marginTop: '20px', marginBottom: '15px', color: '#58a6ff' }}>Project Assets</h3>
        <div style={{ overflowY: 'auto', flexGrow: 1 }}>
          {projectAssets.length === 0 ? (
            <p style={{ fontSize: '0.9em', color: '#8b949e' }}>No assets found.</p>
          ) : (
            projectAssets.map((asset) => (
              <div
                key={asset.path}
                style={{
                  padding: '8px',
                  backgroundColor: '#161b22',
                  borderRadius: '5px',
                  marginBottom: '5px',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  border: '1px solid #30363d',
                }}
              >
                <span style={{ fontSize: '0.9em' }}>{asset.name}</span>
                <button
                  onClick={() => deleteProjectAsset(asset)} // Use deleteProjectAsset
                  style={{
                    backgroundColor: '#da3633',
                    color: 'white',
                    border: 'none',
                    borderRadius: '3px',
                    padding: '3px 7px',
                    cursor: 'pointer',
                    fontSize: '0.7em',
                    transition: 'background-color 0.2s ease',
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
              marginTop: '10px',
              padding: '8px 12px',
              backgroundColor: '#007bff',
              color: 'white',
              border: 'none',
              borderRadius: '5px',
              cursor: 'pointer',
              transition: 'background-color 0.2s ease',
            }}
            onMouseEnter={(e) => e.target.style.backgroundColor = '#0056b3'}
            onMouseLeave={(e) => e.target.style.backgroundColor = '#007bff'}
          >
            ⬆️ Upload Asset
          </button>
        </div>
      </div>

      {/* Resizer for File Explorer */}
      <div
        onMouseDown={startResizingFileExplorer}
        style={{
          width: '5px',
          cursor: 'col-resize',
          backgroundColor: '#30363d',
          flexShrink: 0,
        }}
      />

      {/* Editor and Output Area */}
      <div className="main-content-area" ref={mainContentAreaRef} style={{ flexGrow: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <div style={{ padding: '10px 20px', backgroundColor: '#1e1e1e', borderBottom: '1px solid #30363d', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0 }}>
          <h3 style={{ margin: 0, color: '#c9d1d9' }}>Project: {projectName}</h3>
          <span style={{ fontSize: '0.9em', color: '#8b949e' }}>
            Current User: {user.displayName || user.email} (ID: {user.uid})
          </span>
        </div>

        {/* WebRTC Video Section - Using the VideoTiles component */}
        {callStatus !== 'idle' || isCalling || incomingCall ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', padding: '10px', backgroundColor: '#21262d', borderBottom: '1px solid #30363d', justifyContent: 'center', alignItems: 'center' }}>
            <VideoTiles localStream={localStream} remoteStreamIds={remoteStreamIds} />
            {callStatus === 'calling' && !Object.keys(peerConnections.current).length && <p style={{ color: '#8b949e' }}>Calling...</p>}
            {callStatus === 'receiving' && incomingCall && (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '5px' }}>
                <p style={{ margin: 0, color: '#c9d1d9' }}>Incoming call from {incomingCall.callerDisplayName}</p>
                <button onClick={acceptCall} style={{ padding: '8px 15px', backgroundColor: '#28a745', color: 'white', border: 'none', borderRadius: '5px', cursor: 'pointer' }}>Accept</button>
              </div>
            )}
            {(callStatus === 'connected' || Object.keys(peerConnections.current).length > 0) && (
              <button onClick={endCall} style={{ padding: '8px 15px', backgroundColor: '#dc3545', color: 'white', border: 'none', borderRadius: '5px', cursor: 'pointer' }}>End Call</button>
            )}
          </div>
        ) : (
          <div style={{ padding: '10px', backgroundColor: '#1e1e1e', borderBottom: '1px solid #30363d', display: 'flex', justifyContent: 'center' }}>
            <button onClick={startCall} style={{ padding: '8px 15px', backgroundColor: '#007bff', color: 'white', border: 'none', borderRadius: '5px', cursor: 'pointer' }}>Start Call</button>
          </div>
        )}

        {/* Monaco Editor */}
        <div style={{ height: editorHeight, flexShrink: 0 }}>
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

        {/* Resizer for Editor/Input */}
        <div
          onMouseDown={startResizingEditorInput}
          style={{
            height: '5px',
            cursor: 'row-resize',
            backgroundColor: '#30363d',
            flexShrink: 0,
          }}
        />

        {/* Input and Output Area */}
        <div ref={inputAreaRef} style={{ display: 'flex', flexDirection: 'column', flexGrow: 1, minHeight: '100px' }}>
          {/* Input Section */}
          <div style={{ height: inputHeight, display: 'flex', flexDirection: 'column', padding: '10px', borderBottom: '1px solid #30363d', backgroundColor: '#1e1e1e', flexShrink: 0 }}>
            <h3 style={{ margin: '0 0 10px 0', color: '#c9d1d9' }}>Input (stdin)</h3>
            <textarea
              value={userInput}
              onChange={(e) => setUserInput(e.target.value)}
              placeholder="Enter input for your code here..."
              style={{
                flexGrow: 1, padding: '8px', borderRadius: '5px', border: '1px solid #444',
                backgroundColor: '#0d1117', color: '#c9d1d9', resize: 'none'
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
          <div style={{ height: outputHeight, display: 'flex', flexDirection: 'column', padding: '10px', backgroundColor: '#1e1e1e', flexGrow: 1, minHeight: '50px' }}>
            <h3 style={{ margin: '0 0 10px 0', color: '#c9d1d9' }}>Output (stdout/stderr)</h3>
            <pre style={{ flexGrow: 1, padding: '8px', borderRadius: '5px', border: '1px solid #444', backgroundColor: '#0d1117', color: '#c9d1d9', overflow: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
              {output}
            </pre>
            <button
              onClick={runCode}
              style={{
                marginTop: '10px', padding: '10px 20px', backgroundColor: '#0366d6', color: 'white',
                border: 'none', borderRadius: '5px', cursor: 'pointer', transition: 'background-color 0.2s ease'
              }}
              onMouseEnter={(e) => e.target.style.backgroundColor = '#005cc5'}
              onMouseLeave={(e) => e.target.style.backgroundColor = '#0366d6'}
            >
              ▶️ Run Code
            </button>
          </div>
        </div>
      </div>

      {/* Resizer for Chat */}
      <div
        onMouseDown={startResizingChat}
        style={{
          width: '5px',
          cursor: 'col-resize',
          backgroundColor: '#30363d',
          flexShrink: 0,
        }}
      />

      {/* Chat and Controls Area */}
      <div style={{ width: chatWidth, borderLeft: '1px solid #30363d', padding: '10px', display: 'flex', flexDirection: 'column', flexShrink: 0, backgroundColor: '#161b22' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '15px' }}>
          <h3 style={{ margin: 0, color: '#58a6ff' }}>Room: {projectName}</h3>
          <div style={{ display: 'flex', gap: '10px' }}>
            <button
              onClick={saveProject}
              style={{
                padding: '8px 12px', backgroundColor: '#2ea44f', color: 'white', border: 'none',
                borderRadius: '5px', cursor: 'pointer', transition: 'background-color 0.2s ease'
              }}
              onMouseEnter={(e) => e.target.style.backgroundColor = '#2c974b'}
              onMouseLeave={(e) => e.target.style.backgroundColor = '#2ea44f'}
            >
              💾 Save
            </button>
            <button
              onClick={loadProject}
              style={{
                padding: '8px 12px', backgroundColor: '#8957e5', color: 'white', border: 'none',
                borderRadius: '5px', cursor: 'pointer', transition: 'background-color 0.2s ease'
              }}
              onMouseEnter={(e) => e.target.style.backgroundColor = '#7a4ad2'}
              onMouseLeave={(e) => e.target.style.backgroundColor = '#8957e5'}
            >
              📂 Load
            </button>
          </div>
        </div>

        <div style={{ marginBottom: '15px' }}>
          <h4 style={{ margin: '0 0 5px 0', color: '#c9d1d9' }}>Participants:</h4>
          <ul style={{ listStyleType: 'none', padding: 0, margin: 0 }}>
            {roomParticipants.map((p, index) => (
              <li key={index} style={{ color: '#8b949e', fontSize: '0.9em' }}>
                {p.displayName} {p.socketId === socket.id ? '(You)' : ''}
                {/* Display 'In Call' only if isAvailableForCall is explicitly false */}
                {p.isAvailableForCall === false && <span style={{ color: '#dc3545', marginLeft: '5px' }}> (In Call)</span>}
              </li>
            ))}
          </ul>
        </div>

        <div style={{ flexGrow: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <h4 style={{ margin: '0 0 10px 0', color: '#c9d1d9' }}>Chat:</h4>
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
      </div>

      {/* Custom Confirmation Dialog */}
      {showConfirmDialog && (
        <ConfirmationDialog
          message={confirmMessage}
          onConfirm={confirmAction}
          onCancel={() => setShowConfirmDialog(false)}
        />
      )}
    </div>
  );
}
