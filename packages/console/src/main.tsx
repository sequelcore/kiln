import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "@tanstack/react-router";
import { router } from "./router";
import { KilnSocketProvider } from "./hooks/useKilnSocket";
import "./main.css";

const rootElement = document.getElementById("root");
if (!rootElement) throw new Error("Root element not found");

createRoot(rootElement).render(
  <StrictMode>
    <KilnSocketProvider>
      <RouterProvider router={router} />
    </KilnSocketProvider>
  </StrictMode>,
);
