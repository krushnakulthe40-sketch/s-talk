const socket = io();
let currentMode = null; // 'video' or 'text'
let peerConnection;
let localStream;
let roomId;
let isInitiator = false;
let candidateQueue = []; // फिक्स: लवकर आलेल्या कँडिडेट्ससाठी रांग
let remoteDescriptionSet = false; // फिक्स: कनेक्शन रेडी आहे का ते चेक करण्यासाठी

// UI Elements
const landingPage = document.getElementById('landing-page');
const selectionPage = document.getElementById('selection-page');
const chatRoom = document.getElementById('chat-room');
const statusBadge = document.getElementById('status-badge');
const msgInput = document.getElementById('msgInput');
const sendBtn = document.getElementById('sendBtn');
const chatBox = document.getElementById('messages-box');
const loadingMsg = document.getElementById('loadingMsg');
const remoteVideo = document.getElementById('remoteVideo');

// WebRTC Config (Google STUN Servers)
const rtcConfig = {
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' }
    ]
};

// 1. Navigation Functions
function showSelection() {
    landingPage.classList.remove('active');
    selectionPage.classList.add('active');
}

function startChat(mode) {
    currentMode = mode;
    selectionPage.classList.remove('active');
    chatRoom.classList.add('active');

    if (mode === 'text') {
        document.body.classList.add('text-mode');
        initiateSocketConnection();
    } else {
        document.body.classList.remove('text-mode');
        // व्हिडिओ परमिशन
        navigator.mediaDevices.getUserMedia({ video: true, audio: true })
            .then(stream => {
                localStream = stream;
                document.getElementById('localVideo').srcObject = stream;
                initiateSocketConnection();
            })
            .catch(err => {
                alert("Camera access denied! Please allow camera access.");
                location.reload();
            });
    }
}

function initiateSocketConnection() {
    statusBadge.innerText = "Searching...";
    addSystemMessage(`Searching for a ${currentMode} partner...`);
    socket.emit('find_partner', { mode: currentMode });
}

// 2. Skip Function
function skipPartner() {
    if(peerConnection) {
        peerConnection.close();
        peerConnection = null;
    }
    socket.emit('disconnect_request');
    
    // UI Reset
    chatBox.innerHTML = '';
    msgInput.disabled = true;
    sendBtn.disabled = true;
    remoteVideo.srcObject = null;
    
    // Reset Variables
    remoteDescriptionSet = false;
    candidateQueue = [];

    addSystemMessage("Skipping... Searching new partner...");
    socket.emit('find_partner', { mode: currentMode });
}

// 3. Socket Events
socket.on('waiting', () => {
    statusBadge.innerText = "Waiting...";
    loadingMsg.style.display = "block";
});

socket.on('match_found', (data) => {
    roomId = data.room_id;
    isInitiator = data.initiator;
    
    // Reset connection flags
    remoteDescriptionSet = false;
    candidateQueue = [];

    statusBadge.innerText = "Connected";
    statusBadge.style.background = "#28a745";
    loadingMsg.style.display = "none";
    addSystemMessage("Stranger connected! Say Hi.");

    msgInput.disabled = false;
    sendBtn.disabled = false;

    if (currentMode === 'video') {
        startWebRTC();
    }
});

socket.on('receive_message', (msg) => {
    const div = document.createElement('div');
    div.classList.add('stranger-msg');
    div.innerText = msg;
    chatBox.appendChild(div);
    chatBox.scrollTop = chatBox.scrollHeight;
});

socket.on('partner_disconnected', () => {
    statusBadge.innerText = "Disconnected";
    statusBadge.style.background = "#dc3545";
    addSystemMessage("Stranger disconnected.");
    
    msgInput.disabled = true;
    sendBtn.disabled = true;
    if (remoteVideo.srcObject) {
        remoteVideo.srcObject = null;
    }
    if (peerConnection) {
        peerConnection.close();
        peerConnection = null;
    }
});

// 4. WebRTC Logic (Main Fix Here)
function startWebRTC() {
    peerConnection = new RTCPeerConnection(rtcConfig);

    // Add local stream
    if (localStream) {
        localStream.getTracks().forEach(track => {
            peerConnection.addTrack(track, localStream);
        });
    }

    // Handle incoming stream
    peerConnection.ontrack = (event) => {
        console.log("Stream received!");
        remoteVideo.srcObject = event.streams[0];
    };

    // Send ICE candidates
    peerConnection.onicecandidate = (event) => {
        if (event.candidate) {
            socket.emit('signal', { type: 'candidate', candidate: event.candidate, room: roomId });
        }
    };

    if (isInitiator) {
        peerConnection.createOffer().then(offer => {
            peerConnection.setLocalDescription(offer);
            socket.emit('signal', { type: 'offer', sdp: offer.sdp, room: roomId });
        });
    }
}

socket.on('signal', async (data) => {
    if (currentMode !== 'video' || !peerConnection) return;

    try {
        if (data.type === 'offer') {
            await peerConnection.setRemoteDescription(new RTCSessionDescription(data));
            remoteDescriptionSet = true; // Flag set
            processCandidateQueue(); // रांगेत असलेले पत्ते वापरा

            const answer = await peerConnection.createAnswer();
            await peerConnection.setLocalDescription(answer);
            socket.emit('signal', { type: 'answer', sdp: answer.sdp, room: roomId });
        } 
        else if (data.type === 'answer') {
            await peerConnection.setRemoteDescription(new RTCSessionDescription(data));
            remoteDescriptionSet = true; // Flag set
            processCandidateQueue(); // रांगेत असलेले पत्ते वापरा
        } 
        else if (data.type === 'candidate' && data.candidate) {
            // Fix: जर कनेक्शन रेडी नसेल, तर रांगेत टाका
            if (remoteDescriptionSet) {
                await peerConnection.addIceCandidate(new RTCIceCandidate(data.candidate));
            } else {
                candidateQueue.push(data.candidate);
            }
        }
    } catch (e) {
        console.error("Signal Error:", e);
    }
});

// फिक्स: रांगेत अडकलेले पत्ते (Candidates) ऍड करण्यासाठी फंक्शन
async function processCandidateQueue() {
    if (peerConnection && candidateQueue.length > 0) {
        for (let candidate of candidateQueue) {
            try {
                await peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
            } catch (e) {
                console.error("Error adding queued candidate", e);
            }
        }
        candidateQueue = []; // रांग रिकामी करा
    }
}

// 5. Chat Utilities
sendBtn.onclick = sendMessage;
msgInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') sendMessage();
});

function sendMessage() {
    const msg = msgInput.value;
    if (!msg.trim()) return;

    socket.emit('send_message', { message: msg, room: roomId });
    
    const div = document.createElement('div');
    div.classList.add('my-msg');
    div.innerText = msg;
    chatBox.appendChild(div);
    chatBox.scrollTop = chatBox.scrollHeight;
    msgInput.value = "";
}

function addSystemMessage(text) {
    const div = document.createElement('div');
    div.classList.add('sys-msg');
    div.innerText = text;
    chatBox.appendChild(div);
    chatBox.scrollTop = chatBox.scrollHeight;
}