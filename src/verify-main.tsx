import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import Verify from "./Verify";
import "./styles.css";

document.body.classList.add("guide-page");
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Verify />
  </StrictMode>,
);
