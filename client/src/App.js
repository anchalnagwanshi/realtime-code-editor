import React, { useState, useEffect } from 'react';
import CodeEditor from './CodeEditor';
import {
  auth,
  provider,
  signInWithPopup,
  signOut
} from './firebase';

function App() {
  const [user, setUser] = useState(null);
  // Lift projectName state up to App.js
  const [projectName, setProjectName] = useState(null); // Initialize as null

  // Auth listener to set user state
  useEffect(() => {
    const unsubscribe = auth.onAuthStateChanged((currentUser) => {
      setUser(currentUser);
      // If user logs out, reset projectName
      if (!currentUser) {
        setProjectName(null);
      }
    });
    return unsubscribe;
  }, []);

  const handleLogin = async () => {
    try {
      const result = await signInWithPopup(auth, provider);
      setUser(result.user);
      // On successful login, projectName should still be null to prompt for room
      setProjectName(null);
    } catch (error) {
      console.error("Login error:", error);
    }
  };

  const handleLogout = () => {
    signOut(auth)
      .then(() => {
        setUser(null);
        setProjectName(null); // Crucially, reset projectName on logout
      })
      .catch(err => console.error("Logout error:", err));
  };

  return (
    <div>
      <header style={{
        padding: '10px 20px',
        backgroundColor: '#282c34',
        color: 'white',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between'
      }}>
        <h2>Realtime Code Editor</h2>
        {user ? (
          <div style={{ display: 'flex', alignItems: 'center' }}>
            <img
              src={user.photoURL}
              alt="profile"
              width={40}
              height={40}
              style={{ borderRadius: '50%', marginRight: 10 }}
            />
            <span style={{ marginRight: 20 }}>{user.displayName}</span>
            <button onClick={handleLogout} style={{
              padding: '8px 15px',
              backgroundColor: '#dc3545',
              color: 'white',
              border: 'none',
              borderRadius: '5px',
              cursor: 'pointer',
              transition: 'background-color 0.2s ease'
            }}
            onMouseEnter={(e) => e.target.style.backgroundColor = '#c82333'}
            onMouseLeave={(e) => e.target.style.backgroundColor = '#dc3545'}
            >Logout</button>
          </div>
        ) : (
          <button onClick={handleLogin} style={{
            padding: '10px 20px',
            backgroundColor: '#007bff',
            color: 'white',
            border: 'none',
            borderRadius: '5px',
            cursor: 'pointer',
            transition: 'background-color 0.2s ease'
          }}
          onMouseEnter={(e) => e.target.style.backgroundColor = '#0056b3'}
          onMouseLeave={(e) => e.target.style.backgroundColor = '#007bff'}
          >Login with Google</button>
        )}
      </header>

      <main>
        {user ? (
          // Pass user, projectName, and setProjectName as props
          // Add a key prop that changes when the user changes, forcing CodeEditor to remount
          <CodeEditor
            key={user.uid} // Use user.uid as the key
            user={user}
            projectName={projectName}
            setProjectName={setProjectName}
          />
        ) : (
          <p style={{ textAlign: 'center', marginTop: '50px', fontSize: '1.2em', color: '#6c757d' }}>
            Please log in to start collaborating on code.
          </p>
        )}
      </main>
    </div>
  );
}

export default App;
