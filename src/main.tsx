import React from "react";
import { createRoot } from "react-dom/client";
import { Dashboard } from "./ui/Dashboard";
import "./ui/styles.css";
import "./ui/wallet.css";
import "./ui/swap.css";

createRoot(document.getElementById("root")!).render(
  <React.StrictMode><Dashboard /></React.StrictMode>,
);
