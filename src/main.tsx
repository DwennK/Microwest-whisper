import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { loadInterfaceLanguage } from "./lib/i18n";
import "./styles.css";

void loadInterfaceLanguage().then(() => {
  ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
});
