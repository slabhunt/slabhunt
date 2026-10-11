import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import Legal from "./Legal";
import "./styles.css";

document.body.classList.add("guide-page");
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Legal />
  </StrictMode>,
);
