// State
let currentPin = null;
let currentEnteredPin = "";
let isCreateMode = false;
let allMedia = [];
let socket = null;
let uploadProgress = null;
let pollTimer = null;

// DOM Elements - Keypad Gateway
const pinGateway = document.getElementById('pinGateway');
const mainApp = document.getElementById('mainApp');
const tabJoin = document.getElementById('tabJoin');
const tabCreate = document.getElementById('tabCreate');
const keypadPrompt = document.getElementById('keypadPrompt');
const pinDots = document.getElementById('pinDots');
const pinNumberPreview = document.getElementById('pinNumberPreview');
const pinError = document.getElementById('pinError');
const btnSubmitPin = document.getElementById('btnSubmitPin');
const btnSubmitLabel = document.getElementById('btnSubmitLabel');
const btnKeypadClear = document.getElementById('btnKeypadClear');
const btnKeypadBackspace = document.getElementById('btnKeypadBackspace');

// Main App DOM
const headerPinDisplay = document.getElementById('headerPinDisplay');
const btnSwitchRoom = document.getElementById('btnSwitchRoom');
const emptyNotice = document.getElementById('emptyNotice');

const dropArea = document.getElementById('dropArea');
const filePicker = document.getElementById('filePicker');
const btnChooseFiles = document.getElementById('btnChooseFiles');
const mediaGrid = document.getElementById('mediaGrid');
const liveUrlText = document.getElementById('liveUrlText');
const btnCopy = document.getElementById('btnCopy');
const btnCopyLabel = document.getElementById('btnCopyLabel');
const btnShowQr = document.getElementById('btnShowQr');
const onlineCount = document.getElementById('onlineCount');
const liveToast = document.getElementById('liveToast');
const toastMessage = document.getElementById('toastMessage');
const dropHintText = document.getElementById('dropHintText');

// Modals
const viewModal = document.getElementById('viewModal');
const modalClose = document.getElementById('modalClose');
const modalMedia = document.getElementById('modalMedia');
const modalName = document.getElementById('modalName');
const modalMeta = document.getElementById('modalMeta');
const modalRawBtn = document.getElementById('modalRawBtn');

const qrModal = document.getElementById('qrModal');
const qrClose = document.getElementById('qrClose');
const qrCanvas = document.getElementById('qrCanvas');
const qrDisplayUrl = document.getElementById('qrDisplayUrl');

const PASTEL_BORDERS = [
  '#FFD2C2', // Peach
  '#E4D8F8', // Lavender
  '#D5F1E5', // Mint
  '#D6E8FA', // Sky
  '#FCD6E3', // Soft Pink
  '#FFE8A3'  // Yellow
];

// Touch hint
if (/Mobi|Android|iPhone/i.test(navigator.userAgent)) {
  dropHintText.textContent = 'or tap to select files (Max 100MB)';
}

// ==================== LOCKSCREEN KEYPAD CONTROLLER ====================

// Keypad digit clicks
document.querySelectorAll('.keypad-btn[data-key]').forEach(btn => {
  btn.addEventListener('click', () => {
    const digit = btn.getAttribute('data-key');
    if (currentEnteredPin.length < 8) {
      currentEnteredPin += digit;
      updateKeypadDisplay();
      clearError();
    }
  });
});

// Clear button
btnKeypadClear.addEventListener('click', () => {
  currentEnteredPin = "";
  updateKeypadDisplay();
  clearError();
});

// Backspace button
btnKeypadBackspace.addEventListener('click', () => {
  currentEnteredPin = currentEnteredPin.slice(0, -1);
  updateKeypadDisplay();
  clearError();
});

// Physical keyboard support for desktop (Numpad + Numbers + Enter)
window.addEventListener('keydown', (e) => {
  if (!pinGateway.classList.contains('hidden')) {
    if (/^[0-9]$/.test(e.key)) {
      if (currentEnteredPin.length < 8) {
        currentEnteredPin += e.key;
        updateKeypadDisplay();
        clearError();
      }
    } else if (e.key === 'Backspace') {
      currentEnteredPin = currentEnteredPin.slice(0, -1);
      updateKeypadDisplay();
      clearError();
    } else if (e.key === 'Enter') {
      handlePinSubmit();
    }
  }
});

function updateKeypadDisplay() {
  const dots = pinDots.querySelectorAll('.pin-dot');
  dots.forEach((dot, idx) => {
    if (idx < currentEnteredPin.length) {
      dot.classList.add('filled');
    } else {
      dot.classList.remove('filled');
    }
  });

  if (currentEnteredPin.length === 0) {
    pinNumberPreview.textContent = '_ _ _ _';
  } else {
    pinNumberPreview.textContent = currentEnteredPin.split('').join(' ');
  }
}

function clearError() {
  pinError.style.display = 'none';
  pinError.textContent = '';
}

function showError(msg) {
  pinError.textContent = msg;
  pinError.style.display = 'block';
}

// Mode switching: Join vs Create
tabJoin.addEventListener('click', () => {
  isCreateMode = false;
  tabJoin.classList.add('active');
  tabCreate.classList.remove('active');
  keypadPrompt.textContent = 'Enter your room PIN to connect';
  btnSubmitLabel.textContent = 'Enter Room 🚀';
  clearError();
});

tabCreate.addEventListener('click', () => {
  isCreateMode = true;
  tabCreate.classList.add('active');
  tabJoin.classList.remove('active');
  keypadPrompt.textContent = 'Choose a unique PIN for your new room';
  btnSubmitLabel.textContent = 'Create Room ✨';
  clearError();
});

// Submit PIN Action
btnSubmitPin.addEventListener('click', handlePinSubmit);

async function handlePinSubmit() {
  const pin = currentEnteredPin.trim();
  if (!pin || pin.length < 3) {
    showError('PIN must be at least 3 digits.');
    return;
  }

  btnSubmitPin.disabled = true;

  if (isCreateMode) {
    try {
      const res = await fetch('/api/room/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin })
      });
      const data = await res.json();
      btnSubmitPin.disabled = false;

      if (!res.ok) {
        showError(data.error || 'Failed to create room.');
        return;
      }
      enterRoom(data.pin);
    } catch (err) {
      btnSubmitPin.disabled = false;
      showError('Network error. Check server connection.');
    }
  } else {
    try {
      const res = await fetch(`/api/room/${encodeURIComponent(pin)}/check`);
      const data = await res.json();
      btnSubmitPin.disabled = false;

      if (!data.exists) {
        showError(`Room PIN "${pin}" doesn't exist yet! Switch to "Create Room" to start it.`);
        return;
      }
      enterRoom(pin);
    } catch (err) {
      btnSubmitPin.disabled = false;
      showError('Network error. Check server connection.');
    }
  }
}

// Switch Room Button
btnSwitchRoom.addEventListener('click', showPinGateway);

function showPinGateway() {
  localStorage.removeItem('active_room_pin');
  currentEnteredPin = "";
  updateKeypadDisplay();
  clearError();
  pinGateway.classList.remove('hidden');
  mainApp.style.display = 'none';
  window.history.replaceState({}, '', window.location.pathname);
  if (socket && socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify({ type: 'JOIN_PIN', pin: null }));
  }
  if (pollTimer) clearInterval(pollTimer);
}

// Enter Room with PIN
async function enterRoom(pin) {
  currentPin = pin;

  // Keep URL clean: do NOT expose PIN in browser address bar (prevents auto-reconnect on refresh)
  window.history.replaceState({}, '', window.location.pathname);

  // UI Updates
  headerPinDisplay.textContent = pin;
  liveUrlText.textContent = `${window.location.host} (PIN: ${pin})`;
  qrDisplayUrl.textContent = window.location.href;

  pinGateway.classList.add('hidden');
  mainApp.style.display = 'flex';

  // Join WebSocket room if connected
  if (socket && socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify({ type: 'JOIN_PIN', pin }));
  }

  // Load Room Media
  await loadRoomMedia();

  // Start backup polling (essential for Vercel serverless live sync!)
  startLivePolling();
}

// Backup live polling for Vercel
function startLivePolling() {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = setInterval(async () => {
    if (!currentPin) return;
    try {
      const res = await fetch(`/api/room/${encodeURIComponent(currentPin)}/media`);
      if (res.ok) {
        const data = await res.json();
        const incoming = data.media || [];
        if (incoming.length !== allMedia.length) {
          allMedia = incoming;
          render();
        }
      }
    } catch (e) {}
  }, 3000);
}

// ==================== WEBSOCKETS ====================
function initSocket() {
  // Vercel serverless does not support persistent WebSockets; use polling instead
  if (window.location.hostname.includes('vercel.app')) {
    return;
  }
  try {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    socket = new WebSocket(`${protocol}//${window.location.host}`);

    socket.onopen = () => {
      if (currentPin) {
        socket.send(JSON.stringify({ type: 'JOIN_PIN', pin: currentPin }));
      }
    };

    socket.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === 'NEW_MEDIA') {
          const newItems = data.items.filter(item => !allMedia.some(m => m.id === item.id));
          allMedia.unshift(...newItems);
          render();

          const first = newItems[0];
          const isPhoto = first.type === 'photo';
          const randomUser = `user_${Math.floor(1000 + Math.random() * 9000)}`;
          popToast(`<strong>${randomUser}</strong> just dropped a ${isPhoto ? 'photo' : 'video'} in AlphaBeta! ✨`);
        } else if (data.type === 'DELETE_MEDIA') {
          allMedia = allMedia.filter(m => m.id !== data.id);
          render();
        } else if (data.type === 'ROOM_STATS') {
          if (data.onlineCount !== undefined) {
            onlineCount.textContent = data.onlineCount;
          }
        }
      } catch (e) {
        console.error(e);
      }
    };

    socket.onclose = () => {
      // Don't spam retries on Vercel
      setTimeout(initSocket, 5000);
    };
  } catch (err) {
    // Falls back gracefully to live polling
  }
}

// ==================== LOAD MEDIA FOR ROOM ====================
async function loadRoomMedia() {
  if (!currentPin) return;
  try {
    const res = await fetch(`/api/room/${encodeURIComponent(currentPin)}/media`);
    if (res.ok) {
      const data = await res.json();
      allMedia = data.media || [];
      render();
    } else {
      allMedia = [];
      render();
    }
  } catch (err) {
    console.error('Failed to load room media:', err);
  }
}

// ==================== FILE UPLOAD ====================
btnChooseFiles.addEventListener('click', (e) => {
  e.stopPropagation();
  filePicker.click();
});
dropArea.addEventListener('click', () => filePicker.click());

filePicker.addEventListener('change', (e) => {
  handleFiles(e.target.files);
  filePicker.value = '';
});

['dragenter', 'dragover'].forEach(name => {
  dropArea.addEventListener(name, (e) => {
    e.preventDefault();
    e.stopPropagation();
    dropArea.classList.add('dragover');
  });
});

['dragleave', 'drop'].forEach(name => {
  dropArea.addEventListener(name, (e) => {
    e.preventDefault();
    e.stopPropagation();
    dropArea.classList.remove('dragover');
  });
});

dropArea.addEventListener('drop', (e) => {
  const dt = e.dataTransfer;
  handleFiles(dt.files);
});

async function handleFiles(files) {
  if (!currentPin) {
    alert('Please join or create a PIN room first!');
    return;
  }
  if (!files || files.length === 0) return;

  uploadProgress = 0;
  render();

  try {
    const uploadedItems = [];
    const totalFiles = files.length;
    const CLOUD_NAME = 'diubhg6ri';
    const UPLOAD_PRESET = 'alphabeta_uploads';

    for (let i = 0; i < totalFiles; i++) {
      const file = files[i];
      if (!file) continue;
      const fileMime = file.type || '';
      const isVideo = fileMime.startsWith('video') || /\.(mp4|mov|webm|mkv|avi)$/i.test(file.name || '');
      const resourceType = isVideo ? 'video' : 'image';

      const formData = new FormData();
      formData.append('file', file);
      formData.append('upload_preset', UPLOAD_PRESET);
      formData.append('folder', `rooms/${currentPin}`);

      const cloudinaryRes = await new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('POST', `https://api.cloudinary.com/v1_1/${CLOUD_NAME}/${resourceType}/upload`, true);

        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable) {
            const filePercent = (e.loaded / e.total) * 100;
            const totalPercent = Math.round(((i + (filePercent / 100)) / totalFiles) * 100);
            updateUploadCardProgress(totalPercent);
          }
        };

        xhr.onload = () => {
          console.log('Cloudinary status:', xhr.status, xhr.responseText);
          if (xhr.status >= 200 && xhr.status < 300) {
            try {
              const resData = JSON.parse(xhr.responseText);
              resolve(resData);
            } catch (e) {
              reject(new Error('Invalid response from Cloudinary: ' + e.message));
            }
          } else {
            try {
              const errData = JSON.parse(xhr.responseText);
              reject(new Error(errData.error?.message || `Cloudinary error ${xhr.status}`));
            } catch (e) {
              reject(new Error(`Upload failed with status ${xhr.status}: ${xhr.responseText}`));
            }
          }
        };

        xhr.onerror = (err) => {
          console.error('Cloudinary network error:', err);
          reject(new Error('Network error uploading directly to Cloudinary'));
        };
        xhr.ontimeout = () => {
          reject(new Error('Cloudinary upload timed out'));
        };
        xhr.send(formData);
      });

      uploadedItems.push({
        id: `media_${Date.now()}_${i}`,
        filename: file.name,
        originalName: file.name,
        mimeType: file.type || (isVideo ? 'video/mp4' : 'image/jpeg'),
        type: isVideo ? 'video' : 'photo',
        size: file.size,
        url: cloudinaryRes.secure_url || cloudinaryRes.url,
        uploadedAt: new Date().toISOString()
      });
    }

    console.log('Uploaded to Cloudinary successfully:', uploadedItems);

    // Save media metadata to MongoDB Atlas (with a safety timeout)
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 8000);
      const saveRes = await fetch(`/api/room/${encodeURIComponent(currentPin)}/media-saved`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: uploadedItems }),
        signal: controller.signal
      });
      clearTimeout(timeoutId);
      if (!saveRes.ok) {
        console.warn('Backend metadata save returned:', saveRes.status);
      }
    } catch (saveErr) {
      console.warn('Metadata save error (displaying locally anyway):', saveErr);
    }

    uploadProgress = null;
    allMedia.unshift(...uploadedItems);
    render();
    return;
  } catch (err) {
    if (err.message !== 'FALLBACK_SERVER_UPLOAD') {
      console.error('Direct upload error:', err);
      uploadProgress = null;
      render();
      alert('Upload failed: ' + (err.message || 'Error uploading file'));
      return;
    }
  }

  // 2. Server upload fallback (for local development)
  const formData = new FormData();
  for (let i = 0; i < files.length; i++) {
    formData.append('files', files[i]);
  }

  const xhr = new XMLHttpRequest();
  xhr.open('POST', `/api/room/${encodeURIComponent(currentPin)}/upload`, true);

  xhr.upload.onprogress = (e) => {
    if (e.lengthComputable) {
      uploadProgress = Math.round((e.loaded / e.total) * 100);
      updateUploadCardProgress(uploadProgress);
    }
  };

  xhr.onload = () => {
    uploadProgress = null;
    if (xhr.status === 200) {
      const res = JSON.parse(xhr.responseText);
      const newItems = res.items.filter(item => !allMedia.some(m => m.id === item.id));
      allMedia.unshift(...newItems);
      render();
    } else {
      render();
      alert('Upload failed: ' + xhr.responseText);
    }
  };

  xhr.onerror = () => {
    uploadProgress = null;
    render();
    alert('Upload network error.');
  };

  xhr.send(formData);
}

function updateUploadCardProgress(percent) {
  const fill = document.getElementById('uploadProgressFill');
  const label = document.getElementById('uploadProgressLabel');
  if (fill) fill.style.width = `${percent}%`;
  if (label) label.textContent = `Uploading... ${percent}%`;
}

// ==================== RENDER FEED ====================
function render() {
  let html = '';

  if (uploadProgress !== null) {
    const isMobile = window.innerWidth <= 768;
    html += `
      <div class="card-item uploading-card">
        <div class="upload-title" id="uploadProgressLabel">Uploading... ${uploadProgress}%</div>
        ${isMobile ? `
          <div class="upload-mobile-spinner"></div>
        ` : `
          <div class="hand-progress-track">
            <div class="hand-progress-fill" id="uploadProgressFill" style="width: ${uploadProgress}%;"></div>
          </div>
        `}
      </div>
    `;
  }

  if (allMedia.length === 0 && uploadProgress === null) {
    emptyNotice.style.display = 'block';
  } else {
    emptyNotice.style.display = 'none';
  }

  allMedia.forEach((item, index) => {
    const borderColor = PASTEL_BORDERS[index % PASTEL_BORDERS.length];
    const isVideo = item.type === 'video';
    const originalName = item.originalName || 'Untitled Media';
    const views = (index * 3 + 4) % 15 + 2;

    html += `
      <div class="card-item" style="--border-theme: ${borderColor};">
        <div class="card-media-box" onclick="openModal('${item.id}')">
          ${isVideo ? `
            <video class="card-video" src="${item.url}#t=0.1" preload="metadata" muted playsinline></video>
            <div class="card-overlay-play">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>
            </div>
            <div class="video-duration-badge">
              <span>▶ 0:45</span>
            </div>
            <div class="live-badge">
              <span>🔥 Live Streaming</span>
            </div>
          ` : `
            <img class="card-img" src="${item.url}" alt="${originalName}" loading="lazy" />
          `}

          <button class="btn-card-trash" onclick="deleteMedia('${item.id}', event)" title="Delete">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2">
              <polyline points="3 6 5 6 21 6"></polyline>
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
            </svg>
          </button>
        </div>

        <div class="card-bottom-info">
          <div class="user-tag">
            <span class="avatar-circle">
              <svg width="10" height="10" viewBox="0 0 24 24" fill="#64748B"><circle cx="12" cy="8" r="5"></circle><path d="M20 21a8 8 0 1 0-16 0"></path></svg>
            </span>
            <span>Anonymous</span>
          </div>
          <div class="views-count">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>
            <span>${views} views</span>
          </div>
        </div>
      </div>
    `;
  });

  mediaGrid.innerHTML = html;
}

// Delete media
window.deleteMedia = async function(id, event) {
  event.stopPropagation();
  if (!currentPin) return;

  try {
    const res = await fetch(`/api/room/${encodeURIComponent(currentPin)}/media/${id}`, { method: 'DELETE' });
    if (res.ok) {
      allMedia = allMedia.filter(m => m.id !== id);
      render();
    }
  } catch (err) {
    console.error(err);
  }
};

// Modal Inspection
window.openModal = function(id) {
  const item = allMedia.find(m => m.id === id);
  if (!item) return;

  modalName.textContent = item.originalName;
  modalMeta.textContent = `Uploaded Just Now • ${formatBytes(item.size)}`;
  modalRawBtn.href = item.downloadUrl || item.url;

  if (item.type === 'video') {
    modalMedia.innerHTML = `
      <video src="${item.url}" controls autoplay playsinline style="max-height: 72vh; width: 100%;"></video>
    `;
  } else {
    modalMedia.innerHTML = `<img src="${item.url}" alt="${item.originalName}" />`;
  }

  viewModal.classList.add('active');
};

modalClose.addEventListener('click', () => {
  viewModal.classList.remove('active');
  modalMedia.innerHTML = '';
});
viewModal.addEventListener('click', (e) => {
  if (e.target === viewModal) {
    viewModal.classList.remove('active');
    modalMedia.innerHTML = '';
  }
});

// Share & QR
btnCopy.addEventListener('click', () => {
  navigator.clipboard.writeText(window.location.href);
  btnCopyLabel.textContent = 'Copied!';
  setTimeout(() => (btnCopyLabel.textContent = 'Copy Link'), 2000);
});

btnShowQr.addEventListener('click', () => {
  if (window.QRCode) {
    QRCode.toCanvas(qrCanvas, window.location.href, { width: 190, margin: 1 });
  }
  qrModal.classList.add('active');
});

qrClose.addEventListener('click', () => qrModal.classList.remove('active'));
qrModal.addEventListener('click', (e) => {
  if (e.target === qrModal) qrModal.classList.remove('active');
});

let toastTimer = null;
function popToast(html) {
  toastMessage.innerHTML = html;
  liveToast.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    liveToast.classList.add('hidden');
  }, 4500);
}

function formatBytes(bytes) {
  if (!+bytes) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

// Always force the lockscreen PIN keypad every single time the page is opened or reloaded
function startApp() {
  // Wipe any residual PIN from memory / history
  window.history.replaceState({}, '', window.location.pathname);
  showPinGateway();
}

initSocket();
startApp();
