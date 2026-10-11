import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import Guide from "./Guide";
import "./styles.css";

document.body.classList.add("guide-page");
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Guide />
  </StrictMode>,
);
