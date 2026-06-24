import express from 'express';
import cors from 'cors';
import axios from 'axios';
import dotenv from 'dotenv';
import { mockJobs } from './mockData.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

const normalizeText = (text) => {
  return text ? text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase() : '';
};

// Fetch from Remotive (Open API)
async function fetchRemotiveJobs(query) {
  try {
    const searchTerms = [query.area, query.level].filter(Boolean).join(' ');
    const url = `https://remotive.com/api/remote-jobs${searchTerms ? `?search=${encodeURIComponent(searchTerms)}` : ''}`;
    
    const response = await axios.get(url, { timeout: 8000 });
    const jobs = response.data.jobs || [];
    
    return jobs.slice(0, 30).map(job => ({
      id: `remotive-${job.id}`,
      title: job.title,
      company: job.company_name,
      location: job.candidate_required_location || 'Remoto Global',
      type: 'Home Office',
      area: job.category,
      level: '', 
      date: job.publication_date,
      description: job.description.replace(/<[^>]*>?/gm, '').substring(0, 200) + '...', // Basic HTML strip
      url: job.url
    }));
  } catch (error) {
    console.error("Erro ao buscar no Remotive:", error.message);
    return [];
  }
}

// Fetch from SerpApi (Google Jobs)
async function fetchGoogleJobs(query) {
  const apiKey = process.env.SERPAPI_KEY;
  if (!apiKey) {
    console.log("SERPAPI_KEY não configurada. Pulando busca no Google Jobs.");
    return [];
  }

  try {
    const searchTerms = [query.area, query.location, query.level].filter(Boolean).join(' ');
    if (!searchTerms) return []; 

    const url = `https://serpapi.com/search.json?engine=google_jobs&q=${encodeURIComponent(searchTerms)}&hl=pt&gl=br&api_key=${apiKey}`;
    const response = await axios.get(url, { timeout: 8000 });
    
    const jobs = response.data.jobs_results || [];
    
    return jobs.map(job => {
      let type = 'Presencial';
      const locNorm = normalizeText(job.location);
      if (locNorm.includes('remoto') || normalizeText(job.title).includes('remoto')) {
        type = 'Home Office';
      } else if (locNorm.includes('hibrido')) {
        type = 'Híbrido';
      }

      return {
        id: `google-${job.job_id || Math.random().toString(36).substr(2, 9)}`,
        title: job.title,
        company: job.company_name,
        location: job.location,
        type: type,
        area: query.area || 'Diversos',
        level: '',
        date: new Date().toISOString(), // Fallback
        description: (job.description || '').substring(0, 200) + '...',
        url: job.related_links ? job.related_links[0]?.link : job.share_link || '#'
      };
    });
  } catch (error) {
    console.error("Erro ao buscar no Google Jobs via SerpApi:", error.message);
    return [];
  }
}

app.get('/api/jobs', async (req, res) => {
  const { area, location, type, level } = req.query;

  // Busca simultânea
  const [remotiveResults, googleResults] = await Promise.allSettled([
    fetchRemotiveJobs(req.query),
    fetchGoogleJobs(req.query)
  ]);

  let allJobs = [];

  if (remotiveResults.status === 'fulfilled') {
    allJobs = [...allJobs, ...remotiveResults.value];
  }
  
  if (googleResults.status === 'fulfilled') {
    allJobs = [...allJobs, ...googleResults.value];
  }

  if (allJobs.length === 0) {
    console.log("Nenhuma vaga encontrada nas APIs. Usando mockData de fallback.");
    allJobs = [...mockJobs];
  }

  // Pós-processamento de Filtros
  let filteredJobs = allJobs;

  if (area) {
    const areaNorm = normalizeText(area);
    filteredJobs = filteredJobs.filter(job => 
      normalizeText(job.title).includes(areaNorm) ||
      normalizeText(job.area).includes(areaNorm) ||
      normalizeText(job.description).includes(areaNorm)
    );
  }

  if (location) {
    const locNorm = normalizeText(location);
    filteredJobs = filteredJobs.filter(job => 
      normalizeText(job.location).includes(locNorm) || 
      normalizeText(job.type).includes('home office') 
    );
  }

  if (type && type !== 'Todos') {
    const typeNorm = normalizeText(type);
    filteredJobs = filteredJobs.filter(job => 
      normalizeText(job.type).includes(typeNorm)
    );
  }

  if (level && level !== 'Todos') {
    const levelNorm = normalizeText(level);
    filteredJobs = filteredJobs.filter(job => {
      const inLevelField = job.level && normalizeText(job.level).includes(levelNorm);
      const inTitleField = job.title && normalizeText(job.title).includes(levelNorm);
      return inLevelField || inTitleField;
    });
  }

  filteredJobs.sort((a, b) => new Date(b.date) - new Date(a.date));

  res.json(filteredJobs);
});

app.listen(PORT, () => {
  console.log(`Backend rodando na porta ${PORT}`);
});
