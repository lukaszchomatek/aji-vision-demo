import { env, pipeline } from "https://cdn.jsdelivr.net/npm/@xenova/transformers@2.17.2/dist/transformers.mjs";

env.allowLocalModels = false;
env.useBrowserCache = true;

env.backends.onnx.wasm.numThreads = 1;

env.backends.webgpu = {
  enabled: true,
};

env.backends.onnx.wasm = {
  enabled: true,
};

const modelName = "Xenova/blip-image-captioning-base";
let captioner = null;
let activeBackend = null;

const sendStatus = (message, progress = null) => {
  self.postMessage({ type: "status", payload: { message, progress } });
};

const isWebGpuAvailable = () => typeof navigator !== "undefined" && !!navigator.gpu;

const resolveBackend = (preference) => {
  if (preference === "webgpu") {
    return isWebGpuAvailable() ? "webgpu" : "wasm";
  }
  if (preference === "wasm") {
    return "wasm";
  }
  return isWebGpuAvailable() ? "webgpu" : "wasm";
};

const ensurePipeline = async (backend) => {
  if (captioner && activeBackend === backend) {
    return captioner;
  }

  captioner = null;
  activeBackend = backend;
  sendStatus(`Ładowanie modelu (${backend})…`, 0);

  captioner = await pipeline("image-to-text", modelName, {
    device: backend,
    progress_callback: (progress) => {
      if (progress.status === "progress") {
        sendStatus(`Pobieranie modelu (${backend})`, progress.progress);
      }
      if (progress.status === "done") {
        sendStatus(`Model gotowy (${backend}).`, 1);
      }
    },
  });

  self.postMessage({ type: "ready", payload: { backend } });
  return captioner;
};

self.addEventListener("message", async (event) => {
  const { type, id, image, options, backendPreference } = event.data;

  if (type === "probe") {
    const available = isWebGpuAvailable();
    self.postMessage({
      type: "backend",
      payload: {
        message: available
          ? "WebGPU dostępne. Możesz przełączyć na tryb GPU."
          : "WebGPU niedostępne, używany będzie fallback WASM.",
      },
    });
    return;
  }

  if (type === "generate") {
    const backend = resolveBackend(backendPreference);
    try {
      const pipelineInstance = await ensurePipeline(backend);
      const start = performance.now();
      const result = await pipelineInstance(image, {
        max_new_tokens: options.maxNewTokens,
        temperature: options.temperature,
        num_beams: options.numBeams,
        return_full_text: false,
      });
      const end = performance.now();

      const caption = Array.isArray(result) ? result[0]?.generated_text : result.generated_text;
      self.postMessage({
        type: "result",
        id,
        payload: { caption: caption || "(brak wyniku)", timeMs: end - start, backend },
      });
    } catch (error) {
      self.postMessage({
        type: "error",
        id,
        payload: { message: error?.message || String(error) },
      });
    }
  }
});
