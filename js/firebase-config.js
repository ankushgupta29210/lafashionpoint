import { initializeApp }  from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getAuth }        from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { getFirestore }   from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { getStorage }     from "https://www.gstatic.com/firebasejs/10.12.0/firebase-storage.js";

const firebaseConfig = {
    apiKey:            "AIzaSyC8T3nTG9EBDdSbwuMTQPCaXoxqEvP_hXI",
    authDomain:        "lafashionpoint-9ab42.firebaseapp.com",
    projectId:         "lafashionpoint-9ab42",
    storageBucket:     "lafashionpoint-9ab42.firebasestorage.app",
    messagingSenderId: "572532463194",
    appId:             "1:572532463194:web:feaa71d8f74e66c51a6a63",
    measurementId:     "G-9WXCS4J1LT"
};

const app = initializeApp(firebaseConfig);

export const auth    = getAuth(app);
export const db      = getFirestore(app);
export const storage = getStorage(app);
