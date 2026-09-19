import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { HomePage } from "./pages/HomePage";
import { InterviewPage } from "./pages/InterviewPage";
import { AdminPage } from "./pages/AdminPage";
import "./App.css";

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/interview/:token" element={<InterviewPage />} />
        <Route path="/admin" element={<AdminPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
