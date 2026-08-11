import { BrowserRouter, Route, Routes } from "react-router-dom";
import { About } from "./pages/About";
import { Explorer } from "./pages/Explorer";
import { Records } from "./pages/Records";
import { ThemeProvider } from "./theme";

export function App() {
  return (
    <ThemeProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Explorer />} />
          <Route path="/path/:fromId/:toId" element={<Explorer />} />
          <Route path="/about" element={<About />} />
          <Route path="/records" element={<Records />} />
        </Routes>
      </BrowserRouter>
    </ThemeProvider>
  );
}
