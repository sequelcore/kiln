import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { KilnProvider } from "@kilnai/react";
import { App } from "./app.js";
import "./styles/tokens.css";

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 5000, refetchOnWindowFocus: false } },
});

const baseUrl = window.location.origin;

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <KilnProvider config={{ baseUrl }}>
        <App />
      </KilnProvider>
    </QueryClientProvider>
  </StrictMode>,
);
