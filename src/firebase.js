// Partes do Firebase usadas pelo app. Vira public/vendor/firebase.js com `npm run build`
// (assim o app não depende de CDN e funciona sem sinal depois de aberto uma vez).
export { initializeApp, deleteApp } from "firebase/app";
export {
  getAuth, connectAuthEmulator, onAuthStateChanged, signInWithEmailAndPassword, signOut,
  createUserWithEmailAndPassword, initializeAuth, inMemoryPersistence,
} from "firebase/auth";
export {
  initializeFirestore, connectFirestoreEmulator, persistentLocalCache, persistentMultipleTabManager,
  doc, collection, query, where, getDoc, getDocs, setDoc, updateDoc, writeBatch, onSnapshot, serverTimestamp,
} from "firebase/firestore";
