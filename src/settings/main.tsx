import { MotionConfig } from "motion/react";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { useSystemTheme } from "@/lib/theme";
import "@/styles/globals.css";
import { App } from "./App";

function Root() {
  useSystemTheme();
  return (
    <MotionConfig reducedMotion="user">
      <App />
    </MotionConfig>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);
