// Copy this file to firebase/firebase-config.js and configure Firebase browser SDK flows.
// The production app keeps privileged Firebase work on the server.
import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";

// Your web app's Firebase configuration
const firebaseConfig = {
  apiKey: "AIzaSyA0nRrFw0WGjwfrJb-mnzFreR62hw8iLNw",
  authDomain: "mat-lead-c0ca4.firebaseapp.com",
  projectId: "mat-lead-c0ca4",
  storageBucket: "mat-lead-c0ca4.firebasestorage.app",
  messagingSenderId: "826518752424",
  appId: "1:826518752424:web:dbb47dd6ea98a028a6069d"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const firebaseClientConfig = {
  apiKey: firebaseConfig.apiKey,
  authDomain: firebaseConfig.authDomain,
  projectId: firebaseConfig.projectId,
  appId: firebaseConfig.appId
};
