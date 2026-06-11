import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import { UploadPage } from '@/pages/UploadPage';
import { ReviewPage } from '@/pages/ReviewPage';
import { AdminPage } from '@/pages/AdminPage';
import { ScanResultPage } from '@/pages/ScanResultPage';
import { ComplianceCenterPage } from '@/pages/ComplianceCenterPage';

export default function App() {
  return (
    <Router>
      <Routes>
        <Route path="/" element={<UploadPage />} />
        <Route path="/review/:token" element={<ReviewPage />} />
        <Route path="/admin/:docId" element={<AdminPage />} />
        <Route path="/compliance" element={<ComplianceCenterPage />} />
        <Route path="/compliance/:tab" element={<ComplianceCenterPage />} />
        <Route path="/scan/:scanId" element={<ScanResultPage />} />
        <Route path="/scan/doc/:docId" element={<ScanResultPage />} />
        <Route path="*" element={<UploadPage />} />
      </Routes>
    </Router>
  );
}
