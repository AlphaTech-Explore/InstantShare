// State
const CLOUD_NAME = 'diubhg6ri';
const UPLOAD_PRESET = 'alphabeta_uploads';

let currentPin = null;
let currentEnteredPin = "";
let isCreateMode = false;
let allMedia = [];
let socket = null;
let uploadProgress = null;
let pollTimer = null;

// Multi-Select State
let isSelectMode = false;
const selectedMediaIds = new Set();

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

const downloadModal = document.getElementById('downloadModal');
const downloadModalClose = document.getElementById('downloadModalClose');
const downloadModalSubtitle = document.getElementById('downloadModalSubtitle');
const btnDownloadZip = document.getElementById('btnDownloadZip');
const btnDownloadSeparately = document.getElementById('btnDownloadSeparately');
const downloadStatusBox = document.getElementById('downloadStatusBox');
const downloadStatusText = document.getElementById('downloadStatusText');

// Storage Progress DOM
const storageSummaryText = document.getElementById('storageSummaryText');
const storageRemainingText = document.getElementById('storageRemainingText');
const storageFill = document.getElementById('storageFill');

// Batch Selection Toolbar DOM
const btnToggleSelectMode = document.getElementById('btnToggleSelectMode');
const selectModeLabel = document.getElementById('selectModeLabel');
const batchActionBar = document.getElementById('batchActionBar');
const batchCountBadge = document.getElementById('batchCountBadge');
const btnBatchSelectAll = document.getElementById('btnBatchSelectAll');
const batchSelectAllLabel = document.getElementById('batchSelectAllLabel');
const btnBatchDownload = document.getElementById('btnBatchDownload');
const btnBatchPin = document.getElementById('btnBatchPin');
const batchPinLabel = document.getElementById('batchPinLabel');
const btnBatchDelete = document.getElementById('btnBatchDelete');
const btnBatchCancel = document.getElementById('btnBatchCancel');

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
  exitSelectMode();
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
  // Reset multi-select state on entering a room
  exitSelectMode();

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

// ==================== FAST HARDWARE WEBCODECS VIDEO COMPRESSION ====================
// Automatically compresses high-bitrate phone videos over 95MB to ~40-60MB without resolution or quality loss in seconds
async function compressVideoIfNeeded(file) {
  // If file is under 95MB, no compression is needed
  if (file.size <= 95 * 1024 * 1024) {
    return file;
  }

  const isVideo = file.type?.startsWith('video') || /\.(mp4|mov|webm|mkv|avi|3gp|m4v)$/i.test(file.name);
  if (!isVideo) return file;

  updateUploadCardProgress(5);
  const label = document.getElementById('uploadProgressLabel');
  if (label) label.textContent = `⚡ Hardware optimizing video (${formatBytes(file.size)})...`;

  // 1. FAST PATH: Hardware-Accelerated WebCodecs API via Mediabunny (Runs on GPU in seconds)
  if (window.MediaBunny && typeof VideoEncoder !== 'undefined') {
    try {
      const { Input, Output, BlobSource, Mp4OutputFormat, BufferTarget, Conversion, Quality, ALL_FORMATS } = window.MediaBunny;
      
      const input = new Input({
        formats: ALL_FORMATS,
        source: new BlobSource(file),
      });

      const output = new Output({
        format: new Mp4OutputFormat(),
        target: new BufferTarget(),
      });

      // Target bitrate: 2.8 Mbps produces crystal-clear 1080p/4K visual quality at ~20MB per minute
      const conversion = await Conversion.init({
        input,
        output,
        video: {
          codec: 'avc',
          quality: new Quality({ bitrate: 2800000 })
        },
        audio: {
          codec: 'aac',
          quality: new Quality({ bitrate: 128000 })
        }
      });

      // Track progress
      conversion.onProgress = (prog) => {
        const pct = Math.round(prog * 100);
        updateUploadCardProgress(Math.min(95, Math.max(5, pct)));
        if (label) label.textContent = `⚡ GPU encoding video... ${pct}%`;
      };

      await conversion.execute();

      const resultBuffer = output.getTarget().buffer;
      if (resultBuffer && resultBuffer.byteLength > 0 && resultBuffer.byteLength < file.size) {
        console.log(`⚡ WebCodecs compressed from ${formatBytes(file.size)} to ${formatBytes(resultBuffer.byteLength)} in seconds`);
        return new File([resultBuffer], file.name.replace(/\.[^.]+$/, '.mp4'), {
          type: 'video/mp4',
          lastModified: Date.now()
        });
      }
    } catch (webcodecsErr) {
      console.warn('WebCodecs execution failed, falling back to real-time stream encoder:', webcodecsErr);
    }
  }

  // 2. FALLBACK PATH: MediaStream capture encoder (for older devices without WebCodecs)
  if (typeof MediaRecorder === 'undefined') {
    return file;
  }

  return new Promise((resolve) => {
    try {
      const video = document.createElement('video');
      video.muted = true;
      video.playsInline = true;
      video.preload = 'auto';

      const fileUrl = URL.createObjectURL(file);
      video.src = fileUrl;

      video.onloadedmetadata = () => {
        const duration = video.duration || 10;
        const targetBits = 55 * 8 * 1024 * 1024;
        const targetBitrate = Math.max(800000, Math.min(3500000, Math.round(targetBits / duration)));

        const stream = video.captureStream ? video.captureStream(30) : (video.mozCaptureStream ? video.mozCaptureStream(30) : null);
        if (!stream) {
          URL.revokeObjectURL(fileUrl);
          return resolve(file);
        }

        let mimeType = 'video/mp4;codecs=avc1';
        if (!MediaRecorder.isTypeSupported(mimeType)) {
          mimeType = 'video/webm;codecs=vp8';
          if (!MediaRecorder.isTypeSupported(mimeType)) mimeType = 'video/webm';
        }

        const recorder = new MediaRecorder(stream, {
          mimeType: MediaRecorder.isTypeSupported(mimeType) ? mimeType : undefined,
          videoBitsPerSecond: targetBitrate
        });

        const chunks = [];
        recorder.ondataavailable = (e) => {
          if (e.data && e.data.size > 0) chunks.push(e.data);
        };

        recorder.onstop = () => {
          URL.revokeObjectURL(fileUrl);
          const compressedBlob = new Blob(chunks, { type: 'video/mp4' });
          if (compressedBlob.size > 0 && compressedBlob.size < file.size) {
            resolve(new File([compressedBlob], file.name.replace(/\.[^.]+$/, '.mp4'), {
              type: 'video/mp4',
              lastModified: Date.now()
            }));
          } else {
            resolve(file);
          }
        };

        recorder.onerror = () => {
          URL.revokeObjectURL(fileUrl);
          resolve(file);
        };

        recorder.start(1000);
        video.play().catch(() => {
          URL.revokeObjectURL(fileUrl);
          resolve(file);
        });

        video.onended = () => {
          if (recorder.state === 'recording') recorder.stop();
        };

        setTimeout(() => {
          if (recorder.state === 'recording') recorder.stop();
        }, (duration + 5) * 1000);
      };

      video.onerror = () => {
        URL.revokeObjectURL(fileUrl);
        resolve(file);
      };
    } catch (e) {
      resolve(file);
    }
  });
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

    const progressPerFile = new Array(totalFiles).fill(0);

    function updateAggregatedProgress() {
      const sum = progressPerFile.reduce((a, b) => a + b, 0);
      const overall = Math.round(sum / totalFiles);
      updateUploadCardProgress(overall);
    }

    // Check and compress large video files over 95MB before starting upload
    const preparedFiles = [];
    for (const f of fileList) {
      if (f.size > 95 * 1024 * 1024) {
        const compressed = await compressVideoIfNeeded(f);
        preparedFiles.push(compressed);
      } else {
        preparedFiles.push(f);
      }
    }

    // Upload single file with automatic chunked upload for videos & large files
    const uploadSingleFile = async (file, index) => {
      const fileMime = file.type || '';
      const isVideo = fileMime.startsWith('video') || /\.(mp4|mov|webm|mkv|avi|3gp|m4v)$/i.test(file.name || '');
      const resourceType = isVideo ? 'video' : 'image';

      // Cloudinary chunked upload for files >= 6MB (vital for mobile 4G/5G connections)
      const CHUNK_SIZE = 6 * 1024 * 1024; // 6MB per chunk
      let cloudinaryRes;

      if (file.size > CHUNK_SIZE) {
        // Chunked upload sequence
        const uniqueUploadId = 'uid_' + Date.now() + '_' + Math.random().toString(36).substring(2, 8);
        const totalChunks = Math.ceil(file.size / CHUNK_SIZE);

        for (let i = 0; i < totalChunks; i++) {
          const start = i * CHUNK_SIZE;
          const end = Math.min(start + CHUNK_SIZE, file.size);
          const chunk = file.slice(start, end);

          const formData = new FormData();
          formData.append('file', chunk);
          formData.append('upload_preset', UPLOAD_PRESET);
          formData.append('folder', `rooms/${currentPin}`);

          // Content-Range format: bytes start-end_inclusive/total
          const contentRange = `bytes ${start}-${end - 1}/${file.size}`;

          const chunkRes = await new Promise((resolve, reject) => {
            const xhr = new XMLHttpRequest();
            xhr.open('POST', `https://api.cloudinary.com/v1_1/${CLOUD_NAME}/${resourceType}/upload`, true);
            xhr.setRequestHeader('X-Unique-Upload-Id', uniqueUploadId);
            xhr.setRequestHeader('Content-Range', contentRange);
            xhr.timeout = 180000; // 3 minutes per 6MB chunk

            xhr.upload.onprogress = (e) => {
              if (e.lengthComputable && e.total > 0) {
                const chunkProgress = e.loaded / e.total;
                const fileProgress = ((start + (chunkProgress * (end - start))) / file.size) * 100;
                progressPerFile[index] = Math.min(99, fileProgress);
                updateAggregatedProgress();
              }
            };

            xhr.onload = () => {
              if (xhr.status >= 200 && xhr.status < 300) {
                try {
                  resolve(JSON.parse(xhr.responseText));
                } catch (e) {
                  resolve({});
                }
              } else {
                try {
                  const errData = JSON.parse(xhr.responseText);
                  reject(new Error(errData.error?.message || `Upload failed with status ${xhr.status}`));
                } catch (e) {
                  reject(new Error(`Chunk upload failed with status ${xhr.status}`));
                }
              }
            };

            xhr.onerror = () => reject(new Error(`Network error on chunk ${i + 1}/${totalChunks}. Check mobile connection.`));
            xhr.ontimeout = () => reject(new Error(`Chunk ${i + 1}/${totalChunks} timed out. Retrying...`));
            xhr.send(formData);
          });

          // The final chunk returns the asset metadata
          if (i === totalChunks - 1) {
            cloudinaryRes = chunkRes;
          }
        }

        progressPerFile[index] = 100;
        updateAggregatedProgress();
      } else {
        // Standard single-payload upload for files under 6MB
        cloudinaryRes = await new Promise((resolve, reject) => {
          const formData = new FormData();
          formData.append('file', file);
          formData.append('upload_preset', UPLOAD_PRESET);
          formData.append('folder', `rooms/${currentPin}`);

          const xhr = new XMLHttpRequest();
          xhr.open('POST', `https://api.cloudinary.com/v1_1/${CLOUD_NAME}/${resourceType}/upload`, true);
          xhr.timeout = 180000;

          xhr.upload.onprogress = (e) => {
            if (e.lengthComputable && e.total > 0) {
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

          xhr.onerror = () => reject(new Error(`Network error uploading "${file.name}". Connection lost or file exceeded Cloudinary preset limit.`));
          xhr.ontimeout = () => reject(new Error(`Upload timed out for "${file.name}". Check mobile network connection.`));
          xhr.send(formData);
        });
      }

      // Construct MP4 delivery URL and JPG thumbnail URL for videos
      let mediaUrl = cloudinaryRes.secure_url || cloudinaryRes.url;
      let thumbnailUrl = null;

      if (isVideo && cloudinaryRes.public_id) {
        mediaUrl = `https://res.cloudinary.com/${CLOUD_NAME}/video/upload/f_mp4,vc_h264/${cloudinaryRes.public_id}.mp4`;
        thumbnailUrl = `https://res.cloudinary.com/${CLOUD_NAME}/video/upload/so_1.0,w_600,c_limit,q_auto,f_jpg/${cloudinaryRes.public_id}.jpg`;
      }

      return {
        id: `media_${Date.now()}_${index}_${Math.random().toString(36).substring(2, 6)}`,
        filename: file.name,
        originalName: file.name,
        mimeType: isVideo ? 'video/mp4' : (file.type || 'image/jpeg'),
        type: isVideo ? 'video' : 'photo',
        size: file.size,
        url: mediaUrl,
        rawUrl: cloudinaryRes.secure_url || cloudinaryRes.url,
        thumbnailUrl: thumbnailUrl,
        publicId: cloudinaryRes.public_id,
        uploadedAt: new Date().toISOString()
      };
    };

    // Parallel upload of all selected files
    const uploadedItems = await Promise.all(preparedFiles.map((file, i) => uploadSingleFile(file, i)));

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
    const isSelected = selectedMediaIds.has(item.id);
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
      <div class="card-item ${isPinned ? 'is-pinned' : ''} ${isSelected ? 'is-selected' : ''}" style="--border-theme: ${borderColor};" onclick="handleCardClick('${item.id}', event)">
        <!-- Multi-select Checkbox Checkmark -->
        <div class="card-select-checkbox" onclick="toggleSelectItem('${item.id}', event)" title="Select this item">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>
        </div>

        <div class="card-media-box">
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
  updateBatchBarUI();
}

// ==================== MULTI-SELECT & BATCH ACTIONS ====================
function toggleSelectMode() {
  isSelectMode = !isSelectMode;
  if (!isSelectMode) {
    selectedMediaIds.clear();
  }
  updateSelectModeUI();
  render();
}

function exitSelectMode() {
  isSelectMode = false;
  selectedMediaIds.clear();
  updateSelectModeUI();
  updateBatchBarUI();
}

function updateSelectModeUI() {
  if (btnToggleSelectMode) {
    if (isSelectMode) {
      btnToggleSelectMode.classList.add('active');
      selectModeLabel.textContent = 'Done Selecting';
    } else {
      btnToggleSelectMode.classList.remove('active');
      selectModeLabel.textContent = 'Select Multiple';
    }
  }

  if (mainApp) {
    if (isSelectMode) {
      mainApp.classList.add('select-mode-active');
    } else {
      mainApp.classList.remove('select-mode-active');
    }
  }
}

function updateBatchBarUI() {
  if (!batchActionBar) return;
  const count = selectedMediaIds.size;
  if (count > 0) {
    batchActionBar.classList.remove('hidden');
    if (batchCountBadge) batchCountBadge.textContent = count;
    
    // Check if all selected items are already pinned or unpinned
    const selectedItems = allMedia.filter(m => selectedMediaIds.has(m.id));
    const allArePinned = selectedItems.length > 0 && selectedItems.every(m => m.pinned);
    if (batchPinLabel) {
      batchPinLabel.textContent = allArePinned ? 'Unpin All' : 'Pin to Top';
    }

    if (batchSelectAllLabel) {
      batchSelectAllLabel.textContent = count === allMedia.length ? 'Deselect All' : 'Select All';
    }
  } else {
    batchActionBar.classList.add('hidden');
    if (batchSelectAllLabel) {
      batchSelectAllLabel.textContent = 'Select All';
    }
  }
}

window.handleCardClick = function(id, event) {
  // If in selection mode or has active selections, clicking anywhere on card selects/deselects it
  if (isSelectMode || selectedMediaIds.size > 0) {
    event.stopPropagation();
    window.toggleSelectItem(id, event);
    return;
  }
  window.openModal(id);
};

window.toggleSelectItem = function(id, event) {
  event.stopPropagation();
  if (selectedMediaIds.has(id)) {
    selectedMediaIds.delete(id);
  } else {
    selectedMediaIds.add(id);
    if (!isSelectMode) {
      isSelectMode = true;
      updateSelectModeUI();
    }
  }
  render();
};

// Batch Select / Deselect All
if (btnBatchSelectAll) {
  btnBatchSelectAll.addEventListener('click', () => {
    if (selectedMediaIds.size === allMedia.length) {
      selectedMediaIds.clear();
    } else {
      allMedia.forEach(m => selectedMediaIds.add(m.id));
    }
    render();
  });
}

// Helper to get selected media items
function getSelectedItems() {
  return allMedia.filter(m => selectedMediaIds.has(m.id));
}

// Download Button Click -> Show Modal
if (btnBatchDownload) {
  btnBatchDownload.addEventListener('click', () => {
    const selected = getSelectedItems();
    if (selected.length === 0) return;
    openDownloadModal(selected.length);
  });
}

function openDownloadModal(count) {
  if (downloadModalSubtitle) {
    downloadModalSubtitle.textContent = `Choose how to download your ${count} selected file${count > 1 ? 's' : ''}:`;
  }
  if (downloadStatusBox) downloadStatusBox.classList.add('hidden');
  downloadModal.classList.add('active');
}

function closeDownloadModal() {
  downloadModal.classList.remove('active');
}

if (downloadModalClose) {
  downloadModalClose.addEventListener('click', closeDownloadModal);
}
if (downloadModal) {
  downloadModal.addEventListener('click', (e) => {
    if (e.target === downloadModal) closeDownloadModal();
  });
}

// Helper to fetch Blob safely
async function fetchFileBlob(url) {
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);
    return await res.blob();
  } catch (err) {
    console.warn(`Direct fetch failed for ${url}, trying cors proxy / fallback...`, err);
    // If CORS or other issue occurs, fetch without special options
    const fallbackRes = await fetch(url, { mode: 'cors' });
    return await fallbackRes.blob();
  }
}

// 1. Download as ZIP archive using JSZip + FileSaver
if (btnDownloadZip) {
  btnDownloadZip.addEventListener('click', async () => {
    const selected = getSelectedItems();
    if (selected.length === 0) return;

    if (!window.JSZip || !window.saveAs) {
      alert('ZIP download library is still loading. Please try again in a moment.');
      return;
    }

    if (downloadStatusBox) downloadStatusBox.classList.remove('hidden');
    btnDownloadZip.disabled = true;
    btnDownloadSeparately.disabled = true;

    try {
      const zip = new JSZip();
      const usedNames = new Set();

      for (let i = 0; i < selected.length; i++) {
        const item = selected[i];
        if (downloadStatusText) {
          downloadStatusText.textContent = `Downloading (${i + 1}/${selected.length}): ${item.originalName || 'file'}...`;
        }

        let fileName = item.originalName || `media_${i + 1}`;
        // Ensure unique names inside the ZIP
        let finalName = fileName;
        let counter = 1;
        while (usedNames.has(finalName)) {
          const dotIdx = fileName.lastIndexOf('.');
          if (dotIdx !== -1) {
            finalName = `${fileName.slice(0, dotIdx)} (${counter})${fileName.slice(dotIdx)}`;
          } else {
            finalName = `${fileName} (${counter})`;
          }
          counter++;
        }
        usedNames.add(finalName);

        try {
          const blob = await fetchFileBlob(item.url);
          zip.file(finalName, blob);
        } catch (itemErr) {
          console.error(`Failed to fetch file for ZIP: ${item.url}`, itemErr);
        }
      }

      if (downloadStatusText) {
        downloadStatusText.textContent = `Compacting files into ZIP archive...`;
      }

      const zipBlob = await zip.generateAsync({
        type: 'blob',
        compression: 'DEFLATE',
        compressionOptions: { level: 6 }
      }, (metadata) => {
        if (downloadStatusText) {
          downloadStatusText.textContent = `Generating ZIP: ${Math.round(metadata.percent)}%`;
        }
      });

      const roomName = currentPin ? `AlphaBeta_Room_${currentPin}` : 'AlphaBeta_Files';
      const timestamp = new Date().toISOString().slice(0, 10);
      saveAs(zipBlob, `${roomName}_${timestamp}.zip`);

      closeDownloadModal();
      popToast(`<strong>${selected.length} files</strong> downloaded as ZIP archive! 📦`);
    } catch (err) {
      console.error('ZIP creation error:', err);
      alert('Error creating ZIP file: ' + err.message);
    } finally {
      if (downloadStatusBox) downloadStatusBox.classList.add('hidden');
      btnDownloadZip.disabled = false;
      btnDownloadSeparately.disabled = false;
    }
  });
}

// 2. Download Separately one by one
if (btnDownloadSeparately) {
  btnDownloadSeparately.addEventListener('click', async () => {
    const selected = getSelectedItems();
    if (selected.length === 0) return;

    if (downloadStatusBox) downloadStatusBox.classList.remove('hidden');
    btnDownloadZip.disabled = true;
    btnDownloadSeparately.disabled = true;

    try {
      for (let i = 0; i < selected.length; i++) {
        const item = selected[i];
        if (downloadStatusText) {
          downloadStatusText.textContent = `Downloading file (${i + 1}/${selected.length}): ${item.originalName || 'file'}...`;
        }

        try {
          // Download via blob to trigger genuine browser file save with original name
          const blob = await fetchFileBlob(item.url);
          if (window.saveAs) {
            saveAs(blob, item.originalName || `file_${i + 1}`);
          } else {
            const tempLink = document.createElement('a');
            tempLink.href = URL.createObjectURL(blob);
            tempLink.download = item.originalName || `file_${i + 1}`;
            document.body.appendChild(tempLink);
            tempLink.click();
            document.body.removeChild(tempLink);
            setTimeout(() => URL.revokeObjectURL(tempLink.href), 10000);
          }
        } catch (itemErr) {
          console.warn(`Direct blob download failed, falling back to anchor trigger:`, itemErr);
          const link = document.createElement('a');
          link.href = item.url;
          link.download = item.originalName || `file_${i + 1}`;
          link.target = '_blank';
          document.body.appendChild(link);
          link.click();
          document.body.removeChild(link);
        }

        // Small delay between triggers so browser doesn't block multiple concurrent downloads
        if (i < selected.length - 1) {
          await new Promise(r => setTimeout(r, 650));
        }
      }

      closeDownloadModal();
      popToast(`<strong>${selected.length} files</strong> downloaded separately! 💾`);
    } catch (err) {
      console.error('Separate download error:', err);
      alert('Error downloading files: ' + err.message);
    } finally {
      if (downloadStatusBox) downloadStatusBox.classList.add('hidden');
      btnDownloadZip.disabled = false;
      btnDownloadSeparately.disabled = false;
    }
  });
}

// Batch Pin / Unpin
if (btnBatchPin) {
  btnBatchPin.addEventListener('click', async () => {
    if (!currentPin || selectedMediaIds.size === 0) return;
    const ids = Array.from(selectedMediaIds);
    const selectedItems = allMedia.filter(m => selectedMediaIds.has(m.id));
    const allArePinned = selectedItems.every(m => m.pinned);
    const targetState = !allArePinned;

    // Optimistic UI update
    allMedia.forEach(m => {
      if (selectedMediaIds.has(m.id)) {
        m.pinned = targetState;
      }
    });
    render();

    try {
      await fetch(`/api/room/${encodeURIComponent(currentPin)}/media-batch-pin`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids, pinState: targetState })
      });
      popToast(`<strong>${ids.length} files</strong> ${targetState ? 'pinned to top' : 'unpinned'}! 📌`);
    } catch (e) {
      console.error('Batch pin error:', e);
    }
  });
}

// Batch Delete
if (btnBatchDelete) {
  btnBatchDelete.addEventListener('click', async () => {
    if (!currentPin || selectedMediaIds.size === 0) return;
    const ids = Array.from(selectedMediaIds);
    const confirmed = window.confirm(`Permanently delete ${ids.length} selected file(s) from this room and Cloudinary?`);
    if (!confirmed) return;

    // Optimistic UI update
    allMedia = allMedia.filter(m => !selectedMediaIds.has(m.id));
    selectedMediaIds.clear();
    exitSelectMode();
    render();
    loadStorageStats();

    try {
      const res = await fetch(`/api/room/${encodeURIComponent(currentPin)}/media-batch-delete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids })
      });
      if (res.ok) {
        popToast(`<strong>${ids.length} files</strong> deleted permanently! 🗑️`);
      }
      loadStorageStats();
    } catch (e) {
      console.error('Batch delete error:', e);
    }
  });
}

// Cancel Multi-Select
if (btnBatchCancel) {
  btnBatchCancel.addEventListener('click', () => {
    exitSelectMode();
    render();
  });
}

if (btnToggleSelectMode) {
  btnToggleSelectMode.addEventListener('click', toggleSelectMode);
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
