import React from "react";
import { createRoot } from "react-dom/client";
import { OrderQueue } from "./OrderQueue.jsx";

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <OrderQueue />
  </React.StrictMode>,
);
