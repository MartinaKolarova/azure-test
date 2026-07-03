import { useEffect, useState } from 'react';

function App() {
  const [candidates, setCandidates] = useState([]);
  const [selectedCandidate, setSelectedCandidate] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [aiQuestion, setAiQuestion] = useState('');
  const [aiAnswer, setAiAnswer] = useState(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState(null);

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

  async function askAi() {
    if (!aiQuestion.trim()) {
      return;
    }

    setAiLoading(true);
    setAiError(null);
    setAiAnswer(null);

    try {
      const encodedQuestion = encodeURIComponent(aiQuestion);

      const response = await fetch(
        `http://localhost:3000/candidates/rag-answer/${encodedQuestion}`,
      );

      if (!response.ok) {
        throw new Error(`AI API error: ${response.status}`);
      }

      const data = await response.json();

      console.log('AI answer:', data);

      setAiAnswer(data);
    } catch (error) {
      console.error(error);
      setAiError(error.message);
    } finally {
      setAiLoading(false);
    }
  }

  return (
    <div style={{ padding: '24px', fontFamily: 'Arial, sans-serif' }}>
      <h1>OCR Candidates</h1>
      <div
        style={{
          border: '1px solid #ccc',
          padding: '16px',
          marginBottom: '24px',
          borderRadius: '8px',
        }}
      >
        <h2>AI vyhodnocení kandidátů</h2>

        <textarea
          value={aiQuestion}
          onChange={(event) => setAiQuestion(event.target.value)}
          placeholder="Zeptej se na kandidáty..."
          rows={3}
          style={{
            width: '100%',
            padding: '8px',
            marginBottom: '8px',
            fontFamily: 'Arial, sans-serif',
          }}
        />

        <button onClick={askAi} disabled={aiLoading || !aiQuestion.trim()}>
          {aiLoading ? 'AI přemýšlí...' : 'Zeptat se AI'}
        </button>

        {aiError && (
          <p style={{ color: 'red' }}>
            <strong>AI error:</strong> {aiError}
          </p>
        )}

        {aiAnswer && (
          <div style={{ marginTop: '16px' }}>
            <h3>Odpověď</h3>

            <div
              style={{
                whiteSpace: 'pre-wrap',
                background: '#f5f5f5',
                padding: '12px',
                borderRadius: '8px',
                lineHeight: 1.5,
              }}
            >
              {aiAnswer.answer}
            </div>
            <p>
              <strong>Nalezeno kandidátů:</strong>{' '}
              {aiAnswer.retrieved_candidates_count}
            </p>
          </div>
        )}
      </div>

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
              color: 'white',
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
