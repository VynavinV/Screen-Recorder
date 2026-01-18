const mainVideo = document.getElementById('mainVideo');
const webcamVideo = document.getElementById('webcamVideo');
const webcamWrap = document.getElementById('webcamWrap');
const videoFrame = document.getElementById('videoFrame');
const gradBg = document.getElementById('gradBg');
const progress = document.getElementById('progress');
const clickMarkers = document.getElementById('clickMarkers');
const musicTrack = document.getElementById('musicTrack');
const captionsBox = document.getElementById('captionsBox');
const captionList = document.getElementById('captionList');
const timeDisp = document.getElementById('timeDisp');
const fileStatus = document.getElementById('fileStatus');
const clickStatus = document.getElementById('clickStatus');
const musicStatus = document.getElementById('musicStatus');

// Trim state
let trimEnabled = false;
let trimStart = 0;
let trimEnd = 0;
let isDraggingTrim = false;
let dragTarget = null;

let playing = false;
let zoomEnabled = true;
let zoomLevel = 2;
let zoomDuration = 1.0;
let zoomAnticipate = 0.5;
let zoomInSpeed = 0.4;
let zoomOutSpeed = 0.5;
let easingStrength = 0.5;
let panSpeed = 1.0;
let panEasing = 0.5;
let clickThreshold = 0.15;
document.getElementById('clickThresholdSlider').oninput = function() {
    clickThreshold = parseFloat(this.value);
    document.getElementById('clickThresholdVal').textContent = clickThreshold.toFixed(2) + 's';
};
let webcamVisible = true;
let captionsOn = false;
let showBackground = true;
let clicks = [];
let captions = [];
let currentBg = 'linear-gradient(135deg,#667eea 0%,#764ba2 50%,#f093fb 100%)';

// Music state
let musicEnabled = false;
let musicVolume = 1.0;
let musicStart = 0;
let musicEnd = 0;
let musicPosition = 0;
let musicDuration = 0;
let musicAudio = null;
let isDraggingMusic = false;
let musicDragTarget = null;
let musicDragOffset = 0;

const params = new URLSearchParams(location.search);

function formatFileName(filename) {
    if (!filename) return '';
    let name = filename.replace(/\.[^/.]+$/, '');
    name = name.replace(/[_-]/g, ' ');
    name = name.replace(/\b\w/g, l => l.toUpperCase());
    return name.length > 25 ? name.substring(0, 22) + '...' : name;
}

function loadVideo(param, video, label) {
    const path = params.get(param);
    if (path) {
        const decoded = decodeURIComponent(path);
        video.src = 'file://' + decoded;
        return decoded.split('/').pop();
    }
    return null;
}

function updateFileStatus() {
    let status = [];
    const screenSrc = mainVideo.src;
    const webcamSrc = webcamVideo.src;

    if (screenSrc && !screenSrc.includes('blob:')) {
        const filename = decodeURIComponent(screenSrc).split('/').pop();
        status.push('📺 ' + formatFileName(filename));
    } else if (screenSrc) {
        status.push('📺 Imported Video');
    }

    if (webcamSrc && !webcamSrc.includes('blob:')) {
        const filename = decodeURIComponent(webcamSrc).split('/').pop();
        status.push('📹 ' + formatFileName(filename));
    } else if (webcamSrc) {
        status.push('📹 Imported Webcam');
    }

    if (status.length === 0) {
        fileStatus.textContent = 'No files loaded';
    } else {
        fileStatus.textContent = status.join(' | ');
    }
}

const screenFile = loadVideo('screen', mainVideo, 'Screen');
const webcamFile = loadVideo('webcam', webcamVideo, 'Webcam');

updateFileStatus();

if (!webcamFile) webcamWrap.classList.add('hidden');

const clicksPath = params.get('clicks');
if (clicksPath) {
    fetch('file://' + decodeURIComponent(clicksPath))
        .then(r => r.json())
        .then(data => {
            clicks = data;
            clickStatus.textContent = clicks.length + ' click points detected';
            renderClickMarkers();
        })
        .catch(() => clickStatus.textContent = 'No clicks data');
}

function renderClickMarkers() {
    clickMarkers.innerHTML = '';
    const dur = mainVideo.duration || 1;
    console.log('Rendering click markers - Duration:', dur, 'Clicks:', clicks.length);

    clicks.forEach((c, i) => {
        const m = document.createElement('div');
        m.className = 'click-marker';
        m.dataset.index = i;
        const percent = (c.time / dur * 100);
        m.style.left = percent + '%';
        m.title = 'Click at ' + c.time.toFixed(1) + 's';
        // click selects marker, double-click seeks to it
        m.addEventListener('click', (ev) => {
            ev.stopPropagation();
            selectClickMarker(i);
        });
        m.addEventListener('dblclick', (ev) => {
            ev.stopPropagation();
            mainVideo.currentTime = c.time;
            webcamVideo.currentTime = c.time;
        });
        clickMarkers.appendChild(m);
        if (i === 0) {
            console.log('First marker:', {time: c.time, dur, percent: percent + '%'});
        }
    });
    // update visual selection
    document.querySelectorAll('.click-marker').forEach(el => el.classList.remove('selected'));
    if (selectedClickIndex != null && clickMarkers.children[selectedClickIndex]) {
        clickMarkers.children[selectedClickIndex].classList.add('selected');
    }
    console.log('Rendered', clicks.length, 'markers to', clickMarkers);
}

mainVideo.onloadedmetadata = () => {
    renderClickMarkers();
    updateFileStatus();
    initializeTrim();
    renderMusicTrack();
};

// Trim functionality
function initializeTrim() {
    if (!mainVideo.duration) return;
    trimStart = 0;
    trimEnd = mainVideo.duration;
    updateTrimUI();
    // Seek the player to the trim start so user can preview immediately
    try { mainVideo.currentTime = trimStart; } catch (e) {}
}

function updateTrimUI() {
    const duration = mainVideo.duration || 1;
    const startPercent = (trimStart / duration) * 100;
    const endPercent = (trimEnd / duration) * 100;

    const leftHandle = document.getElementById('trimHandleLeft');
    const rightHandle = document.getElementById('trimHandleRight');
    const trimArea = document.getElementById('trimArea');
    const dimLeft = document.getElementById('trimDimLeft');
    const dimRight = document.getElementById('trimDimRight');

    leftHandle.style.left = startPercent + '%';
    rightHandle.style.left = endPercent + '%';

    trimArea.style.left = startPercent + '%';
    trimArea.style.width = (endPercent - startPercent) + '%';

    // Update dimmed gutters
    if (dimLeft && dimRight) {
        dimLeft.style.width = startPercent + '%';
        dimLeft.style.left = '0%';
        dimLeft.classList.toggle('hidden', !trimEnabled);

        dimRight.style.left = endPercent + '%';
        dimRight.style.width = (100 - endPercent) + '%';
        dimRight.classList.toggle('hidden', !trimEnabled);
    }

    document.getElementById('trimStartTime').textContent = 'Start: ' + fmt(trimStart);
    document.getElementById('trimEndTime').textContent = 'End: ' + fmt(trimEnd);

    const trimStatus = document.getElementById('trimStatus');
    if (trimEnabled) {
        const trimDuration = trimEnd - trimStart;
        trimStatus.textContent = `Trim: ${fmt(trimStart)} - ${fmt(trimEnd)} (${fmt(trimDuration)})`;
    } else {
        trimStatus.textContent = 'Trimming disabled';
    }
}

function setTrimStart() {
    const before = { start: trimStart, end: trimEnd };
    trimStart = mainVideo.currentTime;
    if (trimStart >= trimEnd) {
        trimEnd = Math.min(mainVideo.duration, trimStart + 1);
    }
    updateTrimUI();
    const after = { start: trimStart, end: trimEnd };
    pushAction({
        undo: () => { trimStart = before.start; trimEnd = before.end; updateTrimUI(); try { mainVideo.currentTime = trimStart; } catch(e){} },
        redo: () => { trimStart = after.start; trimEnd = after.end; updateTrimUI(); try { mainVideo.currentTime = trimStart; } catch(e){} },
        desc: 'Set trim start'
    });
}

function setTrimEnd() {
    const before = { start: trimStart, end: trimEnd };
    trimEnd = mainVideo.currentTime;
    if (trimEnd <= trimStart) {
        trimStart = Math.max(0, trimEnd - 1);
    }
    updateTrimUI();
    const after = { start: trimStart, end: trimEnd };
    pushAction({
        undo: () => { trimStart = before.start; trimEnd = before.end; updateTrimUI(); try { mainVideo.currentTime = trimStart; } catch(e){} },
        redo: () => { trimStart = after.start; trimEnd = after.end; updateTrimUI(); try { mainVideo.currentTime = trimStart; } catch(e){} },
        desc: 'Set trim end'
    });
}

function resetTrim() {
    trimStart = 0;
    trimEnd = mainVideo.duration || 0;
    updateTrimUI();
}

// Trim handle dragging
const trimHandleLeft = document.getElementById('trimHandleLeft');
const trimHandleRight = document.getElementById('trimHandleRight');
const timeline = document.getElementById('timeline');

function startTrimDrag(e, handle) {
    if (!trimEnabled) return;
    // capture previous trim values so we can push an undo action later
    dragPrevStart = trimStart;
    dragPrevEnd = trimEnd;
    isDraggingTrim = true;
    dragTarget = handle;
    e.preventDefault();
    e.stopPropagation();
}

function handleTrimDrag(e) {
    if (!isDraggingTrim || !trimEnabled) return;

    const rect = timeline.getBoundingClientRect();
    const x = e.clientX || (e.touches && e.touches[0].clientX);
    const percent = Math.max(0, Math.min(1, (x - rect.left) / rect.width));
    const time = percent * (mainVideo.duration || 1);

    if (dragTarget === 'left') {
        trimStart = Math.min(time, trimEnd - 0.1);
    } else {
        trimEnd = Math.max(time, trimStart + 0.1);
    }

    updateTrimUI();
}

function endTrimDrag() {
    // When user finishes dragging a trim handle, seek the player to that handle for preview
    if (isDraggingTrim && trimEnabled) {
        const before = { start: dragPrevStart, end: dragPrevEnd };
        const after = { start: trimStart, end: trimEnd };
        if (dragTarget === 'left') {
            try { mainVideo.currentTime = trimStart; } catch (e) {}
        } else if (dragTarget === 'right') {
            try { mainVideo.currentTime = trimEnd; } catch (e) {}
        }
        // push an undoable trim-change action if values changed
        if (before.start !== after.start || before.end !== after.end) {
            pushAction({
                undo: () => { trimStart = before.start; trimEnd = before.end; updateTrimUI(); try { mainVideo.currentTime = trimStart; } catch(e){} },
                redo: () => { trimStart = after.start; trimEnd = after.end; updateTrimUI(); try { mainVideo.currentTime = trimStart; } catch(e){} },
                desc: 'Trim handles moved'
            });
        }
    }
    isDraggingTrim = false;
    dragTarget = null;
}

trimHandleLeft.addEventListener('mousedown', (e) => startTrimDrag(e, 'left'));
trimHandleRight.addEventListener('mousedown', (e) => startTrimDrag(e, 'right'));
document.addEventListener('mousemove', handleTrimDrag);
document.addEventListener('mouseup', endTrimDrag);

trimHandleLeft.addEventListener('touchstart', (e) => startTrimDrag(e, 'left'), { passive: false });
trimHandleRight.addEventListener('touchstart', (e) => startTrimDrag(e, 'right'), { passive: false });
document.addEventListener('touchmove', handleTrimDrag, { passive: false });
document.addEventListener('touchend', endTrimDrag);

// Trim toggle
document.getElementById('trimToggle').addEventListener('click', function() {
    this.classList.toggle('on');
    trimEnabled = this.classList.contains('on');

    const trimActions = document.getElementById('trimActions');
    const trimHandles = document.querySelectorAll('.trim-handle');
    const trimArea = document.getElementById('trimArea');

    if (trimEnabled) {
        trimActions.style.opacity = '1';
        trimActions.style.pointerEvents = 'auto';
        trimHandles.forEach(h => h.style.display = 'block');
        trimArea.style.display = 'block';
        initializeTrim();
    } else {
        trimActions.style.opacity = '0.5';
        trimActions.style.pointerEvents = 'none';
        trimHandles.forEach(h => h.style.display = 'none');
        trimArea.style.display = 'none';
        updateTrimUI();
    }
});

// Initially hide trim handles
document.querySelectorAll('.trim-handle').forEach(h => h.style.display = 'none');
document.getElementById('trimArea').style.display = 'none';

async function autoDiscoverFiles() {
    console.log('Auto-discover button clicked');
    try {
        const testInput = document.createElement('input');
        testInput.type = 'file';
        if (!('webkitdirectory' in testInput)) {
            fileStatus.textContent = 'Directory selection not supported in this browser. Please use individual file upload buttons.';
            return;
        }

        const parentInput = document.createElement('input');
        parentInput.type = 'file';
        parentInput.webkitdirectory = true;
        parentInput.multiple = true;

        parentInput.onchange = (e) => {
            console.log('Files selected:', e.target.files.length);

            if (e.target.files.length === 0) {
                fileStatus.textContent = 'No files selected. Please select a folder containing session data.';
                return;
            }
            const files = Array.from(e.target.files);
            const sessionFolders = {};
            files.forEach(f => {
                const parts = f.webkitRelativePath.split('/');
                if (parts.length >= 2) {
                    const folder = parts[0];
                    if (!sessionFolders[folder]) sessionFolders[folder] = [];
                    sessionFolders[folder].push(f);
                }
            });

            console.log('Session folders found:', Object.keys(sessionFolders));

            const sessionNames = Object.keys(sessionFolders);
            if (sessionNames.length === 0) {
                fileStatus.textContent = 'No sessions found in selected folder. Make sure you select a folder containing session subfolders with screen.mp4, webcam.mp4, and clicks.json files.';
                return;
            }

            let modal = document.getElementById('sessionModal');
            if (!modal) {
                modal = document.createElement('div');
                modal.id = 'sessionModal';
                modal.style.position = 'fixed';
                modal.style.inset = '0';
                modal.style.background = 'rgba(0,0,0,0.8)';
                modal.style.zIndex = '9999';
                modal.style.display = 'flex';
                modal.style.alignItems = 'center';
                modal.style.justifyContent = 'center';
                document.body.appendChild(modal);
            }
            modal.innerHTML = `<div style='background:#222;padding:32px 24px;border-radius:16px;max-width:340px;text-align:center;'>
                <h2 style='color:#fff;margin-bottom:18px;'>Select a Session</h2>
                <div id='sessionList'></div>
                <button style='margin-top:18px;' class='btn btn-secondary' onclick='document.getElementById("sessionModal").style.display="none"'>Cancel</button>
            </div>`;
            modal.style.display = 'flex';

            const sessionList = modal.querySelector('#sessionList');
            sessionList.innerHTML = '';
            sessionNames.forEach(name => {
                const btn = document.createElement('button');
                btn.className = 'btn btn-secondary';
                btn.textContent = name;
                btn.style.margin = '6px 0';
                btn.onclick = () => {
                    modal.style.display = 'none';
                    const sessionFiles = sessionFolders[name];
                    const screenFile = sessionFiles.find(f => f.name === 'screen.mp4');
                    const webcamFile = sessionFiles.find(f => f.name === 'webcam.mp4');
                    const clicksFile = sessionFiles.find(f => f.name === 'clicks.json');

                    let loadedCount = 0;
                    if (screenFile) {
                        mainVideo.src = URL.createObjectURL(screenFile);
                        loadedCount++;
                    } else {
                        fileStatus.textContent = 'Warning: screen.mp4 not found in session';
                    }

                    if (webcamFile) {
                        webcamVideo.src = URL.createObjectURL(webcamFile);
                        webcamWrap.classList.remove('hidden');
                        loadedCount++;
                    }

                    if (clicksFile) {
                        const reader = new FileReader();
                        reader.onload = (e) => {
                            try {
                                clicks = JSON.parse(e.target.result);
                                clickStatus.textContent = clicks.length + ' click points detected';
                                renderClickMarkers();
                                loadedCount++;
                                updateFileStatus();
                            } catch (err) {
                                clickStatus.textContent = 'Invalid click data';
                            }
                        };
                        reader.readAsText(clicksFile);
                    } else {
                        clickStatus.textContent = 'No click data found';
                    }

                    if (loadedCount > 0) {
                        fileStatus.textContent = `Loaded ${loadedCount} file(s) from session "${name}"`;
                    } else {
                        fileStatus.textContent = 'No valid files found in selected session';
                    }
                };
                sessionList.appendChild(btn);
            });
        };
        parentInput.click();
    } catch (error) {
        console.error('Auto-discovery failed:', error);
        fileStatus.textContent = 'Auto-discovery failed: ' + error.message;
    }
}

document.getElementById('clicksFile').onchange = e => {
    if (e.target.files[0]) {
        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const data = JSON.parse(e.target.result);
                clicks = Array.isArray(data) ? data : [data];
                console.log('JSON Parsed - Clicks loaded:', clicks.length, 'items');
                console.log('Video duration:', mainVideo.duration);
                console.log('First click:', clicks[0]);

                clickStatus.textContent = clicks.length + ' click points detected';
                renderClickMarkers();

                if (!mainVideo.duration) {
                    mainVideo.addEventListener('loadedmetadata', () => {
                        console.log('Video loaded, re-rendering clicks');
                        renderClickMarkers();
                    }, {once: true});
                }
            } catch (err) {
                clickStatus.textContent = 'Invalid JSON file';
                console.error('Failed to parse JSON:', err);
            }
        };
        reader.readAsText(e.target.files[0]);
    }
};

// Music file upload
document.getElementById('musicFile').onchange = e => {
    if (e.target.files[0]) {
        const file = e.target.files[0];
        const url = URL.createObjectURL(file);
        
        if (musicAudio) {
            musicAudio.pause();
            musicAudio = null;
        }
        
        musicAudio = new Audio(url);
        musicAudio.onloadedmetadata = () => {
            musicDuration = musicAudio.duration;
            musicStart = 0;
            musicEnd = musicDuration;
            musicPosition = 0;
            
            // Update sliders
            document.getElementById('musicStartSlider').max = 100;
            document.getElementById('musicEndSlider').max = 100;
            document.getElementById('musicPositionSlider').max = 100;
            document.getElementById('musicStartSlider').value = 0;
            document.getElementById('musicEndSlider').value = 100;
            document.getElementById('musicPositionSlider').value = 0;
            
            updateMusicUI();
            renderMusicTrack();
            
            musicStatus.textContent = `Loaded: ${file.name} (${fmt(musicDuration)})`;
            
            // Enable music toggle
            document.getElementById('musicToggle').classList.add('on');
            musicEnabled = true;
            musicAudio.volume = musicVolume;
        };
        
        musicAudio.onerror = () => {
            musicStatus.textContent = 'Error loading audio file';
        };
    }
};

// Music toggle
document.getElementById('musicToggle').addEventListener('click', function() {
    this.classList.toggle('on');
    musicEnabled = this.classList.contains('on');
    
    if (musicAudio) {
        musicAudio.volume = musicEnabled ? musicVolume : 0;
    }
    
    updateMusicUI();
});

// Music volume slider
document.getElementById('musicVolumeSlider').oninput = function() {
    musicVolume = this.value / 100;
    document.getElementById('musicVolumeVal').textContent = this.value + '%';
    
    if (musicAudio && musicEnabled) {
        musicAudio.volume = musicVolume;
    }
};

// Music start slider
document.getElementById('musicStartSlider').oninput = function() {
    if (!musicDuration) return;
    
    const percent = this.value / 100;
    musicStart = percent * musicDuration;
    
    if (musicStart >= musicEnd) {
        musicEnd = Math.min(musicDuration, musicStart + 1);
        document.getElementById('musicEndSlider').value = (musicEnd / musicDuration) * 100;
    }
    
    document.getElementById('musicStartVal').textContent = fmt(musicStart);
    renderMusicTrack();
};

// Music end slider
document.getElementById('musicEndSlider').oninput = function() {
    if (!musicDuration) return;
    
    const percent = this.value / 100;
    musicEnd = percent * musicDuration;
    
    if (musicEnd <= musicStart) {
        musicStart = Math.max(0, musicEnd - 1);
        document.getElementById('musicStartSlider').value = (musicStart / musicDuration) * 100;
    }
    
    document.getElementById('musicEndVal').textContent = fmt(musicEnd);
    renderMusicTrack();
};

// Music position slider
document.getElementById('musicPositionSlider').oninput = function() {
    if (!mainVideo.duration) return;
    
    const percent = this.value / 100;
    musicPosition = percent * mainVideo.duration;
    
    document.getElementById('musicPositionVal').textContent = fmt(musicPosition);
    renderMusicTrack();
};

function updateMusicUI() {
    document.getElementById('musicStartVal').textContent = fmt(musicStart);
    document.getElementById('musicEndVal').textContent = fmt(musicEnd);
    document.getElementById('musicPositionVal').textContent = fmt(musicPosition);
}

function renderMusicTrack() {
    musicTrack.innerHTML = '';
    
    if (!musicDuration || !mainVideo.duration) return;
    
    const videoDuration = mainVideo.duration;
    const musicClipDuration = musicEnd - musicStart;
    
    // Calculate position and width as percentages of video timeline
    const positionPercent = (musicPosition / videoDuration) * 100;
    const widthPercent = (musicClipDuration / videoDuration) * 100;
    
    const track = document.createElement('div');
    track.className = 'music-track';
    track.style.left = positionPercent + '%';
    track.style.width = widthPercent + '%';
    
    // Add trim handles
    const leftHandle = document.createElement('div');
    leftHandle.className = 'music-track-handle left';
    leftHandle.title = 'Adjust music start';
    
    const rightHandle = document.createElement('div');
    rightHandle.className = 'music-track-handle right';
    rightHandle.title = 'Adjust music end';
    
    track.appendChild(leftHandle);
    track.appendChild(rightHandle);
    
    // Drag functionality for moving the track
    track.addEventListener('mousedown', (e) => {
        if (e.target.classList.contains('music-track-handle')) return;
        
        isDraggingMusic = true;
        musicDragTarget = 'track';
        
        const rect = track.getBoundingClientRect();
        musicDragOffset = e.clientX - rect.left;
        
        e.preventDefault();
        e.stopPropagation();
    });
    
    // Drag functionality for trim handles
    leftHandle.addEventListener('mousedown', (e) => {
        isDraggingMusic = true;
        musicDragTarget = 'start';
        e.preventDefault();
        e.stopPropagation();
    });
    
    rightHandle.addEventListener('mousedown', (e) => {
        isDraggingMusic = true;
        musicDragTarget = 'end';
        e.preventDefault();
        e.stopPropagation();
    });
    
    musicTrack.appendChild(track);
}

// Handle music track dragging
document.addEventListener('mousemove', (e) => {
    if (!isDraggingMusic || !musicDuration || !mainVideo.duration) return;
    
    const timeline = document.getElementById('timeline');
    const rect = timeline.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const percent = Math.max(0, Math.min(1, x / rect.width));
    
    if (musicDragTarget === 'track') {
        // Move the entire track
        const videoDuration = mainVideo.duration;
        const musicClipDuration = musicEnd - musicStart;
        const newMusicPosition = percent * videoDuration - (musicDragOffset / rect.width) * videoDuration;
        
        // Constrain to timeline
        musicPosition = Math.max(0, Math.min(videoDuration - musicClipDuration, newMusicPosition));
        
        document.getElementById('musicPositionSlider').value = (musicPosition / videoDuration) * 100;
        document.getElementById('musicPositionVal').textContent = fmt(musicPosition);
        
    } else if (musicDragTarget === 'start') {
        // Adjust music start
        const newMusicStart = percent * musicDuration;
        musicStart = Math.min(newMusicStart, musicEnd - 0.1);
        
        document.getElementById('musicStartSlider').value = (musicStart / musicDuration) * 100;
        document.getElementById('musicStartVal').textContent = fmt(musicStart);
        
    } else if (musicDragTarget === 'end') {
        // Adjust music end
        const newMusicEnd = percent * musicDuration;
        musicEnd = Math.max(newMusicEnd, musicStart + 0.1);
        
        document.getElementById('musicEndSlider').value = (musicEnd / musicDuration) * 100;
        document.getElementById('musicEndVal').textContent = fmt(musicEnd);
    }
    
    renderMusicTrack();
});

document.addEventListener('mouseup', () => {
    isDraggingMusic = false;
    musicDragTarget = null;
});

function removeMusic() {
    if (musicAudio) {
        musicAudio.pause();
        musicAudio = null;
    }
    
    musicEnabled = false;
    musicDuration = 0;
    musicStart = 0;
    musicEnd = 0;
    musicPosition = 0;
    
    document.getElementById('musicToggle').classList.remove('on');
    document.getElementById('musicStatus').textContent = 'No music loaded';
    musicTrack.innerHTML = '';
    
    updateMusicUI();
}

document.getElementById('screenFile').onchange = e => {
    if (e.target.files[0]) {
        mainVideo.src = URL.createObjectURL(e.target.files[0]);
        if (clicks.length === 0) {
            clickStatus.textContent = '0 click points';
        }
        updateFileStatus();
    }
};

document.getElementById('webcamFile').onchange = e => {
    if (e.target.files[0]) {
        webcamVideo.src = URL.createObjectURL(e.target.files[0]);
        webcamWrap.classList.remove('hidden');
        updateFileStatus();
    }
};

function fmt(s) { return Math.floor(s/60) + ':' + String(Math.floor(s%60)).padStart(2,'0'); }

let animationFrameId = null;

function animationLoop() {
    if (!playing) {
        animationFrameId = null;
        return;
    }

    const t = mainVideo.currentTime;

    // Check if we've reached trim end
    if (trimEnabled && t >= trimEnd) {
        mainVideo.pause();
        webcamVideo.pause();
        if (musicAudio) musicAudio.pause();
        playing = false;
        document.getElementById('playIcon').innerHTML = '<path d="M8 5v14l11-7z"/>';
        if (animationFrameId) {
            cancelAnimationFrame(animationFrameId);
            animationFrameId = null;
        }
        return;
    }

    // Sync music playback
    if (musicAudio && musicEnabled && musicDuration > 0) {
        const musicClipDuration = musicEnd - musicStart;
        const musicClipPosition = t - musicPosition;
        
        if (musicClipPosition >= 0 && musicClipPosition <= musicClipDuration) {
            // We're in the music playback range
            const musicTime = musicStart + musicClipPosition;
            
            if (musicAudio.paused) {
                musicAudio.currentTime = musicTime;
                musicAudio.play().catch(e => console.log('Music play error:', e));
            } else {
                // Sync if we're too far off
                if (Math.abs(musicAudio.currentTime - musicTime) > 0.5) {
                    musicAudio.currentTime = musicTime;
                }
            }
        } else {
            // We're outside the music playback range
            if (!musicAudio.paused) {
                musicAudio.pause();
            }
        }
    }

    const zoomState = calculateZoom(t);
    applyZoom(zoomState);

    animationFrameId = requestAnimationFrame(animationLoop);
}

document.getElementById('playBtn').onclick = () => {
    if (playing) {
        mainVideo.pause(); webcamVideo.pause();
        if (musicAudio) musicAudio.pause();
        document.getElementById('playIcon').innerHTML = '<path d="M8 5v14l11-7z"/>';
        playing = false;
        if (animationFrameId) {
            cancelAnimationFrame(animationFrameId);
            animationFrameId = null;
        }
    } else {
        // If trimming is enabled, start from trim start if we're outside the trim range
        if (trimEnabled && (mainVideo.currentTime < trimStart || mainVideo.currentTime >= trimEnd)) {
            mainVideo.currentTime = trimStart;
        }
        mainVideo.play(); webcamVideo.play();
        
        // Start music if enabled
        if (musicAudio && musicEnabled && musicDuration > 0) {
            const musicClipPosition = mainVideo.currentTime - musicPosition;
            if (musicClipPosition >= 0 && musicClipPosition <= (musicEnd - musicStart)) {
                musicAudio.currentTime = musicStart + musicClipPosition;
                musicAudio.play().catch(e => console.log('Music play error:', e));
            }
        }
        
        document.getElementById('playIcon').innerHTML = '<path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/>';
        playing = true;
        if (!animationFrameId) {
            animationFrameId = requestAnimationFrame(animationLoop);
        }
    }
};

mainVideo.ontimeupdate = () => {
    const t = mainVideo.currentTime, d = mainVideo.duration || 1;
    progress.style.width = (t/d*100) + '%';
    timeDisp.textContent = fmt(t) + ' / ' + fmt(d);

    if (captionsOn && captions.length) {
        const cap = captions.find(c => t >= c.start && t <= c.end);
        captionsBox.innerHTML = cap ? `<div class="caption">${cap.text}</div>` : '';

        document.querySelectorAll('.caption-item').forEach((el, i) => {
            el.classList.toggle('active', captions[i] && t >= captions[i].start && t <= captions[i].end);
        });
    }

    if (!playing) {
        const zoomState = calculateZoom(t);
        applyZoom(zoomState);
    }
};

function ease(t, strength = 0.5) {
    if (strength === 0) return t;
    const s = strength;
    const smooth = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
    return t * (1 - s) + smooth * s;
}

function calculateZoom(t) {
    if (!zoomEnabled || clicks.length === 0) {
        return { scale: 1, originX: 50, originY: 50, active: false };
    }

    const sortedClicks = [...clicks]
        .filter(c => (typeof c.duration === 'number' ? c.duration : 1) <= clickThreshold)
        .sort((a, b) => a.time - b.time);

    if (sortedClicks.length === 0) {
        if (t > 0) {
            const lastClick = clicks.length > 0 ? clicks[clicks.length - 1] : {x:0.5, y:0.5};
            const progress = Math.min(1, t / zoomOutSpeed);
            const easedProgress = ease(progress, easingStrength);
            const scale = zoomLevel - (zoomLevel - 1) * easedProgress;
            const originX = (lastClick.x || 0.5) * 100 + (50 - (lastClick.x || 0.5) * 100) * easedProgress;
            const originY = (lastClick.y || 0.5) * 100 + (50 - (lastClick.y || 0.5) * 100) * easedProgress;
            return { scale, originX, originY, active: true, phase: 'zoom-out' };
        } else {
            return { scale: 1, originX: 50, originY: 50, active: false };
        }
    }

    const CLUSTER_GAP = 2.0;
    const clusters = [];
    let currentCluster = [sortedClicks[0]];
    for (let i = 1; i < sortedClicks.length; i++) {
        const timeSinceLast = sortedClicks[i].time - currentCluster[currentCluster.length - 1].time;
        if (timeSinceLast < CLUSTER_GAP) {
            currentCluster.push(sortedClicks[i]);
        } else {
            clusters.push(currentCluster);
            currentCluster = [sortedClicks[i]];
        }
    }
    clusters.push(currentCluster);

    for (const cluster of clusters) {
        const firstClick = cluster[0];
        const lastClick = cluster[cluster.length - 1];

        const clusterStart = firstClick.time - zoomAnticipate;
        const zoomInEnd = clusterStart + zoomInSpeed;

        const lastClickReachTime = zoomInEnd;
        let totalTime = zoomInSpeed;

        for (let i = 0; i < cluster.length; i++) {
            totalTime += zoomDuration;
            if (i < cluster.length - 1) {
                const basePanTime = Math.max(0.3, cluster[i + 1].time - cluster[i].time);
                const panTime = basePanTime / panSpeed;
                totalTime += panTime;
            }
        }
        totalTime += zoomOutSpeed;

        const clusterEnd = clusterStart + totalTime;

        if (t >= clusterStart && t < clusterEnd) {
            let elapsedInCluster = t - clusterStart;

            if (elapsedInCluster < zoomInSpeed) {
                const progress = elapsedInCluster / zoomInSpeed;
                const easedProgress = ease(progress, easingStrength);
                const scale = 1 + (zoomLevel - 1) * easedProgress;
                const originX = 50 + (firstClick.x * 100 - 50) * easedProgress;
                const originY = 50 + (firstClick.y * 100 - 50) * easedProgress;
                return { scale, originX, originY, active: true, phase: 'zoom-in' };
            }

            elapsedInCluster -= zoomInSpeed;

            for (let i = 0; i < cluster.length; i++) {
                const click = cluster[i];

                if (elapsedInCluster < zoomDuration) {
                    return {
                        scale: zoomLevel,
                        originX: click.x * 100,
                        originY: click.y * 100,
                        active: true,
                        phase: 'hold'
                    };
                }
                elapsedInCluster -= zoomDuration;

                if (i < cluster.length - 1) {
                    const nextClick = cluster[i + 1];
                    const basePanDuration = Math.max(0.3, nextClick.time - click.time);
                    const panDuration = basePanDuration / panSpeed;

                    if (elapsedInCluster < panDuration) {
                        const progress = elapsedInCluster / panDuration;
                        const easedProgress = ease(progress, panEasing);
                        const fromX = click.x * 100;
                        const fromY = click.y * 100;
                        const toX = nextClick.x * 100;
                        const toY = nextClick.y * 100;
                        return {
                            scale: zoomLevel,
                            originX: fromX + (toX - fromX) * easedProgress,
                            originY: fromY + (toY - fromY) * easedProgress,
                            active: true,
                            phase: 'pan'
                        };
                    }
                    elapsedInCluster -= panDuration;
                }
            }

            if (elapsedInCluster < zoomOutSpeed) {
                const progress = elapsedInCluster / zoomOutSpeed;
                const easedProgress = ease(progress, easingStrength);
                const scale = zoomLevel - (zoomLevel - 1) * easedProgress;
                const originX = lastClick.x * 100 + (50 - lastClick.x * 100) * easedProgress;
                const originY = lastClick.y * 100 + (50 - lastClick.y * 100) * easedProgress;
                return { scale, originX, originY, active: true, phase: 'zoom-out' };
            }
        }
    }

    return { scale: 1, originX: 50, originY: 50, active: false };
}

function applyZoom(state) {
    if (state.active) {
        mainVideo.style.transformOrigin = `${state.originX}% ${state.originY}%`;
        mainVideo.style.transform = `scale(${state.scale})`;
    } else {
        mainVideo.style.transform = '';
        mainVideo.style.transformOrigin = 'center center';
    }
};

mainVideo.onended = () => {
    playing = false;
    if (musicAudio) musicAudio.pause();
    document.getElementById('playIcon').innerHTML = '<path d="M8 5v14l11-7z"/>';
    if (animationFrameId) {
        cancelAnimationFrame(animationFrameId);
        animationFrameId = null;
    }
    mainVideo.style.transform = '';
    mainVideo.style.transformOrigin = 'center center';
    // If trimming is enabled, reset playhead to trim start for convenient replay
    if (trimEnabled) {
        try { mainVideo.currentTime = trimStart; webcamVideo.currentTime = trimStart; } catch (e) {}
    }
};

document.getElementById('timeline').onclick = e => {
    if (isDraggingTrim) return;

    const rect = e.currentTarget.getBoundingClientRect();
    const pct = (e.clientX - rect.left) / rect.width;
    let seekTime = pct * mainVideo.duration;

    // If trimming is enabled, constrain seek to trim range
    if (trimEnabled) {
        seekTime = Math.max(trimStart, Math.min(trimEnd, seekTime));
    }

    mainVideo.currentTime = seekTime;
    webcamVideo.currentTime = seekTime;
    const zoomState = calculateZoom(mainVideo.currentTime);
    applyZoom(zoomState);
};

document.querySelectorAll('.swatch').forEach(s => {
    s.onclick = () => {
        document.querySelectorAll('.swatch').forEach(x => x.classList.remove('active'));
        s.classList.add('active');
        currentBg = s.dataset.bg;
        gradBg.style.background = currentBg;
    };
});

document.getElementById('bgToggle').onclick = function() {
    this.classList.toggle('on');
    showBackground = this.classList.contains('on');
    gradBg.style.display = showBackground ? 'block' : 'none';
    document.getElementById('colorSwatches').style.opacity = showBackground ? '1' : '0.3';
};

document.getElementById('zoomToggle').onclick = function() {
    this.classList.toggle('on');
    zoomEnabled = this.classList.contains('on');
    if (!zoomEnabled) {
        mainVideo.style.transform = '';
        mainVideo.style.transformOrigin = 'center center';
    }
};

document.getElementById('zoomSlider').oninput = function() {
    zoomLevel = parseFloat(this.value);
    document.getElementById('zoomVal').textContent = zoomLevel.toFixed(1) + 'x';
};

document.getElementById('zoomDurSlider').oninput = function() {
    zoomDuration = parseFloat(this.value);
    document.getElementById('zoomDurVal').textContent = zoomDuration.toFixed(1) + 's';
};

document.getElementById('zoomAnticipateSlider').oninput = function() {
    zoomAnticipate = parseFloat(this.value);
    document.getElementById('zoomAnticipateVal').textContent = zoomAnticipate.toFixed(1) + 's';
};

document.getElementById('zoomInSpeedSlider').oninput = function() {
    zoomInSpeed = parseFloat(this.value);
    document.getElementById('zoomInSpeedVal').textContent = zoomInSpeed.toFixed(2) + 's';
};

document.getElementById('zoomOutSpeedSlider').oninput = function() {
    zoomOutSpeed = parseFloat(this.value);
    document.getElementById('zoomOutSpeedVal').textContent = zoomOutSpeed.toFixed(2) + 's';
};

document.getElementById('easingSlider').oninput = function() {
    easingStrength = parseFloat(this.value);
    document.getElementById('easingVal').textContent = easingStrength.toFixed(1);
};

document.getElementById('panSpeedSlider').oninput = function() {
    panSpeed = parseFloat(this.value);
    document.getElementById('panSpeedVal').textContent = panSpeed.toFixed(1) + 'x';
};

document.getElementById('panEasingSlider').oninput = function() {
    panEasing = parseFloat(this.value);
    document.getElementById('panEasingVal').textContent = panEasing.toFixed(1);
};

document.getElementById('webcamToggle').onclick = function() {
    this.classList.toggle('on');
    webcamVisible = this.classList.contains('on');
    webcamWrap.classList.toggle('hidden', !webcamVisible);
};

document.getElementById('webcamSizeSlider').oninput = function() {
    const sz = this.value;
    document.getElementById('webcamSizeVal').textContent = sz + 'px';
    webcamWrap.style.width = sz + 'px';
    webcamWrap.style.height = sz + 'px';
};

document.getElementById('webcamShapeToggle').onclick = function() {
    this.classList.toggle('on');
    webcamWrap.classList.toggle('square', this.classList.contains('on'));
};

document.getElementById('captionsToggle').onclick = function() {
    this.classList.toggle('on');
    captionsOn = this.classList.contains('on');
    if (!captionsOn) captionsBox.innerHTML = '';
};

let dragging = false, dragOff = {x:0,y:0};
webcamWrap.onmousedown = e => {
    dragging = true;
    const r = webcamWrap.getBoundingClientRect();
    dragOff = {x: e.clientX - r.left, y: e.clientY - r.top};
    e.preventDefault();
};
document.onmousemove = e => {
    if (!dragging) return;
    const canvas = document.getElementById('canvas').getBoundingClientRect();
    webcamWrap.style.left = (e.clientX - canvas.left - dragOff.x) + 'px';
    webcamWrap.style.top = (e.clientY - canvas.top - dragOff.y) + 'px';
    webcamWrap.style.right = 'auto';
    webcamWrap.style.bottom = 'auto';
};
document.onmouseup = () => dragging = false;

function addTestClick() {
    if (!mainVideo.duration) {
        clickStatus.textContent = 'Load a video first';
        return;
    }

    const time = mainVideo.currentTime || Math.random() * (mainVideo.duration || 30);
    const x = 0.3 + Math.random() * 0.4;
    const y = 0.3 + Math.random() * 0.4;

    const idx = clicks.length;
    clicks.push({time, x, y});
    clickStatus.textContent = clicks.length + ' click points detected';
    renderClickMarkers();
    pushAction({
        undo: () => { clicks.splice(idx,1); clickStatus.textContent = clicks.length + ' click points detected'; renderClickMarkers(); },
        redo: () => { clicks.splice(idx,0,{time,x,y}); clickStatus.textContent = clicks.length + ' click points detected'; renderClickMarkers(); },
        desc: 'Add click'
    });
}

function clearClicks() {
    clicks = [];
    clickStatus.textContent = '0 click points detected';
    renderClickMarkers();
}

function downloadClicks() {
    const data = JSON.stringify(clicks, null, 2);
    const blob = new Blob([data], {type: 'application/json'});
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'clicks_' + new Date().toISOString() + '.json';
    link.click();
    URL.revokeObjectURL(url);
}

function importCaptions() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.srt,.vtt,.json';
    input.onchange = (e) => {
        if (e.target.files[0]) {
            const reader = new FileReader();
            reader.onload = (e) => {
                try {
                    const content = e.target.result;
                    if (content.startsWith('{') || content.startsWith('[')) {
                        captions = JSON.parse(content);
                    } else {
                        captions = parseSRT(content);
                    }

                    document.getElementById('captionsToggle').classList.add('on');
                    captionsOn = true;
                    renderCaptionList();
                } catch (err) {
                    console.error('Failed to import captions:', err);
                }
            };
            reader.readAsText(e.target.files[0]);
        }
    };
    input.click();
}

function parseSRT(content) {
    const blocks = content.split('\n\n');
    return blocks.map(block => {
        const lines = block.trim().split('\n');
        if (lines.length >= 3) {
            const timeLine = lines[1];
            const text = lines.slice(2).join(' ');
            const times = timeLine.split(' --> ');
            if (times.length === 2) {
                return {
                    start: parseTimeString(times[0].trim()),
                    end: parseTimeString(times[1].trim()),
                    text: text
                };
            }
        }
        return null;
    }).filter(Boolean);
}

function parseTimeString(timeStr) {
    const parts = timeStr.replace(',', '.').split(':');
    return parseInt(parts[0]) * 3600 + parseInt(parts[1]) * 60 + parseFloat(parts[2]);
}

mainVideo.onclick = e => {
    const r = mainVideo.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width;
    const y = (e.clientY - r.top) / r.height;
    const idx = clicks.length;
    clicks.push({time: mainVideo.currentTime, x, y});
    clickStatus.textContent = clicks.length + ' click points detected';
    renderClickMarkers();
    pushAction({
        undo: () => { clicks.splice(idx,1); clickStatus.textContent = clicks.length + ' click points detected'; renderClickMarkers(); },
        redo: () => { clicks.splice(idx,0,{time: mainVideo.currentTime, x, y}); clickStatus.textContent = clicks.length + ' click points detected'; renderClickMarkers(); },
        desc: 'Add click'
    });
};

function renderCaptionList() {
    captionList.innerHTML = '';
    captions.forEach((c, i) => {
        const item = document.createElement('div');
        item.className = 'caption-item';
        item.innerHTML = `<span class="caption-time">${fmt(c.start)}</span><span class="caption-text">${c.text}</span>`;
        item.onclick = () => { mainVideo.currentTime = c.start; };
        captionList.appendChild(item);
    });
    captionList.classList.remove('hidden');
}

document.getElementById('transcribeBtn').onclick = () => {
    const btn = document.getElementById('transcribeBtn');
    btn.textContent = 'Transcribing...';
    btn.disabled = true;

    const dur = mainVideo.duration || 30;
    const numCaptions = Math.ceil(dur / 4);
    captions = [];

    const sampleTexts = [
        "Welcome to this screen recording demo",
        "Let me show you how this works",
        "Click here to open the menu",
        "Now we'll navigate to settings",
        "This feature is really useful",
        "As you can see, it's quite simple",
        "The interface is intuitive",
        "Let's move on to the next step",
        "Here's an important feature",
        "And that's how it's done"
    ];

    for (let i = 0; i < numCaptions; i++) {
        captions.push({
            start: i * 4,
            end: Math.min((i + 1) * 4 - 0.5, dur),
            text: sampleTexts[i % sampleTexts.length]
        });
    }

    setTimeout(() => {
        btn.textContent = 'Regenerate';
        btn.disabled = false;
        document.getElementById('captionsToggle').classList.add('on');
        captionsOn = true;
        renderCaptionList();
    }, 1500);
};

document.getElementById('exportBtn').onclick = async () => {
    const modal = document.getElementById('exportModal');
    const bar = document.getElementById('exportBar');
    const status = document.getElementById('exportStatus');
    modal.classList.add('show');
    status.textContent = 'Preparing export...';
    bar.style.strokeDashoffset = 201;

    try {
        // Determine export duration based on trim settings
        let exportStart = 0;
        let exportEnd = mainVideo.duration || 0;

        if (trimEnabled) {
            exportStart = trimStart;
            exportEnd = trimEnd;
            status.textContent = `Exporting trimmed video (${fmt(exportStart)} - ${fmt(exportEnd)})...`;
        } else {
            status.textContent = 'Exporting full video...';
        }

        const useWebCodecs = false;

        const exportWidth = mainVideo.videoWidth;
        const exportHeight = mainVideo.videoHeight;
        const canvas = document.createElement('canvas');
        canvas.width = exportWidth;
        canvas.height = exportHeight;
        const ctx = canvas.getContext('2d');

        const videoClone = document.createElement('video');
        videoClone.src = mainVideo.src;
        videoClone.muted = false;
        videoClone.preload = 'auto';

        await new Promise((resolve, reject) => {
            videoClone.onloadeddata = async () => {
                videoClone.currentTime = exportStart;
                await new Promise(r => {
                    const onSeeked = () => {
                        videoClone.removeEventListener('seeked', onSeeked);
                        r();
                    };
                    videoClone.addEventListener('seeked', onSeeked);
                });
                resolve();
            };
            videoClone.onerror = reject;
            videoClone.load();
        });

        let webcamClone = null;
        if (webcamVideo.src && webcamVisible) {
            webcamClone = document.createElement('video');
            webcamClone.src = webcamVideo.src;
            webcamClone.muted = false;
            webcamClone.preload = 'auto';

            await new Promise((resolve, reject) => {
                webcamClone.onloadeddata = resolve;
                webcamClone.onerror = reject;
                webcamClone.load();
            });
            webcamClone.currentTime = exportStart;
        }

        const webcamSize = parseInt(document.getElementById('webcamSizeSlider').value);
        const webcamSquare = document.getElementById('webcamShapeToggle').classList.contains('on');

        const duration = exportEnd - exportStart;
        const fps = 60;
        const totalFrames = Math.floor(duration * fps);

        const videoAspect = videoClone.videoWidth / videoClone.videoHeight;
        const bgPadding = showBackground ? 30 : 0;
        const gradPadding = showBackground ? 10 : 0;
        const gradRadius = showBackground ? 36 : 0;
        const videoRadius = showBackground ? 28 : 0;
        let gradWidth, gradHeight, gradX, gradY;
        let frameWidth, frameHeight, frameX, frameY;
        if (showBackground) {
            gradWidth = exportWidth - bgPadding * 2;
            gradHeight = exportHeight - bgPadding * 2;
            gradX = bgPadding;
            gradY = bgPadding;
            const maxWidth = gradWidth - gradPadding * 2;
            const maxHeight = gradHeight - gradPadding * 2;
            if (maxWidth / maxHeight > videoAspect) {
                frameHeight = maxHeight;
                frameWidth = frameHeight * videoAspect;
            } else {
                frameWidth = maxWidth;
                frameHeight = frameWidth / videoAspect;
            }
            frameX = gradX + (gradWidth - frameWidth) / 2;
            frameY = gradY + (gradHeight - frameHeight) / 2;
        } else {
            gradWidth = gradHeight = 0;
            gradX = gradY = 0;
            frameWidth = exportWidth;
            frameHeight = exportHeight;
            frameX = 0;
            frameY = 0;
        }

        if (!useWebCodecs) {
            const stream = canvas.captureStream(fps);

            try {
                const AudioCtx = window.AudioContext || window.webkitAudioContext;
                if (AudioCtx) {
                    const audioCtx = new AudioCtx();
                    const dest = audioCtx.createMediaStreamDestination();
                    try {
                        const mainSrc = audioCtx.createMediaElementSource(videoClone);
                        mainSrc.connect(dest);
                    } catch (e) {
                        console.warn('Could not create audio source for main video:', e);
                    }
                    if (webcamClone) {
                        try {
                            const camSrc = audioCtx.createMediaElementSource(webcamClone);
                            camSrc.connect(dest);
                        } catch (e) {
                            console.warn('Could not create audio source for webcam:', e);
                        }
                    }

                    dest.stream.getAudioTracks().forEach(track => stream.addTrack(track));
                }
            } catch (e) {
                console.warn('Audio mixing not available:', e);
            }

            let mimeType = 'video/webm;codecs=vp9,opus';
            if (!MediaRecorder.isTypeSupported(mimeType)) {
                mimeType = 'video/webm;codecs=vp8,opus';
            }
            if (!MediaRecorder.isTypeSupported(mimeType)) {
                mimeType = 'video/webm';
            }

            const mediaRecorder = new MediaRecorder(stream, {
                mimeType: mimeType,
                videoBitsPerSecond: 50000000
            });

            const recordedChunks = [];
            mediaRecorder.ondataavailable = e => {
                if (e.data.size > 0) recordedChunks.push(e.data);
            };

            const exportPromise = new Promise(resolve => {
                mediaRecorder.onstop = () => {
                    const blob = new Blob(recordedChunks, { type: mimeType.split(';')[0] });
                    resolve(blob);
                };
            });

            mediaRecorder.start(100);

            videoClone.currentTime = exportStart;
            if (webcamClone) webcamClone.currentTime = exportStart;

            const syncWebcam = () => {
                if (webcamClone && !webcamClone.paused) {
                    const targetTime = Math.min(videoClone.currentTime, webcamClone.duration - 0.1);
                    if (Math.abs(webcamClone.currentTime - targetTime) > 0.1) {
                        webcamClone.currentTime = targetTime;
                    }
                }
            };

            let lastRenderTime = 0;
            const renderInterval = 1000 / fps;
            let frameCount = 0;

            const renderFrame = () => {
                const currentTime = videoClone.currentTime;
                const elapsedTime = currentTime - exportStart;
                syncWebcam();

                ctx.clearRect(0, 0, exportWidth, exportHeight);

                if (showBackground) {
                    if (currentBg.includes('gradient')) {
                        const fullGrad = ctx.createLinearGradient(0, 0, exportWidth, exportHeight);
                        const colors = currentBg.match(/#[a-fA-F0-9]{6}/g) || ['#667eea', '#764ba2', '#f093fb'];
                        colors.forEach((color, i) => {
                            fullGrad.addColorStop(i / (colors.length - 1), color);
                        });
                        ctx.fillStyle = fullGrad;
                    } else {
                        ctx.fillStyle = currentBg;
                    }
                    ctx.fillRect(0, 0, exportWidth, exportHeight);

                    ctx.save();
                    ctx.beginPath();
                    ctx.roundRect(gradX, gradY, gradWidth, gradHeight, gradRadius);
                    ctx.clip();
                    if (currentBg.includes('gradient')) {
                        const gradient = ctx.createLinearGradient(gradX, gradY, gradX + gradWidth, gradY + gradHeight);
                        const colors = currentBg.match(/#[a-fA-F0-9]{6}/g) || ['#667eea', '#764ba2', '#f093fb'];
                        colors.forEach((color, i) => {
                            gradient.addColorStop(i / (colors.length - 1), color);
                        });
                        ctx.fillStyle = gradient;
                    } else {
                        ctx.fillStyle = currentBg;
                    }
                    ctx.fillRect(gradX, gradY, gradWidth, gradHeight);
                    ctx.restore();
                }

                const zoomState = calculateZoom(currentTime);

                ctx.save();
                ctx.beginPath();
                if (showBackground) {
                    ctx.roundRect(frameX, frameY, frameWidth, frameHeight, videoRadius);
                } else {
                    ctx.rect(0, 0, exportWidth, exportHeight);
                }
                ctx.clip();
                if (zoomState.active && zoomState.scale > 1) {
                    const zoomCenterX = frameX + frameWidth * (zoomState.originX / 100);
                    const zoomCenterY = frameY + frameHeight * (zoomState.originY / 100);
                    ctx.translate(zoomCenterX, zoomCenterY);
                    ctx.scale(zoomState.scale, zoomState.scale);
                    ctx.translate(-zoomCenterX, -zoomCenterY);
                }
                ctx.drawImage(videoClone, frameX, frameY, frameWidth, frameHeight);
                ctx.restore();

                if (showBackground) {
                    ctx.save();
                    ctx.shadowColor = 'rgba(0,0,0,0.3)';
                    ctx.shadowBlur = 30;
                    ctx.strokeStyle = 'rgba(255,255,255,0.1)';
                    ctx.lineWidth = 1;
                    ctx.beginPath();
                    ctx.roundRect(frameX, frameY, frameWidth, frameHeight, videoRadius);
                    ctx.stroke();
                    ctx.restore();
                }

                if (webcamClone && webcamVisible) {
                    const webcamWrap = document.getElementById('webcamWrap');
                    const previewCanvas = document.getElementById('canvas');
                    let wcX = 0, wcY = 0, wcExportSize = webcamSize * (exportWidth / 800);
                    if (webcamWrap && previewCanvas) {
                        const previewRect = previewCanvas.getBoundingClientRect();
                        const wrapRect = webcamWrap.getBoundingClientRect();
                        const scaleX = exportWidth / previewRect.width;
                        const scaleY = exportHeight / previewRect.height;
                        wcX = (wrapRect.left - previewRect.left) * scaleX;
                        wcY = (wrapRect.top - previewRect.top) * scaleY;
                        wcExportSize = wrapRect.width * scaleX;
                    } else {
                        wcX = frameX + frameWidth - wcExportSize - 30;
                        wcY = frameY + frameHeight - wcExportSize - 30;
                    }
                    ctx.save();
                    ctx.shadowColor = 'rgba(0,0,0,0.5)';
                    ctx.shadowBlur = 20;
                    ctx.beginPath();
                    if (webcamSquare) {
                        ctx.roundRect(wcX, wcY, wcExportSize, wcExportSize, 12);
                    } else {
                        ctx.arc(wcX + wcExportSize/2, wcY + wcExportSize/2, wcExportSize/2, 0, Math.PI * 2);
                    }
                    ctx.clip();
                    const wcAspect = webcamClone.videoWidth / webcamClone.videoHeight;
                    let srcX = 0, srcY = 0, srcW = webcamClone.videoWidth, srcH = webcamClone.videoHeight;
                    if (wcAspect > 1) {
                        srcW = srcH;
                        srcX = (webcamClone.videoWidth - srcW) / 2;
                    } else {
                        srcH = srcW;
                        srcY = (webcamClone.videoHeight - srcH) / 2;
                    }
                    ctx.drawImage(webcamClone, srcX, srcY, srcW, srcH, wcX, wcY, wcExportSize, wcExportSize);
                    ctx.restore();
                    ctx.strokeStyle = 'white';
                    ctx.lineWidth = 4;
                    ctx.beginPath();
                    if (webcamSquare) {
                        ctx.roundRect(wcX, wcY, wcExportSize, wcExportSize, 12);
                    } else {
                        ctx.arc(wcX + wcExportSize/2, wcY + wcExportSize/2, wcExportSize/2, 0, Math.PI * 2);
                    }
                    ctx.stroke();
                }

                if (captionsOn && captions.length) {
                    const cap = captions.find(c => currentTime >= c.start && currentTime <= c.end);
                    if (cap) {
                        ctx.font = 'bold 32px -apple-system, BlinkMacSystemFont, sans-serif';
                        const textWidth = ctx.measureText(cap.text).width;
                        const capPadding = 20;
                        const capX = (exportWidth - textWidth) / 2 - capPadding;
                        const capY = exportHeight - 120;
                        const capHeight = 50;
                        ctx.fillStyle = 'rgba(0,0,0,0.85)';
                        ctx.beginPath();
                        ctx.roundRect(capX, capY, textWidth + capPadding * 2, capHeight, 8);
                        ctx.fill();
                        ctx.fillStyle = 'white';
                        ctx.textBaseline = 'middle';
                        ctx.fillText(cap.text, capX + capPadding, capY + capHeight / 2);
                    }
                }

                frameCount++;
                // progress relative to exportStart/exportEnd
                const pct = (exportEnd > exportStart) ? Math.min(1, Math.max(0, (currentTime - exportStart) / (exportEnd - exportStart))) : 0;
                const progressPct = Math.round(pct * 100);
                bar.style.strokeDashoffset = 201 - (201 * progressPct / 100);
                status.textContent = `Recording: ${progressPct}% (WebM - real-time)`;
            };

            await new Promise((resolve) => {
                let animFrameId;

                const onEnded = () => {
                    cancelAnimationFrame(animFrameId);
                    videoClone.removeEventListener('ended', onEnded);
                    try { mediaRecorder.stop(); } catch (e) {}
                    resolve();
                };

                videoClone.addEventListener('ended', onEnded);

                const animate = () => {
                    if (videoClone.paused || videoClone.ended) return;
                    renderFrame();
                    // stop when we've reached the export end
                    if (videoClone.currentTime >= exportEnd - 0.001) {
                        cancelAnimationFrame(animFrameId);
                        videoClone.removeEventListener('ended', onEnded);
                        try { mediaRecorder.stop(); } catch (e) {}
                        resolve();
                        return;
                    }
                    animFrameId = requestAnimationFrame(animate);
                };

                videoClone.play();
                if (webcamClone) webcamClone.play();
                animate();
            });

            status.textContent = 'Finalizing...';

            const blob = await exportPromise;
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = `studio_export_${Date.now()}.webm`;
            link.click();
            setTimeout(() => URL.revokeObjectURL(url), 1000);
        }

        status.textContent = 'Export complete!';
        setTimeout(() => modal.classList.remove('show'), 2000);

    } catch (error) {
        console.error('Export failed:', error);
        status.textContent = 'Export failed: ' + error.message;
        setTimeout(() => modal.classList.remove('show'), 3000);
    }
};

/* Undo / Redo, selection, and click deletion support */
let undoStack = [], redoStack = [], selectedClickIndex = null, dragPrevStart = 0, dragPrevEnd = 0;

function pushAction(action) {
    undoStack.push(action);
    redoStack = [];
    updateUndoRedoButtons();
    console.log('Action pushed:', action.desc || action);
}

function undo() {
    const action = undoStack.pop();
    if (!action) return;
    try { action.undo(); } catch (e) { console.error('Undo failed', e); }
    redoStack.push(action);
    updateUndoRedoButtons();
}

function redo() {
    const action = redoStack.pop();
    if (!action) return;
    try { action.redo(); } catch (e) { console.error('Redo failed', e); }
    undoStack.push(action);
    updateUndoRedoButtons();
}

function updateUndoRedoButtons() {
    const u = document.getElementById('undoBtn');
    const r = document.getElementById('redoBtn');
    if (u) u.disabled = undoStack.length === 0;
    if (r) r.disabled = redoStack.length === 0;
}

function selectClickMarker(index) {
    if (index == null || index < 0 || index >= clicks.length) {
        selectedClickIndex = null;
    } else {
        selectedClickIndex = index;
    }
    renderClickMarkers();

    // create marker delete button lazily (compact, circular icon)
    let btn = document.getElementById('markerDeleteBtn');
    if (!btn) {
        btn = document.createElement('button');
        btn.id = 'markerDeleteBtn';
        btn.className = 'btn btn-secondary';
        btn.innerHTML = '🗑';
        btn.title = 'Delete click';
        btn.setAttribute('aria-label', 'Delete click');
        btn.style.position = 'fixed';
        btn.style.zIndex = '2000';
        btn.style.display = 'none';
        btn.style.padding = '0';
        btn.style.width = '36px';
        btn.style.height = '36px';
        btn.style.borderRadius = '18px';
        btn.style.fontSize = '16px';
        btn.style.lineHeight = '36px';
        btn.style.textAlign = 'center';
        btn.style.boxShadow = '0 6px 18px rgba(0,0,0,0.35)';
        btn.style.backdropFilter = 'blur(6px)';
        btn.style.border = '1px solid rgba(255,255,255,0.06)';
        document.body.appendChild(btn);
        btn.onclick = () => { deleteSelectedClick(); btn.style.display = 'none'; };
    }

    if (selectedClickIndex != null && clickMarkers.children[selectedClickIndex]) {
        const rect = clickMarkers.children[selectedClickIndex].getBoundingClientRect();
        // position the button centered above the marker
        const btnW = 36;
        btn.style.left = (rect.left + rect.width / 2 - btnW / 2) + 'px';
        btn.style.top = (rect.top - 44) + 'px';
        btn.style.display = 'block';
    } else {
        btn.style.display = 'none';
    }
}

function deleteSelectedClick() {
    if (selectedClickIndex == null) return;
    const idx = selectedClickIndex;
    const removed = clicks[idx];
    clicks.splice(idx, 1);
    selectedClickIndex = null;
    clickStatus.textContent = clicks.length + ' click points detected';
    renderClickMarkers();
    // hide marker delete button if visible
    const mbtn = document.getElementById('markerDeleteBtn');
    if (mbtn) mbtn.style.display = 'none';
    pushAction({
        undo: () => { clicks.splice(idx,0,removed); clickStatus.textContent = clicks.length + ' click points detected'; renderClickMarkers(); },
        redo: () => { clicks.splice(idx,1); clickStatus.textContent = clicks.length + ' click points detected'; renderClickMarkers(); },
        desc: 'Delete click'
    });
    updateUndoRedoButtons();
}

document.addEventListener('keydown', (e) => {
    // delete selected marker with Delete or Backspace
    if ((e.key === 'Delete' || e.key === 'Backspace') && selectedClickIndex != null) {
        deleteSelectedClick();
        e.preventDefault();
        return;
    }
    // undo / redo shortcuts
    const meta = e.ctrlKey || e.metaKey;
    if (meta && e.key.toLowerCase() === 'z') {
        if (e.shiftKey) { redo(); } else { undo(); }
        e.preventDefault();
    } else if (meta && e.key.toLowerCase() === 'y') {
        redo(); e.preventDefault();
    }
});

// Attach generic listeners for sliders and toggles to record undoable changes
function attachControlHistory() {
    document.querySelectorAll('.slider').forEach(s => {
        s.addEventListener('pointerdown', () => { s.dataset._prev = s.value; }, {passive:true});
        s.addEventListener('change', () => {
            const prev = s.dataset._prev !== undefined ? s.dataset._prev : s.value;
            const after = s.value;
            if (prev !== after) {
                pushAction({
                    undo: () => { s.value = prev; s.oninput && s.oninput(); },
                    redo: () => { s.value = after; s.oninput && s.oninput(); },
                    desc: `Slider ${s.id} change`
                });
            }
            s.dataset._prev = undefined;
        }, {passive:true});
    });

    document.querySelectorAll('.toggle').forEach(t => {
        // capture state pre-click using mousedown
        t.addEventListener('mousedown', () => { t.dataset._prev = t.classList.contains('on') ? '1' : '0'; }, {passive:true});
        t.addEventListener('click', () => {
            // push action after DOM change (use setTimeout 0 so existing click handlers run first)
            setTimeout(() => {
                const prev = t.dataset._prev === '1';
                const after = t.classList.contains('on');
                if (prev !== after) {
                    pushAction({
                        undo: () => { if (prev) t.classList.add('on'); else t.classList.remove('on'); t.onclick && t.onclick(); },
                        redo: () => { if (after) t.classList.add('on'); else t.classList.remove('on'); t.onclick && t.onclick(); },
                        desc: `Toggle ${t.id}`
                    });
                }
                t.dataset._prev = undefined;
            }, 0);
        }, {passive:true});
    });
}

// add undo/redo/delete UI buttons to top-right of canvas
(function addTopControls() {
    // Place undo/redo at the top-right of the app (window chrome), not over the video canvas
    const container = document.createElement('div');
    container.style.position = 'fixed';
    container.style.top = '12px';
    container.style.right = '18px';
    container.style.zIndex = '1600';
    container.style.display = 'flex';
    container.style.gap = '8px';
    container.innerHTML = `<button id="undoBtn" title="Undo" class="btn btn-secondary" style="padding:8px 10px;font-size:13px;">⟲</button>
                           <button id="redoBtn" title="Redo" class="btn btn-secondary" style="padding:8px 10px;font-size:13px;">⟳</button>`;
    document.body.appendChild(container);

    document.getElementById('undoBtn').onclick = undo;
    document.getElementById('redoBtn').onclick = redo;
    updateUndoRedoButtons();
})();

// Initialize control history attachment after a short delay so DOM is ready
setTimeout(attachControlHistory, 50);

// Sidebar resizer behavior
(function() {
    const resizer = document.getElementById('sidebarResizer');
    const sidebar = document.querySelector('.sidebar');
    if (!resizer || !sidebar) return;

    const MIN = 180;
    const MAX = 720;

    const saved = localStorage.getItem('sidebarWidth');
    if (saved) {
        sidebar.style.width = saved;
    }

    let isResizing = false;

    // Resizer is now positioned with 'right: 0' inside sidebar, so no need to update position

    const start = (clientX) => {
        isResizing = true;
        document.body.style.cursor = 'ew-resize';
        resizer.classList.add('active');
    };

    const move = (clientX) => {
        if (!isResizing) return;
        const rect = sidebar.getBoundingClientRect();
        const width = Math.min(MAX, Math.max(MIN, Math.round(clientX - rect.left)));
        sidebar.style.width = width + 'px';
    };

    const end = () => {
        if (!isResizing) return;
        isResizing = false;
        document.body.style.cursor = '';
        resizer.classList.remove('active');
        localStorage.setItem('sidebarWidth', sidebar.style.width);
    };

    resizer.addEventListener('mouseenter', () => { if (!isResizing) document.body.style.cursor = 'ew-resize'; });
    resizer.addEventListener('mouseleave', () => { if (!isResizing) document.body.style.cursor = ''; });

    resizer.addEventListener('mousedown', (e) => { e.preventDefault(); start(e.clientX); });
    document.addEventListener('mousemove', (e) => move(e.clientX));
    document.addEventListener('mouseup', end);

    resizer.addEventListener('touchstart', (e) => { e.preventDefault(); start(e.touches[0].clientX); }, { passive: false });
    document.addEventListener('touchmove', (e) => { if (!isResizing) return; move(e.touches[0].clientX); }, { passive: false });
    document.addEventListener('touchend', end);

    document.addEventListener('mouseleave', () => { if (!isResizing) document.body.style.cursor = ''; });

    resizer.addEventListener('dblclick', () => {
        sidebar.style.width = '';
        localStorage.removeItem('sidebarWidth');
    });

    resizer.addEventListener('keydown', (e) => {
        const cur = parseInt(getComputedStyle(sidebar).width, 10);
        if (e.key === 'ArrowLeft') {
            const w = Math.max(MIN, cur - 10);
            sidebar.style.width = w + 'px';
            localStorage.setItem('sidebarWidth', sidebar.style.width);
            e.preventDefault();
        }
        if (e.key === 'ArrowRight') {
            const w = Math.min(MAX, cur + 10);
            sidebar.style.width = w + 'px';
            localStorage.setItem('sidebarWidth', sidebar.style.width);
            e.preventDefault();
        }
        if (e.key === 'Home') {
            sidebar.style.width = MIN + 'px';
            localStorage.setItem('sidebarWidth', sidebar.style.width);
            e.preventDefault();
        }
        if (e.key === 'End') {
            sidebar.style.width = MAX + 'px';
            localStorage.setItem('sidebarWidth', sidebar.style.width);
            e.preventDefault();
        }
    });
})();
