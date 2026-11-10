import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { installApiShim } from "@dynotator/ui/utils/api";
import App from "@dynotator/editor";
import "@dynotator/editor/index.css";

installApiShim();

const root = document.getElementById("root");
if (!root) throw new Error("Could not find root element to mount to");

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
