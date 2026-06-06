/* ==========================================================================
   EXAM DATA SYSTEM ENGINE - LIVE GOOGLE CLOUD ARCHITECTURE (FIRESTORE)
   ========================================================================== */

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { 
    getFirestore, doc, setDoc, getDoc, collection, onSnapshot, updateDoc, writeBatch 
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

// --- PASTE YOUR LIVE PROJECT GOOGLE WEB APP CONFIGURATION KEY BLOCK HERE ---
const firebaseConfig = {
  apiKey: "AIzaSyCNFLz8yJ0biCyMQzq4qKbrDAG5YelOK64",
  authDomain: "exam-paper-data-system.firebaseapp.com",
  projectId: "exam-paper-data-system",
  storageBucket: "exam-paper-data-system.firebasestorage.app",
  messagingSenderId: "563717623538",
  appId: "1:563717623538:web:bfc99999ea440fc1338a6b"
};

const isConfigured = firebaseConfig.apiKey !== "YOUR_API_KEY";
let app, db;

if (isConfigured) {
    app = initializeApp(firebaseConfig);
    db = getFirestore(app);
}

// Global System Trackers
let currentExamName = "Loading...";
let currentUserRole = null;
let liveDatabaseCache = {}; 

let sessionQP = "";
let sessionRecords = []; 
let sessionIndex = -1;   

/* ==========================================================================
   APP STARTUP & DATABASE CONNECTION INITIALIZERS
   ========================================================================== */
document.addEventListener("DOMContentLoaded", () => {
    initializeDOMEvents();
    if (isConfigured) {
        startRealTimeCloudSync();
    } else {
        console.warn("Application offline: Real-Time Sync deactivated. Paste Google credentials.");
    }
});

function startRealTimeCloudSync() {
    onSnapshot(doc(db, "system", "config"), (docSnapshot) => {
        if (docSnapshot.exists()) {
            const data = docSnapshot.data();
            currentExamName = data.examName || "No Exam Name Set";
            document.getElementById("display-exam-name").innerText = currentExamName;
            document.getElementById("settings-exam-name").value = currentExamName;
        } else {
            setDoc(doc(db, "system", "config"), {
                examName: "Summer Board Exams 2026",
                users: { "user1": "123", "admin": "123" }
            });
        }
    });

    onSnapshot(collection(db, "bundles"), (querySnapshot) => {
        liveDatabaseCache = {};
        querySnapshot.forEach((docRecord) => {
            const data = docRecord.data();
            const qp = data.qpCode;
            const ins = data.insCode;
            
            if (!liveDatabaseCache[qp]) liveDatabaseCache[qp] = {};
            if (!liveDatabaseCache[qp][ins]) liveDatabaseCache[qp][ins] = [];
            
            liveDatabaseCache[qp][ins].push({
                count: data.paperCount,
                time: data.timestamp,
                id: docRecord.id 
            });
        });
        
        if (currentUserRole === "admin") {
            renderAdminDashboard();
        }
    });
}

/* ==========================================================================
   AUTHENTICATION PROFILE SECURITY PROCESSING LOGIC
   ========================================================================== */
async function processSystemLogin(e) {
    e.preventDefault();

    if (!isConfigured) {
        alert("Configuration Blocked: Paste your real Google Firebase config object profile keys at the top of app.js!");
        return;
    }

    const u = document.getElementById("username").value.trim();
    const p = document.getElementById("password").value;

    try {
        const configDoc = await getDoc(doc(db, "system", "config"));
        if (configDoc.exists()) {
            const users = configDoc.data().users;
            if (users[u] && users[u] === p) {
                if (u === "admin") {
                    currentUserRole = "admin";
                    navigateToScreen("admin");
                } else {
                    currentUserRole = "user";
                    resetOperatorSession();
                    navigateToScreen("entry");
                }
            } else {
                alert("Invalid account credentials. Check login name and password.");
            }
        }
    } catch (err) {
        alert("Authentication network link failure: " + err.message);
    }
}

/* ==========================================================================
   OPERATOR INPUT RECORD CAPTURE (RIGHT / LEFT BUTTON PIPELINES)
   ========================================================================== */
async function handleRightArrowProcess() {
    const qp = document.getElementById("entry-qp-code").value.trim().toUpperCase();
    const ins = document.getElementById("entry-ins-code").value.trim();
    const countStr = document.getElementById("entry-paper-count").value.trim();

    if (!qp || !ins || !countStr) {
        alert("Validation warning: Complete all fields before submitting.");
        return;
    }

    if (!sessionQP) {
        sessionQP = qp;
        document.getElementById("entry-qp-code").disabled = true;
    }

    const count = parseInt(countStr, 10);

    // FIX 1, 2 & 5: Editing past records
    if (sessionIndex >= 0 && sessionIndex < sessionRecords.length) {
        const record = sessionRecords[sessionIndex];
        try {
            const currentTimestamp = getFormattedTimestamp();
            await updateDoc(doc(db, "bundles", record.docId), {
                paperCount: count,
                timestamp: currentTimestamp
            });
            record.count = count;
            record.time = currentTimestamp;
            alert("Data updated successfully!"); 
        } catch (e) {
            alert("Cloud write fault: " + e.message);
            return;
        }
        
        sessionIndex = sessionRecords.length; 
        clearEntryInputFields(); 
        return;
    }

    // Checking duplicates for brand new records
    if (liveDatabaseCache[sessionQP] && liveDatabaseCache[sessionQP][ins] && liveDatabaseCache[sessionQP][ins].length > 0) {
        triggerDuplicateModalPopup(ins, count);
    } else {
        commitEntryToCloud(ins, count);
    }
}

async function commitEntryToCloud(ins, count) {
    const timestamp = getFormattedTimestamp();
    const uniqueDocId = `${sessionQP}_${ins}_${Date.now()}`;

    const targetPayload = {
        qpCode: sessionQP,
        insCode: ins,
        paperCount: count,
        timestamp: timestamp
    };

    try {
        await setDoc(doc(db, "bundles", uniqueDocId), targetPayload);
        sessionRecords.push({ ins: ins, count: count, time: timestamp, docId: uniqueDocId });
        sessionIndex = sessionRecords.length;
        
        alert("Data stored successfully!"); 
        clearEntryInputFields(); 
    } catch (err) {
        alert("Cloud transaction rejected: " + err.message);
    }
}

function handleLeftArrowNavigation() {
    const targetQpInput = document.getElementById("entry-qp-code").value.trim().toUpperCase();

    // FIX 2: Pulling history directly into inputs
    if (sessionRecords.length === 0) {
        if (!targetQpInput) {
            alert("Please enter a CURRENT QP CODE first to view and edit past data.");
            return;
        }
        
        if (liveDatabaseCache[targetQpInput]) {
            sessionQP = targetQpInput;
            document.getElementById("entry-qp-code").disabled = true;
            
            for (let insKey in liveDatabaseCache[targetQpInput]) {
                liveDatabaseCache[targetQpInput][insKey].forEach((b) => {
                    sessionRecords.push({ ins: insKey, count: b.count, time: b.time, docId: b.id });
                });
            }
            sessionIndex = sessionRecords.length; 
        } else {
            alert(`No past database entries found for QP Code: ${targetQpInput}`);
            return;
        }
    }
    
    if (sessionIndex > 0) {
        sessionIndex--;
        const targetRecord = sessionRecords[sessionIndex];
        document.getElementById("entry-ins-code").value = targetRecord.ins;
        document.getElementById("entry-paper-count").value = targetRecord.count;
    } else {
        alert("This is the oldest record in the batch.");
    }
}

/* ==========================================================================
   DUPLICATE VERIFICATION MODAL ACTIONS
   ========================================================================== */
let pendingDuplicatePayload = null;

function triggerDuplicateModalPopup(ins, count) {
    pendingDuplicatePayload = { ins: ins, count: count };
    document.getElementById("dup-modal-ins").innerText = ins;
    document.getElementById("dup-modal-qp").innerText = sessionQP;
    document.getElementById("dup-modal-new-count").innerText = count;

    const listElement = document.getElementById("dup-modal-history-list");
    listElement.innerHTML = "";

    liveDatabaseCache[sessionQP][ins].forEach((bundle, idx) => {
        const itemLi = document.createElement("li");
        itemLi.innerHTML = `<i class="fa-solid fa-box-archive text-highlight"></i> Bundle ${idx + 1}: <strong>${bundle.count} Papers</strong> <small>(${bundle.time})</small>`;
        listElement.appendChild(itemLi);
    });

    document.getElementById("duplicate-modal-overlay").classList.remove("hidden");
}

async function executeDuplicateResolution(choice) {
    const ins = pendingDuplicatePayload.ins;
    const count = pendingDuplicatePayload.count;
    const timestamp = getFormattedTimestamp();

    try {
        if (choice === "add") {
            const uniqueDocId = `${sessionQP}_${ins}_${Date.now()}`;
            await setDoc(doc(db, "bundles", uniqueDocId), {
                qpCode: sessionQP, insCode: ins, paperCount: count, timestamp: timestamp
            });
            sessionRecords.push({ ins: ins, count: count, time: timestamp, docId: uniqueDocId });
            sessionIndex = sessionRecords.length;
            alert("Data stored successfully as an additional bundle!"); 
        } 
        else if (choice === "overwrite") {
            const batch = writeBatch(db);
            liveDatabaseCache[sessionQP][ins].forEach(b => {
                batch.delete(doc(db, "bundles", b.id));
            });
            const uniqueDocId = `${sessionQP}_${ins}_${Date.now()}`;
            batch.set(doc(db, "bundles", uniqueDocId), {
                qpCode: sessionQP, insCode: ins, paperCount: count, timestamp: timestamp
            });
            await batch.commit();
            sessionRecords.push({ ins: ins, count: count, time: timestamp, docId: uniqueDocId });
            sessionIndex = sessionRecords.length;
            alert("Past entries cleanly overwritten. Data updated successfully!"); 
        }
        
        // FIX 3: Resetting the screen after duplicate logic completes
        document.getElementById("duplicate-modal-overlay").classList.add("hidden");
        clearEntryInputFields(); 
        pendingDuplicatePayload = null;

    } catch(err) {
        alert("Error executing operation: " + err.message);
    }
}

/* ==========================================================================
   ADMIN MANAGEMENT FUNCTIONS
   ========================================================================== */
async function executeSystemHardReset() {
    if (confirm("CRITICAL WARNING: Are you completely certain you want to erase all records for the next exam cycle?")) {
        try {
            const newTitle = prompt("Enter Title String Name for next examination cycle:", "Winter Special Exams 2026");
            if (!newTitle) return;

            const batch = writeBatch(db);
            for (let qp in liveDatabaseCache) {
                for (let ins in liveDatabaseCache[qp]) {
                    liveDatabaseCache[qp][ins].forEach(b => {
                        batch.delete(doc(db, "bundles", b.id));
                    });
                }
            }
            await batch.commit();

            await updateDoc(doc(db, "system", "config"), { examName: newTitle });
            alert("Database purged cleanly. App rebranded successfully!");
            navigateToScreen("admin");
        } catch(err) {
            alert("Reset sequence aborted: " + err.message);
        }
    }
}

async function createNewOperatorAccount() {
    const u = document.getElementById("new-user-id").value.trim();
    const p = document.getElementById("new-user-pass").value.trim();
    
    if(u && p) {
        try {
            const configRef = doc(db, "system", "config");
            const configDoc = await getDoc(configRef);
            if (configDoc.exists()) {
                const currentUsers = configDoc.data().users;
                
                // FIX 4: Admin alerts
                const isExisting = !!currentUsers[u];
                
                currentUsers[u] = p;
                await updateDoc(configRef, { users: currentUsers });
                
                if (isExisting) {
                    alert(`Success: Password for existing operator "${u}" has been updated.`);
                } else {
                    alert(`Success: New operator account "${u}" has been created.`);
                }
                
                document.getElementById("new-user-id").value = "";
                document.getElementById("new-user-pass").value = "";
            }
        } catch(e) {
            alert("Cloud write failure: " + e.message);
        }
    } else {
        alert("Please enter both a username and a password first.");
    }
}

/* ==========================================================================
   ADMIN DATA GRID & DRILLDOWN UI GENERATORS
   ========================================================================== */
function renderAdminDashboard() {
    let uniqueQpCount = 0;
    let globalPaperSum = 0;
    const tableBody = document.getElementById("dashboard-table-body");
    tableBody.innerHTML = "";

    for (let qpKey in liveDatabaseCache) {
        uniqueQpCount++;
        let qpTotalPapers = 0;
        let qpInstitutes = Object.keys(liveDatabaseCache[qpKey]).length;

        for (let insKey in liveDatabaseCache[qpKey]) {
            liveDatabaseCache[qpKey][insKey].forEach(bundle => {
                qpTotalPapers += bundle.count;
            });
        }
        globalPaperSum += qpTotalPapers;

        const row = document.createElement("tr");
        row.style.cursor = "pointer";
        row.innerHTML = `
            <td><i class="fa-regular fa-folder-open text-highlight"></i> ${qpKey}</td>
            <td>${qpInstitutes}</td>
            <td>${qpTotalPapers}</td>
        `;
        row.addEventListener("click", () => activateDrilldownMatrix(qpKey));
        tableBody.appendChild(row);
    }

    document.getElementById("metric-total-qp").innerText = uniqueQpCount;
    document.getElementById("metric-total-papers").innerText = globalPaperSum;
}

let activeDrilldownQP = "";
function activateDrilldownMatrix(qpKey) {
    activeDrilldownQP = qpKey;
    document.getElementById("drilldown-qp-title").innerText = qpKey;
    
    const tableBody = document.getElementById("drilldown-table-body");
    tableBody.innerHTML = "";
    document.getElementById("drilldown-view").classList.remove("hidden");

    let itemsArray = [];
    for (let insKey in liveDatabaseCache[qpKey]) {
        liveDatabaseCache[qpKey][insKey].forEach(bundle => {
            itemsArray.push({ ins: insKey, count: bundle.count, time: bundle.time });
        });
    }

    itemsArray.sort((a, b) => a.count - b.count);

    let totalPapersSum = 0;
    itemsArray.forEach(item => {
        totalPapersSum += item.count;
        const row = document.createElement("tr");
        row.innerHTML = `<td>${item.ins}</td><td>${item.count}</td><td><small>${item.time}</small></td>`;
        tableBody.appendChild(row);
    });

    document.getElementById("drilldown-table-footer").innerHTML = `
        <td><strong>Total Bundles: ${itemsArray.length}</strong></td>
        <td colspan="2"><strong>Sum Count: ${totalPapersSum} Papers</strong></td>
    `;
}

/* ==========================================================================
   SHEETJS EXCEL SPREADSHEET WRITER ENGINE
   ========================================================================== */
function exportMasterExcelSheet() {
    let workbookData = [
        ["EXAMINATION TITLE NAME", "QUESTION PAPER CODE", "INSTITUTE CODE", "Paper count", "ENTRY DATE AND TIME stamp"]
    ];

    for (let qpKey in liveDatabaseCache) {
        for (let insKey in liveDatabaseCache[qpKey]) {
            liveDatabaseCache[qpKey][insKey].forEach(bundle => {
                workbookData.push([currentExamName, qpKey, insKey, bundle.count, bundle.time]);
            });
        }
    }

    const ws = XLSX.utils.aoa_to_sheet(workbookData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Master Log Matrix");
    XLSX.writeFile(wb, `${currentExamName.replace(/\s+/g, '_')}_MasterReport.xlsx`);
}

function exportSelectedQPExcelSheet() {
    if(!activeDrilldownQP) return;
    
    let workbookData = [
        ["EXAMINATION TITLE NAME", "QUESTION PAPER CODE", "INSTITUTE CODE", "Paper count", "ENTRY DATE AND TIME stamp"]
    ];

    for (let insKey in liveDatabaseCache[activeDrilldownQP]) {
        liveDatabaseCache[activeDrilldownQP][insKey].forEach(bundle => {
            workbookData.push([currentExamName, activeDrilldownQP, insKey, bundle.count, bundle.time]);
        });
    }

    const ws = XLSX.utils.aoa_to_sheet(workbookData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "QP Summary Ledger");
    XLSX.writeFile(wb, `QP_${activeDrilldownQP}_Report.xlsx`);
}

/* ==========================================================================
   ROUTING UTILITIES & INITIALIZERS
   ========================================================================== */
function navigateToScreen(screenId) {
    document.getElementById("login-screen").classList.add("hidden");
    document.getElementById("entry-screen").classList.add("hidden");
    document.getElementById("admin-screen").classList.add("hidden");
    document.getElementById("settings-panel").classList.add("hidden");
    document.getElementById("global-exam-header").classList.add("hidden");

    if (screenId !== "login") document.getElementById("global-exam-header").classList.remove("hidden");
    if (screenId === "login") document.getElementById("login-screen").classList.remove("hidden");
    if (screenId === "entry") document.getElementById("entry-screen").classList.remove("hidden");
    if (screenId === "admin") {
        document.getElementById("admin-screen").classList.remove("hidden");
        renderAdminDashboard();
    }
    if (screenId === "settings") document.getElementById("settings-panel").classList.remove("hidden");
}

function resetOperatorSession() {
    sessionQP = ""; sessionRecords = []; sessionIndex = -1;
    document.getElementById("entry-qp-code").value = "";
    document.getElementById("entry-qp-code").disabled = false;
    clearEntryInputFields();
}

function clearEntryInputFields() {
    document.getElementById("entry-ins-code").value = "";
    document.getElementById("entry-paper-count").value = "";
}

function getFormattedTimestamp() {
    const d = new Date();
    return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;
}

function initializeDOMEvents() {
    document.getElementById("login-form").addEventListener("submit", processSystemLogin);
    document.getElementById("btn-user-logout").addEventListener("click", () => navigateToScreen("login"));
    document.getElementById("btn-admin-logout").addEventListener("click", () => navigateToScreen("login"));
    document.getElementById("btn-admin-settings").addEventListener("click", () => navigateToScreen("settings"));
    document.getElementById("btn-close-settings").addEventListener("click", () => navigateToScreen("admin"));
    document.getElementById("btn-arrow-right").addEventListener("click", handleRightArrowProcess);
    document.getElementById("btn-arrow-left").addEventListener("click", handleLeftArrowNavigation);
    document.getElementById("btn-complete-qp").addEventListener("click", () => {
        if(!sessionQP) { alert("No active session folder to close."); return; }
        alert(`Batch folder context "${sessionQP}" locked.`); resetOperatorSession();
    });
    document.getElementById("btn-modal-add-bundle").addEventListener("click", () => executeDuplicateResolution("add"));
    document.getElementById("btn-modal-overwrite").addEventListener("click", () => executeDuplicateResolution("overwrite"));
    document.getElementById("btn-modal-cancel").addEventListener("click", () => {
        document.getElementById("duplicate-modal-overlay").classList.add("hidden");
	clearEntryInputFields();
        pendingDuplicatePayload = null;
    });
    document.getElementById("btn-save-exam-name").addEventListener("click", async () => {
        const title = document.getElementById("settings-exam-name").value.trim();
        if(title) {
            await updateDoc(doc(db, "system", "config"), { examName: title });
            alert("Exam master string modified in cloud database!");
        }
    });
    document.getElementById("btn-create-user").addEventListener("click", createNewOperatorAccount);
    document.getElementById("btn-clear-system-data").addEventListener("click", executeSystemHardReset);
    document.getElementById("btn-export-master-excel").addEventListener("click", exportMasterExcelSheet);
    document.getElementById("btn-export-qp-excel").addEventListener("click", exportSelectedQPExcelSheet);
}
