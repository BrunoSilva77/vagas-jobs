import { useState, useEffect } from 'react';
import './App.css';

function App() {
  const [jobs, setJobs] = useState([]);
  const [nextPageToken, setNextPageToken] = useState(null);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [searched, setSearched] = useState(false);
  
  // Form state
  const [area, setArea] = useState('');
  const [location, setLocation] = useState('');
  const [type, setType] = useState('Todos');
  const [level, setLevel] = useState('Todos');

  const handleSearch = async (e) => {
    e.preventDefault();
    setLoading(true);
    setSearched(true);
    
    try {
      const params = new URLSearchParams();
      if (area) params.append('area', area);
      if (location) params.append('location', location);
      if (type) params.append('type', type);
      if (level) params.append('level', level);
      
      const response = await fetch(`http://localhost:3001/api/jobs?${params.toString()}`);
      const data = await response.json();
      setJobs(data.jobs || []);
      setNextPageToken(data.next_page_token || null);
    } catch (error) {
      console.error("Erro ao buscar vagas:", error);
    } finally {
      setLoading(false);
    }
  };

  const handleLoadMore = async () => {
    if (!nextPageToken) return;
    setLoadingMore(true);
    
    try {
      const params = new URLSearchParams();
      if (area) params.append('area', area);
      if (location) params.append('location', location);
      if (type) params.append('type', type);
      if (level) params.append('level', level);
      params.append('page_token', nextPageToken);
      
      const response = await fetch(`http://localhost:3001/api/jobs?${params.toString()}`);
      const data = await response.json();
      
      setJobs(prev => [...prev, ...(data.jobs || [])]);
      setNextPageToken(data.next_page_token || null);
    } catch (error) {
      console.error("Erro ao carregar mais vagas:", error);
    } finally {
      setLoadingMore(false);
    }
  };

  const getTimeAgo = (dateString) => {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now - date;
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMins / 60);
    const diffDays = Math.floor(diffHours / 24);

    if (diffMins < 60) return `${diffMins} min atrás`;
    if (diffHours < 24) return `${diffHours}h atrás`;
    return `${diffDays}d atrás`;
  };

  return (
    <div className="app-container">
      <header className="hero-section">
        <div className="hero-content">
          <h1 className="hero-title">
            Encontre sua próxima <span className="text-gradient">Oportunidade</span>
          </h1>
          <p className="hero-subtitle">
            O agregador definitivo que busca vagas em todas as plataformas e prioriza as mais recentes para você sair na frente.
          </p>
        </div>
      </header>

      <main className="main-content">
        <section className="search-section glass-panel animate-fade-in">
          <form className="search-form" onSubmit={handleSearch}>
            <div className="input-group">
              <label htmlFor="area" className="input-label">Área de Atuação</label>
              <input 
                id="area"
                type="text" 
                className="input-field" 
                placeholder="Ex: Desenvolvedor, Design, Marketing..."
                value={area}
                onChange={(e) => setArea(e.target.value)}
              />
            </div>
            
            <div className="input-group">
              <label htmlFor="location" className="input-label">Local</label>
              <input 
                id="location"
                type="text" 
                className="input-field" 
                placeholder="Ex: São Paulo, RJ, Remoto..."
                value={location}
                onChange={(e) => setLocation(e.target.value)}
              />
            </div>
            
            <div className="input-group">
              <label htmlFor="type" className="input-label">Modalidade</label>
              <select 
                id="type"
                className="input-field"
                value={type}
                onChange={(e) => setType(e.target.value)}
              >
                <option value="Todos">Todas as Modalidades</option>
                <option value="Home Office">Home Office / Remoto</option>
                <option value="Presencial">Presencial</option>
                <option value="Híbrido">Híbrido</option>
              </select>
            </div>
            
            <div className="input-group">
              <label htmlFor="level" className="input-label">Nível</label>
              <select 
                id="level"
                className="input-field"
                value={level}
                onChange={(e) => setLevel(e.target.value)}
              >
                <option value="Todos">Todos os Níveis</option>
                <option value="Estágio">Estágio</option>
                <option value="Júnior">Júnior</option>
                <option value="Pleno">Pleno</option>
                <option value="Sênior">Sênior</option>
              </select>
            </div>
            
            <div className="submit-group">
              <button type="submit" className="btn-primary btn-search" disabled={loading}>
                {loading ? 'Buscando...' : 'Buscar Vagas'}
              </button>
            </div>
          </form>
        </section>

        <section className="results-section">
          {loading && (
            <div className="loader-container">
              <div className="spinner"></div>
              <p>Vasculhando a internet por vagas recentes...</p>
            </div>
          )}
          
          {!loading && searched && jobs.length === 0 && (
            <div className="empty-state glass-panel animate-fade-in">
              <div className="empty-icon">🔍</div>
              <h3>Nenhuma vaga encontrada</h3>
              <p>Tente ajustar seus filtros para ver mais resultados.</p>
            </div>
          )}

          {!loading && jobs.length > 0 && (
            <div className="jobs-header animate-fade-in" style={{animationDelay: '0.1s'}}>
              <h2>{jobs.length} Vagas Encontradas</h2>
              <span className="badge">Ordenado por mais recentes</span>
            </div>
          )}

          <div className="jobs-grid">
            {!loading && jobs.map((job, index) => (
              <article 
                key={job.id} 
                className="job-card glass-panel animate-fade-in"
                style={{animationDelay: `${0.15 + (index * 0.05)}s`}}
              >
                <div className="job-card-header">
                  <div className="job-meta-top">
                    <span className="job-date">⏱ {getTimeAgo(job.date)}</span>
                    <span className={`job-type type-${job.type.replace(/\s+/g, '-').toLowerCase()}`}>
                      {job.type}
                    </span>
                    {job.platform && <span className="tag platform-tag" style={{background: 'var(--primary-color)', color: 'white', padding: '2px 8px', borderRadius: '4px', fontSize: '0.8rem', marginLeft: '8px'}}>{job.platform}</span>}
                  </div>
                  <h3 className="job-title">{job.title}</h3>
                  <div className="job-company-loc">
                    <span className="company">🏢 {job.company}</span>
                    <span className="location">📍 {job.location}</span>
                  </div>
                </div>
                
                <div className="job-card-body">
                  <p className="job-desc">{job.description}</p>
                </div>
                
                <div className="job-card-footer">
                  <div style={{display: 'flex', gap: '0.5rem'}}>
                    {job.area && <span className="job-area">{job.area}</span>}
                    {job.level && <span className="job-area" style={{background: 'rgba(79, 70, 229, 0.2)', color: '#818cf8'}}>{job.level}</span>}
                  </div>
                  <a href={job.url} target="_blank" rel="noopener noreferrer" className="btn-apply">
                    Ver Detalhes
                  </a>
                </div>
              </article>
            ))}
          </div>

          {!loading && jobs.length > 0 && nextPageToken && (
            <div className="load-more-container" style={{ textAlign: 'center', marginTop: '3rem' }}>
              <button 
                onClick={handleLoadMore} 
                className="btn-primary" 
                disabled={loadingMore}
                style={{ padding: '1rem 3rem', fontSize: '1.1rem' }}
              >
                {loadingMore ? 'Carregando...' : 'Carregar Mais Vagas'}
              </button>
            </div>
          )}
        </section>
      </main>
    </div>
  );
}

export default App;
