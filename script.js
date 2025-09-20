// osu! Reverse Mapper - Main Script

// DOM Elements
const canvas = document.getElementById("canvas");
const ctx = canvas.getContext("2d");
const menu = document.getElementById("menuScreen");
const playScreen = document.getElementById("playScreen");
const oszInput = document.getElementById("oszInput");
const skinInput = document.getElementById("skinInput");
const startButton = document.getElementById("startButton");
const stopButton = document.getElementById("stopButton");
const playfield = document.getElementById("playfield");

// Canvas Setup
canvas.width = window.innerWidth;
canvas.height = window.innerHeight;
window.addEventListener("resize", () => {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
});

// Game State Variables
let key1 = "z";
let key2 = "x";
let keyDownState = {};
let audio = null;
let mapObjects = [];
let isRecording = false;
let mouseX = 0;
let mouseY = 0;
let activeCircles = [];
let cursorTrailParts = [];
let lastTrailPos = null;
let mouseHideTimer = null;
let circleSize = 50;
let comboCount = 1;
let lastHitTime = 0;
let parsedOsuData = null;
let enforcePlayfieldBoundaries = true;
let snapSubdivision = 4;
let originalZip = null; // Store the loaded .osz zip
let replayFrames = [];
let snappedHitTimes = [];
let lastFrameTime = null;
let replayIntervalId = null;
let currentRngSeed = 123456; // You can randomize this if you want
let currentUsername = "Player"; // Default or set from user input
let beatmapHash = "";
let numHitObjects = 0;
let edgeModeEnabled = false;
let playbackRate = 1.0;

// Circle Size Calculation
function csToRadius(cs) {
    const osuRadius = 64 * (1 - 0.7 * (cs - 5) / 5);
    const osuPlayfieldHeight = 536;
    const canvasHeight = window.innerHeight;
    const fudgeFactor = 0.5;
    const scale = canvasHeight / osuPlayfieldHeight;
    return osuRadius * scale * fudgeFactor;
}

// Audio Setup
const audioContext = new AudioContext();
let hitSoundBuffer = null;

fetch("hitnormal.wav")
    .then(response => response.arrayBuffer())
    .then(arrayBuffer => audioContext.decodeAudioData(arrayBuffer))
    .then(buffer => {
        hitSoundBuffer = buffer;
    })
    .catch(err => console.log("Hit sound not found, continuing without sound"));

// Skin Images
let skinImages = {
    cursor: null,
    hitcircle: null,
    hitcircleOverlay: null,
    cursorTrail: null,
    numbers: {}
};

// Helper Functions
function distance(x1, y1, x2, y2) {
    const dx = x2 - x1;
    const dy = y2 - y1;
    return Math.sqrt(dx * dx + dy * dy);
}

function setupKeybindButton(id, assignTo) {
    const button = document.getElementById(id);
    button.addEventListener("click", () => {
        button.textContent = "Press a key...";
        const listener = (e) => {
            e.preventDefault();
            const key = e.key.toLowerCase();
            if (assignTo === "key1") key1 = key;
            else if (assignTo === "key2") key2 = key;
            button.textContent = key.toUpperCase();
            window.removeEventListener("keydown", listener);
        };
        window.addEventListener("keydown", listener);
    });
}

function loadSkinImage(file, key, isNumber = false) {
    const reader = new FileReader();
    reader.onload = () => {
        const img = new Image();
        img.src = reader.result;
        img.onload = () => {
            if (isNumber) {
                skinImages.numbers[key.replace("number", "")] = img;
            } else {
                skinImages[key] = img;
            }
        };
    };
    reader.readAsDataURL(file);
}

// CS Preview Functions
function updateSliderPreviews() {
    const cs = parseFloat(document.getElementById('csSlider').value);
    const ar = parseFloat(document.getElementById('arSlider').value);
    const od = parseFloat(document.getElementById('odSlider').value);

    const radius = csToRadius(cs);
    const previewCircle = document.getElementById('previewCircle');
    const diameter = radius * 2;

    previewCircle.style.width = diameter + 'px';
    previewCircle.style.height = diameter + 'px';
    document.getElementById('csValue').textContent = cs.toFixed(1);
    document.getElementById('arValue').textContent = ar.toFixed(1);
    document.getElementById('odValue').textContent = od.toFixed(1);
}

// Game Logic Functions
function playHitSound() {
    if (audioContext.state === "suspended") audioContext.resume();
    if (hitSoundBuffer) {
        const source = audioContext.createBufferSource();
        source.buffer = hitSoundBuffer;
        source.connect(audioContext.destination);
        source.start();
    }
}

function registerHit() {
    if (enforcePlayfieldBoundaries && !isInsidePlayfield(mouseX, mouseY)) return;

    const actualTime = audio.currentTime * playbackRate;
    const time = audio.currentTime;
    if (time - lastHitTime > 0.3) comboCount = 1;
    lastHitTime = time;

    const snapTime = getBeatSnapper(parsedOsuData.sections.TimingPoints, snapSubdivision);
    const snapped = snapTime(actualTime * 1000); // snap in ms using actual time

    let pressedKey = null;
    if (keyDownState[key1]) pressedKey = key1;
    else if (keyDownState[key2]) pressedKey = key2;

    const { osuX, osuY } = screenToOsuCoords(mouseX, mouseY);
    const { left, top, width, height } = getPlayfieldBounds();
    let screenX = left + (osuX / 512) * width;
    let screenY = top + (osuY / 384) * height;

    // Apply edge mode displacement AWAY from center (256,192)
    if (edgeModeEnabled) {
        const radius = csToRadius(parseFloat(document.getElementById('csSlider').value));
        const dx = osuX - 256;
        const dy = osuY - 192;
        const mag = Math.sqrt(dx * dx + dy * dy) || 1; // prevent division by 0
        const nx = dx / mag;
        const ny = dy / mag;
        const offset = 0.99 * radius;

        screenX += nx * offset;
        screenY += ny * offset;

        if (enforcePlayfieldBoundaries) {
            if (
                screenX < left ||
                screenX > left + width ||
                screenY < top ||
                screenY > top + height
            ) return;
        }
    }

    // Push visual feedback and sound
    activeCircles.push({
        type: "hitcircle",
        time: time,
        x: screenX,
        y: screenY,
        size: circleSize,
        combo: comboCount,
        alpha: 1.0
    });

    comboCount++;
    playHitSound();

    // Only store if it's a new snapped time (for replay)
    if (!snappedHitTimes.some(hit => hit.time === snapped)) {
        snappedHitTimes.push({ time: snapped, key: pressedKey });
    }
}

function drawComboNumber(c, x, y, size) {
    const comboStr = (c.combo || 1).toString();
    const numberScale = size / 64;
    const digitWidths = comboStr.split('').map(char => {
        const img = skinImages.numbers[char];
        return img ? img.width * numberScale : 0;
    });
    const totalWidth = digitWidths.reduce((a, b) => a + b, 0);
    let drawX = x - totalWidth / 2;
    
    comboStr.split('').forEach((char, idx) => {
        const digitImg = skinImages.numbers[char];
        if (digitImg) {
            const drawWidth = digitImg.width * numberScale;
            const drawHeight = digitImg.height * numberScale;
            const drawY = y - drawHeight / 2;
            ctx.drawImage(digitImg, drawX, drawY, drawWidth, drawHeight);
            drawX += drawWidth - 10 * numberScale;
        }
    });
}

function getPlayfieldBounds() {
    const rect = playfield.getBoundingClientRect();
    return {
        left: rect.left,
        top: rect.top,
        width: rect.width,
        height: rect.height
    };
}

function isInsidePlayfield(x, y) {
    const { left, top, width, height } = getPlayfieldBounds();
    return x >= left && x <= left + width && y >= top && y <= top + height;
}

function screenToOsuCoords(x, y) {
    const { left, top, width, height } = getPlayfieldBounds();
    const osuX = ((x - left) / width) * 512;
    const osuY = ((y - top) / height) * 384;
    return { osuX, osuY };
}

function parseOsuFile(osuText) {
    const lines = osuText.split(/\r?\n/);
    const sectionMap = {};
    const sectionOrder = [];

    let currentSection = null;

    for (const line of lines) {
        const trimmed = line.trim();

        if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
            currentSection = trimmed.slice(1, -1);
            sectionOrder.push(currentSection);
            sectionMap[currentSection] = [];
        } else if (currentSection) {
            sectionMap[currentSection].push(line); // preserve whitespace for output fidelity
        }
    }

    return {
        sectionOrder,
        sections: sectionMap
    };
}

function buildModifiedOsuFile(mapObjects, parsedOsuData, csValue = 4.0, arValue = 9.0, odValue = 8.0, replayFrames = []) {
    if (!parsedOsuData) return { osuText: null, updatedReplayFrames: replayFrames };
    let updatedReplayFrames = replayFrames.slice(); // clone it first
    const updatedSections = { ...parsedOsuData.sections };

    // --- Modify [Metadata]
    if (updatedSections.Metadata) {
        updatedSections.Metadata = updatedSections.Metadata.map(line =>
            line.startsWith("Version:") ? "Version: Reverse Mapping" : line
        );
    }

    // --- Modify [Difficulty]
    if (updatedSections.Difficulty) {
        updatedSections.Difficulty = updatedSections.Difficulty.map(line => {
            if (line.startsWith("CircleSize:")) return `CircleSize:${csValue}`;
            if (line.startsWith("OverallDifficulty:")) return `OverallDifficulty:${odValue}`;
            if (line.startsWith("ApproachRate:")) return `ApproachRate:${arValue}`;
            if (line.startsWith("HPDrainRate:")) return `HPDrainRate:5`;
            return line;
        });
    }

    let lastTime = -Infinity;
    const hitObjectLines = [];

    for (let i = 0; i < snappedHitTimes.length; i++) {
        const { time: snappedTime, key } = snappedHitTimes[i];
        console.log("Snapped time:", snappedTime, "Key:", key, "key1:", key1, "key2:", key2);

        // Base osu! position
        const originalPos = getInterpolatedReplayPosition(snappedTime);
        let x = originalPos.x;
        let y = originalPos.y;

        // Default hitobject position is original
        let osuX = x;
        let osuY = y;

        if (edgeModeEnabled) {
            const cs = parseFloat(document.getElementById('csSlider').value);
            const osuRadius = 64 * (1 - 0.7 * (cs - 5) / 5); // raw osu! pixels

            // Displace in direction from center (256,192)
            const dx = x - 256;
            const dy = y - 192;
            const mag = Math.sqrt(dx * dx + dy * dy) || 1; // prevent divide-by-zero
            const nx = dx / mag;
            const ny = dy / mag;
            const offset = 0.4 * osuRadius;

            osuX += nx * offset;
            osuY += ny * offset;

            if (enforcePlayfieldBoundaries) {
                if (osuX < 0 || osuX > 512 || osuY < 0 || osuY > 384) {
                    console.log(`Skipping out-of-bounds hitcircle at ${osuX}, ${osuY}`);
                    continue;
                }
            }
        }

        const isNewCombo = i === 0 || (snappedTime - lastTime > 300);
        lastTime = snappedTime;

        const type = 1 + (isNewCombo ? 4 : 0);
        hitObjectLines.push(`${Math.round(osuX)},${Math.round(osuY)},${snappedTime},${type},0,0:0:0:0:`);
        numHitObjects++;

        // Determine buttonMask (Z/X)
        const buttonMask = key === key1 ? 5 : key === key2 ? 10 : 0;

        // Replay stays at original (centered) position
        console.log(`Inserting at ${snappedTime} with mask=${buttonMask}`);
        updatedReplayFrames = insertReplayFrameAtTime(updatedReplayFrames, snappedTime, x, y, buttonMask);
    }
    console.log("After insert:", replayFrames.filter(f => f[3] !== 0));

    updatedSections.HitObjects = hitObjectLines;

    // --- Rebuild file
    const result = parsedOsuData.sectionOrder.map(section => {
        const lines = updatedSections[section];
        return `[${section}]\n${lines.join("\n")}`;
    }).join("\n\n");

    return {
        osuText: result,
        updatedReplayFrames
    };
}

function getInterpolatedReplayPosition(snappedTimeMs) {
    let currentTime = 0;
    let prev = null;

    for (const frame of replayFrames) {
        currentTime += frame[0]; // delta time
        const curr = { time: currentTime, x: frame[1], y: frame[2] };

        if (prev && currentTime >= snappedTimeMs) {
            const t = (snappedTimeMs - prev.time) / (curr.time - prev.time);
            const interpX = prev.x + (curr.x - prev.x) * t;
            const interpY = prev.y + (curr.y - prev.y) * t;
            return { x: interpX, y: interpY };
        }

        prev = { ...curr };
    }

    // Fallback to last known position
    return prev ? { x: prev.x, y: prev.y } : { x: 256, y: 192 };
}

function getBeatSnapper(timingPointLines, subdivision = 4) {
    const bpmPoints = timingPointLines
        .map(line => line.split(","))
        .filter(fields => fields.length >= 8 && fields[6] === "1") // Only uninherited (red lines)
        .map(fields => ({
            time: parseFloat(fields[0]),
            beatLength: parseFloat(fields[1])
        }))
        .sort((a, b) => a.time - b.time);

    return function snapTime(ms) {
        let current = bpmPoints[0];
        for (const tp of bpmPoints) {
            if (ms >= tp.time) current = tp;
            else break;
        }

        const beatLength = current.beatLength / subdivision; // smaller divisions
        const offset = ms - current.time;
        const snappedOffset = Math.round(offset / beatLength) * beatLength;
        return Math.round(current.time + snappedOffset);
    };
}

function renderFrame() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    // Draw active circles
    for (let i = activeCircles.length - 1; i >= 0; i--) {
        const c = activeCircles[i];
        ctx.globalAlpha = c.alpha;
        const x = c.x, y = c.y;
        const size = c.size || circleSize;
        
        if (skinImages.hitcircle) {
            const scale = size / 64 * 1.25; // Fudge factor for skin scaling
            ctx.save();
            ctx.translate(x, y);
            ctx.scale(scale, scale);
            ctx.drawImage(skinImages.hitcircle, -skinImages.hitcircle.width / 2, -skinImages.hitcircle.height / 2);
            if (skinImages.hitcircleOverlay) {
                ctx.drawImage(skinImages.hitcircleOverlay, -skinImages.hitcircleOverlay.width / 2, -skinImages.hitcircleOverlay.height / 2);
            }
            ctx.restore();
            drawComboNumber(c, x, y, size);
        } else {
            ctx.beginPath();
            ctx.arc(x, y, size, 0, Math.PI * 2);
            ctx.strokeStyle = `rgba(255, 0, 255, ${c.alpha})`;
            ctx.lineWidth = 4;
            ctx.stroke();
        }
        
        c.alpha -= 0.04;
        if (c.alpha <= 0) activeCircles.splice(i, 1);
    }

    // Draw cursor trail
    const now = performance.now();
    const fadeDuration = 300;
    const fadeExponent = 1.4;
    if (document.fullscreenElement && skinImages.cursorTrail) {
        for (let i = 0; i < cursorTrailParts.length; i++) {
            const part = cursorTrailParts[i];
            const age = now - part.time;
            if (age > fadeDuration) continue;
            const alpha = Math.pow(1 - age / fadeDuration, fadeExponent);
            ctx.globalAlpha = alpha;
            ctx.drawImage(skinImages.cursorTrail, part.x - skinImages.cursorTrail.width / 2, part.y - skinImages.cursorTrail.height / 2);
        }
    }

    // Draw cursor
    ctx.globalAlpha = 1.0;
    if (document.fullscreenElement) {
        if (skinImages.cursor) {
            ctx.drawImage(skinImages.cursor, mouseX - skinImages.cursor.width / 2, mouseY - skinImages.cursor.height / 2);
        } else {
            ctx.beginPath();
            ctx.arc(mouseX, mouseY, 5, 0, Math.PI * 2);
            ctx.fillStyle = "white";
            ctx.fill();
        }
    }
    
    requestAnimationFrame(renderFrame);
}

// Event Listeners
document.addEventListener("DOMContentLoaded", async () => {
    // Setup keybind buttons
    setupKeybindButton("key1Bind", "key1");
    setupKeybindButton("key2Bind", "key2");

    // Setup CS slider
    document.getElementById('csSlider').addEventListener('input', updateSliderPreviews);
    document.getElementById('arSlider').addEventListener('input', updateSliderPreviews);
    document.getElementById('odSlider').addEventListener('input', updateSliderPreviews);
    updateSliderPreviews();

    // Setup toggle sections
    document.getElementById("customMapToggle").addEventListener("change", function () {
        document.getElementById("mapUploadSection").classList.toggle("hidden", !this.checked);
    });
    document.getElementById("customSkinToggle").addEventListener("change", function () {
        document.getElementById("skinUploadSection").classList.toggle("hidden", !this.checked);
    });

    const edgeToggle = document.getElementById("edgeModeToggle");
    edgeToggle.addEventListener("change", () => {
        edgeModeEnabled = edgeToggle.checked;
    });
    edgeModeEnabled = edgeToggle.checked;

    document.getElementById("snapSelect").addEventListener("input", function () {
        snapSubdivision = parseInt(this.value);
        document.getElementById("snapValue").textContent = `1/${snapSubdivision}`;
    });
    snapSubdivision = parseInt(document.getElementById("snapSelect").value);

    document.getElementById("snapSelect").addEventListener("input", updateSnapBpmDisplay);

    const playbackRateSlider = document.getElementById("playbackRateSlider");
    const playbackRateValue = document.getElementById("playbackRateValue");
    playbackRateSlider.addEventListener("input", function () {
        playbackRate = parseFloat(this.value);
        playbackRateValue.textContent = `${playbackRate.toFixed(2)}x`;
        if (audio) {
            audio.playbackRate = playbackRate;
        }
    });

    document.getElementById("backToMenuBtn").addEventListener("click", () => {
        document.getElementById("resultScreen").style.display = "none";
        document.getElementById("menuScreen").style.display = "block";
    
        // Clean up the generated file
        if (window.generatedOszFileURL) {
            URL.revokeObjectURL(window.generatedOszFileURL);
            window.generatedOszFileURL = null;
        }

        replayFrames = [];
        snappedHitTimes = [];
        lastReplayTime = null;
    });

    const playfieldToggle = document.getElementById("playfieldToggle");
    playfieldToggle.addEventListener("change", (e) => {
        enforcePlayfieldBoundaries = e.target.checked;
        playfield.style.visibility = e.target.checked ? "visible" : "hidden";
    });
    playfield.style.visibility = playfieldToggle.checked ? "visible" : "hidden";
    // Load default .osz file
    try {
        const response = await fetch("770300 Aitsuki Nakuru - Monochrome Butterfly.osz");
        const arrayBuffer = await response.arrayBuffer();
        const zip = await JSZip.loadAsync(arrayBuffer);
        originalZip = zip;
        const files = Object.keys(zip.files);
        const osuFileName = files.find(f => f.endsWith(".osu"));
        const osuText = osuFileName ? await zip.files[osuFileName].async("string") : null;
        if (!osuText) return alert("No valid .osu file found in .osz!");
        parsedOsuData = parseOsuFile(osuText);
        console.log("Parsed .osu file:", parsedOsuData);

        updateSnapBpmDisplay();

        const lines = osuText.split(/\r?\n/);
        let audioFilename = null;
        let backgroundFilename = null;
        for (const line of lines) {
            if (line.startsWith("AudioFilename:")) {
                audioFilename = line.split(":")[1].trim();
            }
            if (line.startsWith("//Background") || line.includes(",\"")) {
                const match = line.match(/"(.*?)"/);
                if (match) backgroundFilename = match[1];
            }
        }
        if (!audioFilename) return alert("No audio file declared in .osu!");
        const audioBlob = await zip.files[audioFilename].async("blob");
        audio = new Audio(URL.createObjectURL(audioBlob));
        audio.playbackRate = playbackRate;
        if (backgroundFilename && zip.files[backgroundFilename]) {
            const bgBlob = await zip.files[backgroundFilename].async("blob");
            const bgUrl = URL.createObjectURL(bgBlob);
            document.getElementById("backgroundLayer").style.backgroundImage = `url(${bgUrl})`;
        }
    } catch (err) {
        console.log("Default map not found, continuing without it");
    }

    // Load default skin
    const skinFiles = [
        "cursor.png", "hitcircle.png", "hitcircleoverlay.png", "cursortrail.png",
        ...Array.from({ length: 10 }, (_, i) => `default-${i}.png`)
    ];
    for (const file of skinFiles) {
        try {
            const response = await fetch(`rafisdt/${file}`);
            if (!response.ok) continue;
            const blob = await response.blob();
            const isNumber = file.startsWith("default-");
            const rawKey = file.split(".")[0];
            const key = isNumber
                ? `number${file.match(/\d/)[0]}`
                : (rawKey === "cursortrail" ? "cursorTrail" : rawKey);
            const f = new File([blob], file);
            loadSkinImage(f, key, isNumber);
        } catch (err) {
            console.log(`Skin file ${file} not found, continuing`);
        }
    }
});

// Skin upload
skinInput.addEventListener("change", async () => {
  const file = skinInput.files[0];
  if (!file) return;

  const zip = new JSZip();
  const contents = await zip.loadAsync(file);

  for (const relativePath in contents.files) {
    const zipEntry = contents.files[relativePath];
    const name = relativePath.toLowerCase();

    if (zipEntry.dir) continue;

    if (name === "cursor.png") loadSkinImage(await zipEntry.async("blob"), "cursor");
    if (name === "hitcircle.png") loadSkinImage(await zipEntry.async("blob"), "hitcircle");
    if (name === "hitcircleoverlay.png") loadSkinImage(await zipEntry.async("blob"), "hitcircleOverlay");
    if (name === "cursortrail.png") loadSkinImage(await zipEntry.async("blob"), "cursorTrail");

    const match = name.match(/default-(\d)\.png/);
    if (match) {
      const index = match[1];
      loadSkinImage(await zipEntry.async("blob"), `number${index}`, true);
    }
  }
});

oszInput.addEventListener("change", async () => {
    const file = oszInput.files[0];
    if (!file) return;

    const arrayBuffer = await file.arrayBuffer();
    const zip = await JSZip.loadAsync(arrayBuffer);
    originalZip = zip;

    const files = Object.keys(zip.files);
    const osuFileName = files.find(f => f.endsWith(".osu"));
    const osuText = osuFileName ? await zip.files[osuFileName].async("string") : null;
    if (!osuText) return alert("No valid .osu file found in uploaded .osz!");

    parsedOsuData = parseOsuFile(osuText);
    console.log("Parsed uploaded .osu file:", parsedOsuData);

    updateSnapBpmDisplay();

    // Load audio
    let audioFilename = null;
    let backgroundFilename = null;
    for (const line of osuText.split(/\r?\n/)) {
        if (line.startsWith("AudioFilename:")) {
            audioFilename = line.split(":")[1].trim();
        }
        if (line.startsWith("//Background") || line.includes(",\"")) {
            const match = line.match(/"(.*?)"/);
            if (match) backgroundFilename = match[1];
        }
    }
    if (!audioFilename) return alert("No audio file declared in uploaded .osu!");
    const audioBlob = await zip.files[audioFilename].async("blob");
    audio = new Audio(URL.createObjectURL(audioBlob));
    audio.playbackRate = playbackRate;

    if (backgroundFilename && zip.files[backgroundFilename]) {
        const bgBlob = await zip.files[backgroundFilename].async("blob");
        const bgUrl = URL.createObjectURL(bgBlob);
        document.getElementById("backgroundLayer").style.backgroundImage = `url(${bgUrl})`;
    }
});

// Mouse movement
canvas.addEventListener("mousemove", (e) => {
    mouseX = e.clientX;
    mouseY = e.clientY;

    canvas.style.cursor = "default";
    clearTimeout(mouseHideTimer);
    mouseHideTimer = setTimeout(() => {
        canvas.style.cursor = "none";
    }, 3000);

    const spacing = 10;
    if (!lastTrailPos || distance(mouseX, mouseY, lastTrailPos.x, lastTrailPos.y) >= spacing) {
        cursorTrailParts.push({ x: mouseX, y: mouseY, time: performance.now() });
        lastTrailPos = { x: mouseX, y: mouseY };
    }
    if (cursorTrailParts.length > 100) cursorTrailParts.shift();
});

// Start button
startButton.addEventListener("click", async () => {
    if (!audio) return alert("Audio not ready yet.");
    
    // Get current CS value and update circle size
    const cs = parseFloat(document.getElementById('csSlider').value);
    circleSize = csToRadius(cs);
    
    await document.documentElement.requestFullscreen().catch(err => {
        alert(`Error attempting to enable fullscreen: ${err.message}`);
    });
    
    menu.style.display = "none";
    playScreen.style.display = "block";
    mapObjects = [];
    audio.currentTime = 0;
    audio.playbackRate = playbackRate;
    audio.play();
    isRecording = true;
    comboCount = 1;
    lastHitTime = 0;
    activeCircles = [];
    cursorTrailParts = [];

    replayIntervalId = setInterval(recordReplayFrame, 1);
});

// Stop button
stopButton.addEventListener("click", () => {
    if (audio) audio.pause();
    isRecording = false;
    document.exitFullscreen();
    if (replayIntervalId !== null) {
        clearInterval(replayIntervalId);
        replayIntervalId = null;
    }
});

document.addEventListener("fullscreenchange", () => {
    if (!document.fullscreenElement) {
        playScreen.style.display = "none";
        document.getElementById("resultScreen").style.display = "block";

        isRecording = false;
        if (audio) audio.pause();

        (async () => {
            if (parsedOsuData && originalZip) {
                const cs = parseFloat(document.getElementById('csSlider').value);
                const ar = parseFloat(document.getElementById('arSlider').value);
                const od = parseFloat(document.getElementById('odSlider').value);

                // Convert mouse positions to replay frames
                let { osuText, updatedReplayFrames } = buildModifiedOsuFile(
                    mapObjects,
                    parsedOsuData,
                    cs,
                    ar,
                    od,
                    replayFrames
                );

                beatmapHash = md5(osuText); // global hash used for replay

                if (osuText) {
                    const newZip = new JSZip();

                    // Copy over non-.osu files
                    for (const filename in originalZip.files) {
                        if (!filename.endsWith(".osu")) {
                            const fileData = await originalZip.files[filename].async("uint8array");
                            newZip.file(filename, fileData);
                        }
                    }

                    // Add new .osu file
                    const newOsuName = "test1map_beatmapfile.osu";
                    newZip.file(newOsuName, osuText);

                    // Generate .osz
                    const oszBlob = await newZip.generateAsync({ type: "blob" });
                    const oszURL = URL.createObjectURL(oszBlob);
                    window.generatedOszFileURL = oszURL;

                    // Hook up .osz download button
                    const downloadBtn = document.getElementById("downloadMapBtn");
                    downloadBtn.onclick = () => {
                        const link = document.createElement("a");
                        link.href = oszURL;
                        link.download = "test1map_beatmapfolder.osz";
                        link.click();
                    };

                    //updatedReplayFrames = extendHitWindow(updatedReplayFrames);
                    logHitReplayFrames(updatedReplayFrames);
                    console.log("Replay frames with clicks:", updatedReplayFrames.filter(f => f[3] !== 0));

                    // 🎯 Generate .osr Blob URL and store it globally
                    const osrURL = await generateOsrFile({
                        osuText: osuText,
                        replayFrames: updatedReplayFrames,
                        username: "ReverseMapper",
                        rngSeed: Math.floor(Math.random() * 1e8),
                        mods: getSelectedModsValue(),
                        numHitObjects: numHitObjects
                    });
                    window.generatedOsrFileURL = osrURL;
                    console.log("All replay frame masks:", updatedReplayFrames.map(f => f[3]));

                    // Hook up .osr download button
                    const replayBtn = document.getElementById("downloadReplayBtn");
                    replayBtn.onclick = () => {
                        const link = document.createElement("a");
                        link.href = osrURL;
                        link.download = "test1map_replay.osr";
                        link.click();
                    };
                }
            }
        })();

        comboCount = 1;
        lastHitTime = 0;
        activeCircles = [];
        cursorTrailParts = [];
    }
});

// Keyboard input
document.addEventListener("keydown", (e) => {
    const key = e.key.toLowerCase();
    if (keyDownState[key]) return;
    keyDownState[key] = true;
    const isKey1 = key === key1;
    const isKey2 = key === key2;
    if (isRecording && (isKey1 || isKey2)) registerHit();
});

document.addEventListener("keyup", (e) => {
    const key = e.key.toLowerCase();
    keyDownState[key] = false;
});

// Start rendering
renderFrame();

let lastReplayTime = null;

function recordReplayFrame() {
    if (!isRecording || !audio) return;

    const actualTime = audio.currentTime * playbackRate * 1000; // ms, adjusted for playback rate
    const delta = lastReplayTime === null ? 0 : Math.round(actualTime - lastReplayTime);
    lastReplayTime = actualTime;

    const { osuX, osuY } = screenToOsuCoords(mouseX, mouseY);

    // Only store mouse position now; buttonMask = 0 (synthesized later)
    replayFrames.push([delta, osuX, osuY, 0]);
}

async function generateOsrFile({ osuText, replayFrames, username = "Player", rngSeed = 123456, mods = 0, numHitObjects = 0}) {
    const frameStrings = replayFrames.map(f => `${f[0]}|${Math.round(f[1])}|${Math.round(f[2])}|${f[3]}`);
    const replayDataString = frameStrings.join(",") + `,-12345|0|0|${rngSeed}`;
    
    const compressedReplayData = await new Promise((resolve) => {
        LZMA.compress(replayDataString, 9, (result) => {
            resolve(new Uint8Array(result));
        });
    });

    const encoder = new BinaryEncoder();

    encoder.writeByte(0); // game mode (0 = osu!)
    encoder.writeInt(20230326); // game version
    encoder.writeOsuString(beatmapHash); // beatmap hash
    encoder.writeOsuString(username); // player name
    encoder.writeOsuString(""); // replay hash
    encoder.writeShort(numHitObjects); // 300s
    encoder.writeShort(0); // 100s
    encoder.writeShort(0); // 50s
    encoder.writeShort(0); // geki
    encoder.writeShort(0); // katu
    encoder.writeShort(0); // miss
    encoder.writeInt(123456); // score
    encoder.writeShort(numHitObjects); // max combo
    encoder.writeByte(1); // perfect
    encoder.writeInt(mods); // mods
    encoder.writeOsuString(""); // life bar graph
    encoder.writeLong(BigInt(Date.now()) * 10_000n); // timestamp in ticks
    encoder.writeInt(compressedReplayData.length); // replay data length
    encoder.writeBytes(compressedReplayData);
    encoder.writeLong(BigInt(0)); // score ID

    const blob = new Blob([encoder.build()], { type: "application/octet-stream" });
    return URL.createObjectURL(blob); // ✅ caller decides when to download
}

class BinaryEncoder {
    constructor() {
        this.data = [];
    }

    writeByte(val) {
        this.data.push(val & 0xFF);
    }

    writeShort(val) {
        this.writeByte(val);
        this.writeByte(val >> 8);
    }

    writeInt(val) {
        for (let i = 0; i < 4; i++) this.writeByte(val >> (i * 8));
    }

    writeLong(bigInt) {
        for (let i = 0; i < 8; i++) this.writeByte(Number((bigInt >> BigInt(i * 8)) & 0xFFn));
    }

    writeBytes(arr) {
        this.data.push(...arr);
    }

    writeOsuString(str) {
        if (!str || str.length === 0) {
            this.writeByte(0x00);
            return;
        }
        this.writeByte(0x0b);
        this.writeULEB128(str.length);
        const encoder = new TextEncoder();
        this.data.push(...encoder.encode(str));
    }

    writeULEB128(value) {
        do {
            let byte = value & 0x7F;
            value >>= 7;
            if (value !== 0) byte |= 0x80;
            this.writeByte(byte);
        } while (value !== 0);
    }

    build() {
        return new Uint8Array(this.data);
    }
}

function insertReplayFrameAtTime(replayFrames, snappedTimeMs, x, y, buttonMask) {
    let result = [];
    let currentTime = 0;

    for (let i = 0; i < replayFrames.length; i++) {
        const [delta, fx, fy, fmask] = replayFrames[i];
        const nextTime = currentTime + delta;

        if (snappedTimeMs <= nextTime) {
            const deltaBefore = snappedTimeMs - currentTime;
            const deltaAfter = nextTime - snappedTimeMs;

            // Add everything before this frame
            for (let j = 0; j < i; j++) {
                result.push(replayFrames[j]);
            }

            // Insert new frame and adjust next one
            result.push([deltaBefore, x, y, buttonMask]);
            result.push([deltaAfter, fx, fy, fmask]);

            // Add remaining frames
            for (let j = i + 1; j < replayFrames.length; j++) {
                result.push(replayFrames[j]);
            }

            return result;
        }

        currentTime = nextTime;
    }

    // If time is after all frames
    const delta = snappedTimeMs - currentTime;
    result.push(...replayFrames); // push all original first
    result.push([delta, x, y, buttonMask]);
    return result;
}

function extendHitWindow(replayFrames, thresholdMs = 50) {
    let result = [];
    let currentTime = 0;

    for (let i = 0; i < replayFrames.length; i++) {
        const [delta, x, y, mask] = replayFrames[i];
        currentTime += delta;
        result.push([delta, x, y, mask]);

        // If this frame has a click (buttonMask != 0)
        if (mask !== 0) {
            let lookaheadTime = currentTime;
            for (let j = i + 1; j < replayFrames.length; j++) {
                const [nextDelta, nextX, nextY, nextMask] = replayFrames[j];
                lookaheadTime += nextDelta;

                if (lookaheadTime - currentTime > thresholdMs) break;

                // Update the mask to preserve click
                replayFrames[j][3] = mask;
            }
        }
    }

    return replayFrames;
}

function logHitReplayFrames(replayFrames) {
    let currentTime = 0;
    replayFrames.forEach(([delta, x, y, buttonMask], index) => {
        currentTime += delta;
        if (buttonMask !== 0) {
            console.log(`Hit Frame ${index}: time=${currentTime}ms, x=${x}, y=${y}, buttonMask=${buttonMask}`);
        }
    });
    console.log(` ? `);
}

function updateSnapBpmDisplay() {
    const select = document.getElementById("snapSelect");
    const infoText = document.getElementById("snapBpmInfo");

    const subdivision = parseInt(select.value); // 1, 2, 3, 4, 6, 8, etc.
    if (!parsedOsuData) {
        infoText.textContent = "–";
        return;
    }

    const timingPoints = parsedOsuData.sections?.TimingPoints || [];
    const firstTiming = timingPoints.find(tp => parseFloat(tp.split(",")[1]) > 0);
    if (!firstTiming) {
        infoText.textContent = "–";
        return;
    }

    const msPerBeat = parseFloat(firstTiming.split(",")[1]); // milliseconds per beat
    const baseBpm = 60000 / msPerBeat;

    const streamBpm = baseBpm * subdivision / 4;
    infoText.textContent = `(Snaps to ${Math.round(streamBpm)} BPM stream)`;
}

function getSelectedModsValue() {
    const checkboxes = document.querySelectorAll('#modCheckboxes input[type="checkbox"]');
    let modValue = 0;

    checkboxes.forEach(checkbox => {
        if (checkbox.checked) {
            modValue |= parseInt(checkbox.value);
        }
    });

    return modValue;
}