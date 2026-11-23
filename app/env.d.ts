declare global {
  const __BUILD_SHA__: string;
  const __BUILD_TIME__: string;

  interface Window {
    hire?: () => string;
  }
}

export {};
