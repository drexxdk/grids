import { createRoot } from "react-dom/client";
import { LazyMotion, MotionConfig, domAnimation } from "motion/react";
import App from "./App";
import { publishScrollbarWidth } from "./browser/scrollbar";
import "./i18n";
import "../styles.css";

const cleanupScrollbar = publishScrollbarWidth();
if (import.meta.hot) import.meta.hot.dispose(cleanupScrollbar);

const root = document.getElementById("root");
if (!root) throw new Error("The application root is missing.");
createRoot(root).render(
  <LazyMotion features={domAnimation} strict>
    <MotionConfig reducedMotion="user">
      <App />
    </MotionConfig>
  </LazyMotion>,
);
