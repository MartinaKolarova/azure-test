import { useEffect, useState } from 'react';

function App() {
  const [candidates, setCandidates] = useState([]);
  const [selectedCandidate, setSelectedCandidate] = useState(null);
  const [hired, setHired] = useState(false);

  useEffect(() => {
    fetch('http://localhost:3000/candidates')
      .then((response) => response.json())
      .then((data) => {
        console.log(data);
        setCandidates(data);
      })
      .catch((error) => {
        console.error(error);
      });
  }, []);

  async function loadCandidate(id) {
    try {
      const response = await fetch(`http://localhost:3000/candidates/${id}`);

      const data = await response.json();

      setSelectedCandidate(data[0]);
      setHired(false);
    } catch (error) {
      console.error(error);
    }
  }
  return (
    <div>
      <h1>OCR Candidates</h1>

      {candidates.map((candidate) => (
        <div key={candidate.id}>
          <h2
            onClick={() => loadCandidate(candidate.id)}
            style={{ cursor: 'pointer' }}
          >
            {candidate.file_name}
          </h2>{' '}
        </div>
      ))}
      {selectedCandidate && (
        <div>
          <hr />

          <h2>Candidate Detail</h2>

          <p>
            <strong>ID:</strong> {selectedCandidate.id}
          </p>

          <p>
            <strong>File:</strong> {selectedCandidate.file_name}
          </p>

          <button onClick={() => setHired(true)}>🪓 Hire Lumberjack</button>

          {hired && (
            <div>
              <h3>🌲 Welcome to Nordic Premium Lumber Inc.</h3>

              <p>Trees cut this year: {Math.floor(Math.random() * 1000)}</p>
            </div>
          )}

          <h3>OCR Text</h3>

          <pre>{selectedCandidate.ocr_text}</pre>
        </div>
      )}
    </div>
  );
}

export default App;
