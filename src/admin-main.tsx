import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import Admin from "./Admin";
import "./styles.css";

document.body.classList.add("guide-page", "admin-page");
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Admin />
  </StrictMode>,
);
