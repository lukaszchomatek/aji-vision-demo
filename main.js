const worker = new Worker("worker.js", { type: "module" });

const dropzone = document.getElementById("dropzone");
const fileInput = document.getElementById("file-input");
const previewImage = document.getElementById("preview-image");
const previewResolution = document.getElementById("preview-resolution");
const previewSize = document.getElementById("preview-size");
const generateButton = document.getElementById("generate-button");
const captionBox = document.getElementById("caption-box");
const generationTime = document.getElementById("generation-time");
const backendUsed = document.getElementById("backend-used");
const statusText = document.getElementById("status-text");
const progressBar = document.getElementById("progress-bar");
const backendSelect = document.getElementById("backend-select");
const backendHint = document.getElementById("backend-hint");
const maxTokens = document.getElementById("max-tokens");
const maxTokensValue = document.getElementById("max-tokens-value");
const temperature = document.getElementById("temperature");
const temperatureValue = document.getElementById("temperature-value");
const beamSize = document.getElementById("beam-size");
const beamSizeValue = document.getElementById("beam-size-value");
const twoPass = document.getElementById("two-pass");
const storeThumbnails = document.getElementById("store-thumbnails");
const historyList = document.getElementById("history-list");
const clearHistory = document.getElementById("clear-history");

const historyLimit = 6;
const pendingRequests = new Map();
let requestId = 0;
let currentImage = null;
let currentThumbnail = null;

const historyDB = (() => {
  const dbName = "caption-history";
  const storeName = "items";

  const openDB = () =>
    new Promise((resolve, reject) => {
      const request = indexedDB.open(dbName, 1);
      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        if (!db.objectStoreNames.contains(storeName)) {
          db.createObjectStore(storeName, { keyPath: "id" });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });

  const withStore = async (mode, callback) => {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(storeName, mode);
      const store = transaction.objectStore(storeName);
      const result = callback(store);
      transaction.oncomplete = () => resolve(result);
      transaction.onerror = () => reject(transaction.error);
    });
  };

  const list = async () => {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(storeName, "readonly");
      const store = transaction.objectStore(storeName);
      const request = store.getAll();
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error);
    });
  };

  const clear = () => withStore("readwrite", (store) => store.clear());

  const put = (item) => withStore("readwrite", (store) => store.put(item));

  return { list, clear, put };
})();

const updateRange = (input, output, formatter = (value) => value) => {
  const update = () => {
    output.textContent = formatter(input.value);
  };
  input.addEventListener("input", update);
  update();
};

updateRange(maxTokens, maxTokensValue);
updateRange(temperature, temperatureValue, (value) => Number(value).toFixed(2));
updateRange(beamSize, beamSizeValue);

const setStatus = (message, progress = null) => {
  statusText.textContent = message;
  if (progress !== null) {
    progressBar.style.width = `${Math.round(progress * 100)}%`;
  }
};

const setCaption = (text) => {
  captionBox.textContent = text;
};

const setGenerateState = (enabled) => {
  generateButton.disabled = !enabled;
};

const handleImageFile = async (file) => {
  if (!file) return;

  const dataUrl = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });

  previewImage.src = dataUrl;
  previewImage.alt = file.name || "Podgląd";

  const image = await loadImage(dataUrl);
  previewResolution.textContent = `${image.width} × ${image.height}px`;
  previewSize.textContent = `${Math.round(file.size / 1024)} KB`;

  const { imageData, resized } = await createImageData(image, 1024);
  currentImage = imageData;
  currentThumbnail = resized.thumbnail;

  if (resized.changed) {
    previewResolution.textContent = `${image.width} × ${image.height}px (przeskalowano do ${resized.width} × ${resized.height}px)`;
  }

  setGenerateState(true);
  setCaption("Gotowe do generacji opisu.");
};

const loadImage = (src) =>
  new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = (error) => reject(error);
    img.src = src;
  });

const createImageData = async (img, maxSize) => {
  const scale = Math.min(1, maxSize / Math.max(img.width, img.height));
  const width = Math.round(img.width * scale);
  const height = Math.round(img.height * scale);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(img, 0, 0, width, height);
  const imageData = ctx.getImageData(0, 0, width, height);

  const thumbCanvas = document.createElement("canvas");
  const thumbScale = Math.min(1, 96 / Math.max(img.width, img.height));
  thumbCanvas.width = Math.round(img.width * thumbScale);
  thumbCanvas.height = Math.round(img.height * thumbScale);
  const thumbCtx = thumbCanvas.getContext("2d");
  thumbCtx.drawImage(img, 0, 0, thumbCanvas.width, thumbCanvas.height);
  const thumbnail = thumbCanvas.toDataURL("image/jpeg", 0.7);

  return {
    imageData,
    resized: {
      changed: scale < 1,
      width,
      height,
      thumbnail,
    },
  };
};

const sendToWorker = (payload) => {
  const id = ++requestId;
  return new Promise((resolve, reject) => {
    pendingRequests.set(id, { resolve, reject });
    worker.postMessage({ ...payload, id });
  });
};

worker.addEventListener("message", (event) => {
  const { type, id, payload } = event.data;
  if (type === "status") {
    setStatus(payload.message, payload.progress);
  }
  if (type === "backend") {
    backendHint.textContent = payload.message;
  }
  if (type === "ready") {
    backendUsed.textContent = payload.backend;
  }
  if (type === "result" || type === "error") {
    const request = pendingRequests.get(id);
    if (!request) return;
    pendingRequests.delete(id);
    if (type === "result") {
      request.resolve(payload);
    } else {
      request.reject(payload);
    }
  }
});

const runGeneration = async () => {
  if (!currentImage) {
    setCaption("Najpierw wybierz obraz.");
    return;
  }

  setGenerateState(false);
  setCaption("Generuję opis…");
  generationTime.textContent = "–";

  const options = {
    maxNewTokens: Number(maxTokens.value),
    temperature: Number(temperature.value),
    numBeams: Number(beamSize.value),
  };

  const backendPreference = backendSelect.value;
  const runs = twoPass.checked ? 2 : 1;
  const timings = [];
  let lastCaption = "";

  try {
    for (let i = 0; i < runs; i += 1) {
      const result = await sendToWorker({
        type: "generate",
        image: currentImage,
        options,
        backendPreference,
      });
      lastCaption = result.caption;
      timings.push(result.timeMs);
    }

    setCaption(lastCaption);
    const timeLabel =
      timings.length === 2
        ? `cold ${timings[0].toFixed(0)} ms / warm ${timings[1].toFixed(0)} ms`
        : `${timings[0].toFixed(0)} ms`;
    generationTime.textContent = timeLabel;

    const historyItem = {
      id: `${Date.now()}`,
      caption: lastCaption,
      timeLabel,
      timestamp: new Date().toISOString(),
      thumbnail: storeThumbnails.checked ? currentThumbnail : null,
    };
    await historyDB.put(historyItem);
    await renderHistory();
  } catch (error) {
    setCaption(`Błąd generacji: ${error?.message || error}`);
  } finally {
    setGenerateState(true);
  }
};

const renderHistory = async () => {
  const items = await historyDB.list();
  items.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  const trimmed = items.slice(0, historyLimit);
  historyList.innerHTML = "";

  for (const item of trimmed) {
    const li = document.createElement("li");
    li.className = "history-item";
    if (item.thumbnail) {
      const img = document.createElement("img");
      img.src = item.thumbnail;
      img.alt = "Miniatura";
      li.appendChild(img);
    } else {
      const placeholder = document.createElement("div");
      placeholder.className = "history-placeholder";
      placeholder.textContent = "Brak miniatury";
      li.appendChild(placeholder);
    }
    const content = document.createElement("div");
    const caption = document.createElement("p");
    caption.textContent = item.caption;
    const timestamp = document.createElement("span");
    timestamp.className = "timestamp";
    timestamp.textContent = `${new Date(item.timestamp).toLocaleString()} · ${item.timeLabel}`;
    content.append(caption, timestamp);
    li.appendChild(content);
    historyList.appendChild(li);
  }
};

clearHistory.addEventListener("click", async () => {
  await historyDB.clear();
  historyList.innerHTML = "";
});

generateButton.addEventListener("click", runGeneration);

fileInput.addEventListener("change", (event) => {
  handleImageFile(event.target.files[0]);
});

["dragenter", "dragover"].forEach((eventName) => {
  dropzone.addEventListener(eventName, (event) => {
    event.preventDefault();
    dropzone.classList.add("drag");
  });
});

["dragleave", "drop"].forEach((eventName) => {
  dropzone.addEventListener(eventName, (event) => {
    event.preventDefault();
    dropzone.classList.remove("drag");
  });
});

dropzone.addEventListener("drop", (event) => {
  const file = event.dataTransfer.files[0];
  handleImageFile(file);
});

backendSelect.addEventListener("change", () => {
  backendHint.textContent = "Ustawienie backendu zostanie użyte przy następnym generowaniu.";
});

(async () => {
  await renderHistory();
  setStatus("Oczekiwanie na obraz…", 0);
  worker.postMessage({ type: "probe" });
})();
