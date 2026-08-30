/// <reference types="vite/client" />

interface HostApi {
  getRuntime: () => 'electron'
}

interface Window {
  api?: HostApi
}
