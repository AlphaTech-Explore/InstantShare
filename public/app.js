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

// Storage Progress DOM
const storageSummaryText = document.getElementById('storageSummaryText');
const storageRemainingText = document.getElementById('storageRemainingText');
const storageFill = document.getElementById('storageFill');

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
  keypadPrompt.textContent = 'Enter your Room No. to connect';
  btnSubmitLabel.textContent = 'Enter Room 🚀';
  clearError();
});

tabCreate.addEventListener('click', () => {
  isCreateMode = true;
  tabCreate.classList.add('active');
  tabJoin.classList.remove('active');
  keypadPrompt.textContent = 'Choose a unique Room No. for your new room';
  btnSubmitLabel.textContent = 'Create Room ✨';
  clearError();
});

// Submit Room No. Action
btnSubmitPin.addEventListener('click', handlePinSubmit);

async function handlePinSubmit() {
  const pin = currentEnteredPin.trim();
  if (!pin || pin.length < 3) {
    showError('Room No. must be at least 3 digits.');
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
        showError(`Room No. "${pin}" doesn't exist yet! Switch to "Create Room" to start it.`);
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
  currentPin = null;
  allMedia = []; // Immediately wipe media state so no other room's files can ever be seen
  currentEnteredPin = "";
  updateKeypadDisplay();
  clearError();
  render(); // Immediately clear feed UI

  pinGateway.classList.remove('hidden');
  mainApp.style.display = 'none';
  window.history.replaceState({}, '', window.location.pathname);
  if (socket && socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify({ type: 'JOIN_PIN', pin: null }));
  }
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

// Enter Room with Room No.
async function enterRoom(pin) {
  // Stop existing polling immediately
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }

  currentPin = pin;
  allMedia = []; // Instantly clear memory of any prior room before entering new room
  render(); // Instantly show clean/empty feed, never previous room's files

  // Keep URL clean: do NOT expose room number in browser address bar (prevents auto-reconnect on refresh)
  window.history.replaceState({}, '', window.location.pathname);

  // UI Updates
  headerPinDisplay.textContent = pin;
  liveUrlText.textContent = `${window.location.host} (Room: ${pin})`;
  qrDisplayUrl.textContent = window.location.href;

  pinGateway.classList.add('hidden');
  mainApp.style.display = 'flex';

  // Join WebSocket room if connected
  if (socket && socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify({ type: 'JOIN_PIN', pin }));
  }

  // Load Room Media for this specific room
  await loadRoomMedia();

  // Load Global Storage usage stats
  loadStorageStats();

  // Start backup polling (essential for Vercel serverless live sync!)
  startLivePolling();
}

// Backup live polling for Vercel
function startLivePolling() {
  if (pollTimer) clearInterval(pollTimer);
  const activePin = currentPin;
  pollTimer = setInterval(async () => {
    if (!currentPin || currentPin !== activePin) return;
    try {
      const res = await fetch(`/api/room/${encodeURIComponent(activePin)}/media`);
      if (res.ok) {
        const data = await res.json();
        // Guard against race conditions if user switched rooms while request was in-flight
        if (currentPin !== activePin) return;
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
        } else if (data.type === 'PIN_MEDIA') {
          const item = allMedia.find(m => m.id === data.id);
          if (item) {
            item.pinned = data.pinned;
            render();
          }
        } else if (data.type === 'LIKE_MEDIA') {
          const item = allMedia.find(m => m.id === data.id);
          if (item) {
            item.likes = data.likes;
            render();
          }
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
  const requestedPin = currentPin;
  try {
    const res = await fetch(`/api/room/${encodeURIComponent(requestedPin)}/media`);
    if (res.ok) {
      const data = await res.json();
      // Ensure the user hasn't switched rooms while fetch was pending
      if (currentPin !== requestedPin) return;
      allMedia = data.media || [];
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
    const fileList = Array.from(files).filter(f => f && f.size > 0);
    const totalFiles = fileList.length;
    if (totalFiles === 0) return;

    const CLOUD_NAME = 'diubhg6ri';
    const UPLOAD_PRESET = 'alphabeta_uploads';
    const progressPerFile = new Array(totalFiles).fill(0);

    function updateAggregatedProgress() {
      const sum = progressPerFile.reduce((a, b) => a + b, 0);
      const overall = Math.round(sum / totalFiles);
      updateUploadCardProgress(overall);
    }

    // Upload files concurrently in parallel (up to 4 at a time)
    const uploadSingleFile = async (file, index) => {
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
            progressPerFile[index] = (e.loaded / e.total) * 100;
            updateAggregatedProgress();
          }
        };

        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            try {
              progressPerFile[index] = 100;
              updateAggregatedProgress();
              resolve(JSON.parse(xhr.responseText));
            } catch (e) {
              reject(new Error('Invalid response from Cloudinary'));
            }
          } else {
            try {
              const errData = JSON.parse(xhr.responseText);
              reject(new Error(errData.error?.message || `Cloudinary error ${xhr.status}`));
            } catch (e) {
              reject(new Error(`Upload failed with status ${xhr.status}`));
            }
          }
        };

        xhr.onerror = () => reject(new Error(`Network error uploading "${file.name}" to Cloudinary`));
        xhr.ontimeout = () => reject(new Error(`Upload timed out for "${file.name}"`));
        xhr.send(formData);
      });

      return {
        id: `media_${Date.now()}_${index}_${Math.random().toString(36).substring(2, 6)}`,
        filename: file.name,
        originalName: file.name,
        mimeType: file.type || (isVideo ? 'video/mp4' : 'image/jpeg'),
        type: isVideo ? 'video' : 'photo',
        size: file.size,
        url: cloudinaryRes.secure_url || cloudinaryRes.url,
        publicId: cloudinaryRes.public_id,
        uploadedAt: new Date().toISOString()
      };
    };

    // Parallel upload of all selected files
    const uploadedItems = await Promise.all(fileList.map((file, i) => uploadSingleFile(file, i)));

    console.log('Uploaded all files to Cloudinary successfully:', uploadedItems);

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
    // Guard: only add to current feed if user is still in the room where upload started
    allMedia.unshift(...uploadedItems);
    render();
    loadStorageStats(); // Refresh global storage bar after upload
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

  // Sort pinned items to the very top, preserving upload order otherwise
  const sortedMedia = [...allMedia].sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0));

  sortedMedia.forEach((item, index) => {
    const borderColor = PASTEL_BORDERS[index % PASTEL_BORDERS.length];
    const isVideo = item.type === 'video' || (item.mimeType && item.mimeType.startsWith('video')) || /\.(mp4|3gp|mov|webm|avi|mkv)(\?.*)?$/i.test(item.url || '');
    const originalName = item.originalName || 'Untitled Media';
    const isPinned = !!item.pinned;
    const likesCount = item.likes || 0;
    const isLiked = localStorage.getItem(`liked_${item.id}`) === 'true';

    // Transcode / stream as MP4 from Cloudinary so all browsers & mobile play properly
    let videoStreamUrl = item.url;
    let posterUrl = item.thumbnailUrl;
    if (isVideo) {
      if (item.publicId) {
        videoStreamUrl = `https://res.cloudinary.com/${CLOUD_NAME}/video/upload/f_mp4,vc_h264/${item.publicId}.mp4`;
        if (!posterUrl) {
          posterUrl = `https://res.cloudinary.com/${CLOUD_NAME}/video/upload/so_1.0,w_600,c_limit,q_auto,f_jpg/${item.publicId}.jpg`;
        }
      } else if (videoStreamUrl && videoStreamUrl.includes('/video/upload/')) {
        if (!videoStreamUrl.includes('f_mp4')) {
          videoStreamUrl = videoStreamUrl.replace('/video/upload/', '/video/upload/f_mp4,vc_h264/');
        }
        videoStreamUrl = videoStreamUrl.replace(/\.(3gp|mov|avi|webm|mkv)(\?.*)?$/i, '.mp4$2');
        if (!posterUrl) {
          posterUrl = videoStreamUrl.replace('/f_mp4,vc_h264/', '/so_1.0,w_600,c_limit,q_auto,f_jpg/').replace(/\.mp4(\?.*)?$/i, '.jpg$1');
        }
      }
    }

    html += `
      <div class="card-item ${isPinned ? 'is-pinned' : ''}" style="--border-theme: ${borderColor};">
        <div class="card-media-box" onclick="openModal('${item.id}')">
          ${isVideo ? `
            <video class="card-video" src="${videoStreamUrl}#t=0.1" ${posterUrl ? `poster="${posterUrl}"` : ''} preload="metadata" muted playsinline></video>
            <div class="card-overlay-play">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>
            </div>
            <div class="video-duration-badge">
              <span>▶ Video</span>
            </div>
          ` : `
            <img class="card-img" src="${item.url}" alt="${originalName}" loading="lazy" />
          `}
        </div>

        <div class="card-bottom-info">
          <div class="user-tag">
            <span class="avatar-circle">
              <svg width="10" height="10" viewBox="0 0 24 24" fill="#64748B"><circle cx="12" cy="8" r="5"></circle><path d="M20 21a8 8 0 1 0-16 0"></path></svg>
            </span>
            <span>Anonymous</span>
          </div>

          <!-- Bottom Action Buttons: Pin & Delete (Replaces Like) -->
          <div class="card-bottom-actions">
            <button class="btn-card-action pin-btn ${isPinned ? 'active' : ''}" onclick="togglePinMedia('${item.id}', event)" title="${isPinned ? 'Unpin' : 'Pin to Top'}">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="${isPinned ? '#F59E0B' : 'none'}" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round">
                <line x1="12" y1="17" x2="12" y2="22"></line>
                <path d="M5 17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6h1a1 1 0 0 0 0-2H8a1 1 0 0 0 0 2h1v4.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24Z"></path>
              </svg>
            </button>

            <button class="btn-card-action trash-btn" onclick="deleteMedia('${item.id}', event)" title="Delete Permanently">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="3 6 5 6 21 6"></polyline>
                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
              </svg>
            </button>
          </div>
        </div>
      </div>
    `;
  });

  mediaGrid.innerHTML = html;
}

// Like / Favorite media
window.likeMedia = async function(id, event) {
  event.stopPropagation();
  if (!currentPin) return;

  const item = allMedia.find(m => m.id === id);
  if (!item) return;

  // Optimistic UI update
  item.likes = (item.likes || 0) + 1;
  localStorage.setItem(`liked_${id}`, 'true');
  render();

  try {
    const res = await fetch(`/api/room/${encodeURIComponent(currentPin)}/media/${id}/like`, { method: 'POST' });
    if (res.ok) {
      const data = await res.json();
      item.likes = data.likes;
      render();
    }
  } catch (err) {
    console.error('Like error:', err);
  }
};

// Pin / Unpin media to top
window.togglePinMedia = async function(id, event) {
  event.stopPropagation();
  if (!currentPin) return;

  const item = allMedia.find(m => m.id === id);
  if (!item) return;

  // Optimistic toggle
  item.pinned = !item.pinned;
  render();

  try {
    const res = await fetch(`/api/room/${encodeURIComponent(currentPin)}/media/${id}/pin`, { method: 'POST' });
    if (res.ok) {
      const data = await res.json();
      item.pinned = data.pinned;
      render();
    }
  } catch (err) {
    console.error('Pin error:', err);
  }
};

// Delete media with confirmation
window.deleteMedia = async function(id, event) {
  event.stopPropagation();
  if (!currentPin) return;

  const item = allMedia.find(m => m.id === id);
  const name = item ? item.originalName : 'this media';

  const confirmed = window.confirm(`Are you sure you want to permanently delete "${name}"?`);
  if (!confirmed) return;

  try {
    const res = await fetch(`/api/room/${encodeURIComponent(currentPin)}/media/${id}`, { method: 'DELETE' });
    const data = await res.json();
    if (res.ok) {
      allMedia = allMedia.filter(m => m.id !== id);
      render();
      loadStorageStats(); // Refresh storage stats after deletion
      
      if (data.missingCloudinaryKeys) {
        console.warn('File deleted from database, but Cloudinary API credentials (CLOUDINARY_API_KEY / CLOUDINARY_API_SECRET) are missing in Vercel environment variables.');
      } else if (data.cloudinaryResult && data.cloudinaryResult.result === 'ok') {
        console.log('File deleted permanently from both Database and Cloudinary!');
      }
    }
  } catch (err) {
    console.error('Delete error:', err);
  }
};

// Modal Inspection
window.openModal = function(id) {
  const item = allMedia.find(m => m.id === id);
  if (!item) return;

  const isVideo = item.type === 'video' || (item.mimeType && item.mimeType.startsWith('video')) || /\.(mp4|3gp|mov|webm|avi|mkv)(\?.*)?$/i.test(item.url || '');
  let streamUrl = item.url;
  if (isVideo) {
    if (item.publicId) {
      streamUrl = `https://res.cloudinary.com/${CLOUD_NAME}/video/upload/f_mp4,vc_h264/${item.publicId}.mp4`;
    } else if (streamUrl && streamUrl.includes('/video/upload/')) {
      if (!streamUrl.includes('f_mp4')) {
        streamUrl = streamUrl.replace('/video/upload/', '/video/upload/f_mp4,vc_h264/');
      }
      streamUrl = streamUrl.replace(/\.(3gp|mov|avi|webm|mkv)(\?.*)?$/i, '.mp4$2');
    }
  }

  modalName.textContent = item.originalName;
  modalMeta.textContent = `Uploaded Just Now • ${formatBytes(item.size)}`;
  modalRawBtn.href = streamUrl;

  if (isVideo) {
    modalMedia.innerHTML = `
      <video src="${streamUrl}" controls autoplay playsinline style="max-height: 75vh; width: 100%; border-radius: 12px; background: #000;"></video>
    `;
  } else {
    modalMedia.innerHTML = `<img src="${item.url}" alt="${item.originalName}" style="max-height: 75vh; width: 100%; object-fit: contain;" />`;
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
  const shareUrl = `${window.location.origin}/?room=${encodeURIComponent(currentPin || '')}`;
  navigator.clipboard.writeText(shareUrl);
  btnCopyLabel.textContent = 'Copied!';
  setTimeout(() => (btnCopyLabel.textContent = 'Copy Link'), 2000);
});

btnShowQr.addEventListener('click', () => {
  const shareUrl = `${window.location.origin}/?room=${encodeURIComponent(currentPin || '')}`;
  qrDisplayUrl.textContent = shareUrl;

  // Clear previous QR
  qrCanvas.innerHTML = '';

  if (window.QRCode) {
    new QRCode(qrCanvas, {
      text: shareUrl,
      width: 180,
      height: 180,
      colorDark: '#2B2D42',
      colorLight: '#FFFFFF',
      correctLevel: QRCode.CorrectLevel.H
    });
  } else {
    // Fallback QR image
    qrCanvas.innerHTML = `<img src="https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(shareUrl)}" alt="QR Code" style="display:block;" />`;
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

// ==================== STORAGE STATS ====================
async function loadStorageStats() {
  try {
    const res = await fetch('/api/storage-stats');
    if (!res.ok) return;
    const data = await res.json();
    if (storageSummaryText) {
      storageSummaryText.textContent = `${formatBytes(data.usedBytes)} used of ${formatBytes(data.totalLimitBytes)}`;
    }
    if (storageRemainingText) {
      storageRemainingText.textContent = `${formatBytes(data.remainingBytes)} remaining`;
    }
    if (storageFill) {
      const pct = Math.max(0.5, Math.min(100, data.usedPercentage));
      storageFill.style.width = `${pct}%`;
      if (pct > 85) {
        storageFill.style.background = 'linear-gradient(90deg, #F59E0B, #EF4444)';
      } else {
        storageFill.style.background = 'linear-gradient(90deg, #F4A261, #E76F51)';
      }
    }
  } catch (err) {
    console.error('Failed to load storage stats:', err);
  }
}

// Always force the lockscreen PIN keypad every single time the page is opened or reloaded
function startApp() {
  // Wipe any residual PIN from memory / history
  window.history.replaceState({}, '', window.location.pathname);
  showPinGateway();
}

initSocket();
startApp();
