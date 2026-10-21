const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("studio", {
  chooseMap: () => ipcRenderer.invoke("map:choose"),
  openMap: (dir) => ipcRenderer.invoke("map:open", dir),
  saveMap: (dir, size, objects) => ipcRenderer.invoke("map:save", dir, size, objects),
  library: () => ipcRenderer.invoke("library:list"),
  model: (crc) => ipcRenderer.invoke("model:get", crc),
  thumb: (crc) => ipcRenderer.invoke("thumb:get", crc),
  saveThumb: (crc, dataUrl) => ipcRenderer.invoke("thumb:save", crc, dataUrl),
  reveal: (file) => ipcRenderer.invoke("shell:reveal", file),
  onAutoOpen: (cb) => ipcRenderer.on("map:auto-open", (_, dir) => cb(dir)),
  readyForShot: () => ipcRenderer.send("app:ready-for-shot")
});
