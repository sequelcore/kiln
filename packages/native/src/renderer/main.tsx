import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { NativeSurfaceApp } from "./native-surface-app.js";

const rootElement = document.getElementById("root");

if (!rootElement) {
  throw new Error("Native root element not found");
}

createRoot(rootElement).render(
  <StrictMode>
    <NativeSurfaceApp />
  </StrictMode>,
);
