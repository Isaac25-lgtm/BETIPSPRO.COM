import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@fontsource-variable/inter/wght.css";
import "@fontsource-variable/inter-tight/wght.css";
import "./styles/tokens.css";
import "./styles/base.css";
import "./styles/layout.css";
import "./styles/home.css";
import "./styles/pages.css";
import { AppRouter } from "./app/router";

// Testing-phase reference assets (D-029): lets CSS use the reference stadium image in page headers.
if (import.meta.env.VITE_LOCAL_REFERENCE_HERO === "true") document.documentElement.classList.add("ref-assets");

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <AppRouter />
  </StrictMode>,
);
