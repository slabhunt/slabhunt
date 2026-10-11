import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import Signup from "./Signup";
import "./styles.css";

document.body.classList.add("signup-page");
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Signup />
  </StrictMode>,
);
