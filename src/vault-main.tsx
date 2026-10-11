import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import VaultDeposit from "./components/VaultDeposit";
import "./styles.css";

document.body.classList.add("guide-page");
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <div className="app">
      <header>
        <div className="logo">Slab <span>Hunt</span></div>
        <a href="/" className="btn ghost small" style={{marginLeft: 'auto'}}>slabhunt.fun</a>
      </header>
      <main style={{padding: '20px', overflow: 'auto'}}>
        <VaultDeposit />
      </main>
    </div>
  </StrictMode>,
);
