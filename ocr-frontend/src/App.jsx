import { useEffect, useState } from 'react';

function App() {
  const [candidates, setCandidates] = useState([]);
  const [selectedCandidate, setSelectedCandidate] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    async function loadCandidates() {
      try {
        const response = await fetch('http://localhost:3000/candidates');

        if (!response.ok) {
          throw new Error(`API error: ${response.status}`);
        }

        const data = await response.json();

        console.log('Candidates from API:', data);

        setCandidates(data);
      } catch (error) {
        console.error(error);
        setError(error.message);
      } finally {
        setLoading(false);
      }
    }

    loadCandidates();
  }, []);

  return (
    <div style={{ padding: '24px', fontFamily: 'Arial, sans-serif' }}>
      <h1>OCR Candidates</h1>

      {loading && <p>Loading candidates...</p>}

      {error && (
        <p style={{ color: 'red' }}>
          <strong>Error:</strong> {error}
        </p>
      )}

      {!loading && !error && (
        <p>
          <strong>Loaded candidates:</strong> {candidates.length}
        </p>
      )}

      {!loading && !error && candidates.length === 0 && (
        <p>No candidates returned from API.</p>
      )}

      <div>
        {candidates.map((candidate) => (
          <div
            key={candidate.id}
            onClick={() => setSelectedCandidate(candidate)}
            style={{
              border: '1px solid #ccc',
              padding: '12px',
              marginBottom: '12px',
              cursor: 'pointer',
            }}
          >
            <h2>
              {candidate.full_name ||
                candidate.file_name ||
                `Candidate ${candidate.id}`}
            </h2>

            <p>
              <strong>ID:</strong> {candidate.id}
            </p>

            <p>
              <strong>Email:</strong> {candidate.email || '—'}
            </p>

            <p>
              <strong>Phone:</strong> {candidate.phone || '—'}
            </p>

            <p>
              <strong>Status:</strong> {candidate.status || '—'}
            </p>

            <p>
              <strong>File:</strong> {candidate.file_name || '—'}
            </p>
          </div>
        ))}
      </div>

      {selectedCandidate && (
        <div style={{ marginTop: '32px' }}>
          <hr />

          <h2>Candidate Detail</h2>

          <p>
            <strong>ID:</strong> {selectedCandidate.id}
          </p>

          <p>
            <strong>Name:</strong> {selectedCandidate.full_name || '—'}
          </p>

          <p>
            <strong>Email:</strong> {selectedCandidate.email || '—'}
          </p>

          <p>
            <strong>Phone:</strong> {selectedCandidate.phone || '—'}
          </p>

          <p>
            <strong>Status:</strong> {selectedCandidate.status || '—'}
          </p>

          <p>
            <strong>File:</strong> {selectedCandidate.file_name || '—'}
          </p>

          <h3>OCR Text</h3>

          <pre
            style={{
              whiteSpace: 'pre-wrap',
              background: '#e5a9e0ea',
              padding: '12px',
              fontcolor: 'white',
              borderRadius: '15px',
            }}
          >
            {selectedCandidate.ocr_text || 'No OCR text available.'}
          </pre>
        </div>
      )}
    </div>
  );
}

export default App;
