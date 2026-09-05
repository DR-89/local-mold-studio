import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "../app/globals.css";
import { MoldStudio } from "../app/MoldStudio";

createRoot(document.getElementById("root")!).render(
  <StrictMode><MoldStudio /></StrictMode>,
);