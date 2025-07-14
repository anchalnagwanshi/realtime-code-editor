// firebase.js
import { initializeApp } from "firebase/app";
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut } from "firebase/auth";
import { getFirestore } from "firebase/firestore";
// ✅ Import getStorage for Firebase Storage operations
import { getStorage, ref, deleteObject } from "firebase/storage"; // Add this line

// ✅ Your Firebase config
const firebaseConfig = {
  apiKey: process.env.REACT_APP_FIREBASE_API_KEY,
  authDomain: process.env.REACT_APP_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.REACT_APP_FIREBASE_PROJECT_ID,
  storageBucket: process.env.REACT_APP_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.REACT_APP_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.REACT_APP_FIREBASE_APP_ID,
  measurementId: process.env.REACT_APP_FIREBASE_MEASUREMENT_ID
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