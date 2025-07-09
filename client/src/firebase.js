// firebase.js
import { initializeApp } from "firebase/app";
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut } from "firebase/auth";
import { getFirestore } from "firebase/firestore";
// ✅ Import getStorage for Firebase Storage operations
import { getStorage, ref, deleteObject } from "firebase/storage"; // Add this line

// ✅ Your Firebase config
const firebaseConfig = {
  apiKey: "AIzaSyCOSPxlPl6RZIg00toPGqASFdCd-nwp7xw",
  authDomain: "realtime-code-editor-5269b.firebaseapp.com",
  projectId: "realtime-code-editor-5269b",
  storageBucket: "realtime-code-editor-5269b.appspot.com",
  messagingSenderId: "318467410147",
  appId: "1:318467410147:web:eb7b6470c6473754b55dd6",
  measurementId: "G-JCK9JF16W0"
};

// ✅ Initialize Firebase
const app = initializeApp(firebaseConfig);

// ✅ Authentication
const auth = getAuth(app);
const provider = new GoogleAuthProvider();

// ✅ Firestore
const db = getFirestore(app);

// ✅ Storage
const storage = getStorage(app); // Initialize Storage

// ✅ Export everything
export { auth, provider, signInWithPopup, signOut, db, storage }; // Export storage