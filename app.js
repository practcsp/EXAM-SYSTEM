/* ==========================================================================
   EXAM DATA SYSTEM ENGINE - LIVE GOOGLE CLOUD ARCHITECTURE (FIRESTORE)
   ========================================================================== */

// 1. IMPORT FIREBASE SERVICES FROM THE GOOGLE CDN NETWORK NETWORK
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { 
    getFirestore, doc, setDoc, getDoc, collection, onSnapshot, updateDoc, writeBatch, query, orderBy 
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

// 2. PASTE YOUR WEBLINK CONFIGURATION KEYS HERE DIRECTLY FROM GOOGLE SITE
// Replace this placeholder below with your actual config block:
const firebaseConfig = {
  apiKey: "AIzaSyCNFLz8yJ0biCyMQzq4qKbrDAG5YelOK64",
  authDomain: "exam-paper-data-system.firebaseapp.com",
  projectId: "exam-paper-data-system",
  storageBucket: "exam-paper-data-system.firebasestorage.app",
  messagingSenderId: "563717623538",
  appId: "1:563717623538:web:bfc99999ea440fc1338a6b"
};

// Initialize Google Core Cloud Engine
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

// Global State Trackers
let currentExamName = "Loading...";
let currentUserRole = null;
let liveDatabaseCache = {}; 

// Operator Data Navigation Session Trackers
let sessionQP = "";
let sessionRecords = []; 
let sessionIndex = -1;   

/* ==========================================================================
   APP STARTUP & REAL-TIME LISTENERS SETUP
   ========================================================================== */
document.addEventListener("DOMContentLoaded", () => {
    initializeDOMEvents();
    startRealTimeCloudSync();
});

// Create a persistent connection to the cloud database
function startRealTimeCloudSync() {
    // Listen for Real-Time global configuration parameters (Exam Title & Auth Profiles)
    onSnapshot(doc(db, "system", "config"), (docSnapshot) => {
        if (docSnapshot.exists()) {
            const data = docSnapshot.data();
            currentExamName = data.examName || "No Exam Name Set";
            // FIXED: Displays ONLY your custom typed exam name without any prepended text
            document.getElementById("display-exam-name").innerText = currentExamName;
            document.getElementById("settings-exam-name").value = currentExamName;
        } else {
            // Seed defaults into database automatically if it's completely fresh
            setDoc(doc(db, "system", "config"), {
                examName: "Summer Board Exams 2026",
                users: { "user1": "123", "admin": "123" }
            });
        }
    });

    // Listen for real-time changes across all Question Paper bundle entries
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
                id: docRecord.id // Firestore document reference key tracking row identities
            });
        });
        
        // Refresh the admin dashboard view instantly behind the scenes if open
        if (currentUserRole === "admin") {
            renderAdminDashboard();
        }
    });
}

/* ==========================================================================
   AUTHENTICATION LOGIC
   ========================================================================== */
async function processSystemLogin(e) {
    e.preventDefault();
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
                alert("Invalid account credentials! Please verify.");
            }
        }
    } catch (err) {
        alert("Authentication network link failure: " + err.message);
    }
}

/* ==========================================================================
   DATA FIELD INPUT ARROW CONTROLLERS
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

    // If operator is actively reviewing history via left arrow, overwrite it directly
    if (sessionIndex < sessionRecords.length - 1) {
        const record = sessionRecords[sessionIndex];
        try {
            const currentTimestamp = getFormattedTimestamp();
            await updateDoc(doc(db, "bundles", record.docId), {
                paperCount: count,
                timestamp: currentTimestamp
            });
            record.count = count;
            record.time = currentTimestamp;
            alert("Entry row log record modified successfully!");
        } catch (e) {
            alert("Cloud write fault: " + e.message);
        }
        sessionIndex = sessionRecords.length - 1;
        clearEntryInputFields();
        return;
    }

    // Check cloud cache instantly for multi-bundle duplication rule exceptions
    if (liveDatabaseCache[sessionQP] && liveDatabaseCache[sessionQP][ins] && liveDatabaseCache[sessionQP][ins].length > 0) {
        triggerDuplicateModalPopup(ins, count);
    } else {
        commitEntryToCloud(ins, count);
    }
}

async function commitEntryToCloud(ins, count) {
    const timestamp = getFormattedTimestamp();
    const uniqueDocId = `${sessionQP}_${ins}_${Date.now()}`; // Prevent hash key collapse

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
        clearEntryInputFields();
    } catch (err) {
        alert("Cloud transaction rejected: " + err.message);
    }
}

// FIXED: Removed the local session block message box entirely
function handleLeftArrowNavigation() {
    const targetQpInput = document.getElementById("entry-qp-code").value.trim().toUpperCase();

    // Fallback: If no local active history array exists yet but they typed a QP Code, check the live cloud cache structure instead
    if (sessionRecords.length === 0) {
        if (!targetQpInput) {
            alert("Please enter a CURRENT QP CODE first to pull live history logs.");
            return;
        }
        
        if (liveDatabaseCache[targetQpInput]) {
            let totalBundlesFound = 0;
            let summaryMessage = `Live Cloud Logs for QP [${targetQpInput}]:\n\n`;
            
            for (let insKey in liveDatabaseCache[targetQpInput]) {
                liveDatabaseCache[targetQpInput][insKey].forEach((b) => {
                    totalBundlesFound++;
                    summaryMessage += `• Inst ${insKey}: ${b.count} Papers (${b.time})\n`;
                });
            }
            alert(summaryMessage);
        } else {
            alert(`No live entries found in the database yet for QP Code: ${targetQpInput}`);
        }
        return;
    }
    
    if (sessionIndex === sessionRecords.length) {
        sessionIndex = sessionRecords.length - 1;
    } else if (sessionIndex > 0) {
        sessionIndex--;
    } else {
        alert("Reached edge boundary of active session registry ledger.");
        return;
    }

    const targetRecord = sessionRecords[sessionIndex];
    document.getElementById("entry-ins-code").value = targetRecord.ins;
    document.getElementById("entry-paper-count").value = targetRecord.count;
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
            alert("Added as an additional separate paper bundle successfully.");
        } 
        else if (choice === "overwrite") {
            // Overwrite strategy: Purge past instances in cloud collection index array, create new baseline row
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
            alert("Past entries wiped cleanly. New bundle balance saved.");
        }
    } catch(err) {
        alert("Error executing operation: " + err.message);
    }

    document.getElementById("duplicate-modal-overlay").classList.add("hidden");
    clearEntryInputFields();
    pendingDuplicatePayload = null;
}

/* ==========================================================================
   ADMIN MANAGEMENT FUNCTIONS
   ========================================================================== */
async function executeSystemHardReset() {
    if (confirm("CRITICAL WARNING: Are you completely certain you want to erase all records for the next exam cycle?")) {
        try {
            const newTitle = prompt("Enter Title String Name for next examination cycle:", "Winter Special Exams 2026");
            if (!newTitle) return;

            // 1. Wipe all data documents inside the bundles collection
            const batch = writeBatch(db);
            for (let qp in liveDatabaseCache) {
                for (let ins in liveDatabaseCache[qp]) {
                    liveDatabaseCache[qp][ins].forEach(b => {
                        batch.delete(doc(db, "bundles", b.id));
                    });
                }
            }
            await batch.commit();

            // 2. Update the global exam title string parameter in the cloud configs
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
                currentUsers[u] = p;
                await updateDoc(configRef, { users: currentUsers });
                alert(`Operator username profile "${u}" registered to cloud index mapping.`);
                document.getElementById("new-user-id").value = "";
                document.getElementById("new-user-pass").value = "";
            }
        } catch(e) {
            alert("Cloud write failure: " + e.message);
        }
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

    // MANDATORY REQUIREMENT: Sort records strictly in Ascending Order by paper count
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
    document.getElementById("btn-modal-cancel").addEventListener("click", () => document.getElementById("duplicate-modal-overlay").classList.add("hidden"));
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