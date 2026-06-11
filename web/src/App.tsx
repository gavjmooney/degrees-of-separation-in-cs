import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Explorer } from "./pages/Explorer";

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Explorer />} />
        <Route path="/path/:fromId/:toId" element={<Explorer />} />
      </Routes>
    </BrowserRouter>
  );
}
