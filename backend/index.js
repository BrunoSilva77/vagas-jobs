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
  if (query.page_token) return []; // Remotive doesn't support our Google page token, so skip on load more

  try {
    const searchTerms = [query.area, query.level].filter(Boolean).join(' ');
    const url = `https://remotive.com/api/remote-jobs${searchTerms ? `?search=${encodeURIComponent(searchTerms)}` : ''}`;
    
    const response = await axios.get(url, { timeout: 8000 });
    const jobs = response.data.jobs || [];
    
    return jobs.slice(0, 15).map(job => ({
      id: `remotive-${job.id}`,
      title: job.title,
      company: job.company_name,
      location: job.candidate_required_location || 'Remoto Global',
      type: 'Home Office',
      area: job.category,
      level: '', 
      date: job.publication_date,
      description: job.description.replace(/<[^>]*>?/gm, '').substring(0, 200) + '...', 
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
    return { jobs: [], next_page_token: null };
  }

  try {
    // Construct search terms. We intentionally leave out the type from searchTerms if we are going to use chips.
    // However, since chips format can be tricky across regions, appending it to the query is also highly effective.
    let searchTerms = [query.area, query.location, query.level].filter(Boolean).join(' ');
    
    if (query.type === 'Home Office') {
      searchTerms += ' Remoto';
    }

    if (query.source && query.source !== 'Todos') {
      const sourceMap = {
        'LinkedIn': 'site:linkedin.com',
        'InfoJobs': 'site:infojobs.com.br',
        'Gupy': 'site:gupy.io',
        'Vagas.com': 'site:vagas.com.br'
      };
      if (sourceMap[query.source]) {
        searchTerms += ` ${sourceMap[query.source]}`;
      }
    }

    if (!searchTerms) return { jobs: [], next_page_token: null };

    // Build SerpApi URL
    let url = `https://serpapi.com/search.json?engine=google_jobs&q=${encodeURIComponent(searchTerms)}&hl=pt&gl=br&api_key=${apiKey}`;
    
    // Add pagination token if it exists
    if (query.page_token) {
      url += `&next_page_token=${encodeURIComponent(query.page_token)}`;
    }

    // Optional: Add chips if we had specific Google chips, e.g., &chips=date_posted:today

    const response = await axios.get(url, { timeout: 15000 });
    
    const jobs = response.data.jobs_results || [];
    const next_page_token = response.data.serpapi_pagination?.next_page_token || null;
    
    const mappedJobs = jobs.map(job => {
      let type = 'Presencial';
      const locNorm = normalizeText(job.location);
      if (locNorm.includes('remoto') || normalizeText(job.title).includes('remoto') || query.type === 'Home Office') {
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
        date: new Date().toISOString(), 
        description: (job.description || '').substring(0, 200) + '...',
        url: job.related_links ? job.related_links[0]?.link : job.share_link || '#'
      };
    });

    return { jobs: mappedJobs, next_page_token };
  } catch (error) {
    console.error("Erro ao buscar no Google Jobs via SerpApi:", error.message);
    return { jobs: [], next_page_token: null };
  }
}

app.get('/api/jobs', async (req, res) => {
  const { area, location, type, level, source, page_token } = req.query;

  // Se o usuário selecionou uma fonte específica (ex: LinkedIn), pulamos a Remotive.
  const fetchRemotive = (!source || source === 'Todos') 
    ? fetchRemotiveJobs(req.query) 
    : Promise.resolve([]);

  // Busca simultânea
  const [remotiveResults, googleResults] = await Promise.allSettled([
    fetchRemotive,
    fetchGoogleJobs(req.query)
  ]);

  let allJobs = [];
  let nextToken = null;

  if (remotiveResults.status === 'fulfilled') {
    allJobs = [...allJobs, ...remotiveResults.value];
  }
  
  if (googleResults.status === 'fulfilled') {
    allJobs = [...allJobs, ...googleResults.value.jobs];
    nextToken = googleResults.value.next_page_token;
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

  // Fallback se após os filtros não sobrar nada na PRIMEIRA página, tenta usar o mock para não deixar a tela vazia
  if (filteredJobs.length === 0 && !page_token) {
     console.log("Nenhuma vaga real bateu com os filtros. Usando mockData...");
     let mockFiltered = [...mockJobs];
     if (area) mockFiltered = mockFiltered.filter(job => normalizeText(job.title).includes(normalizeText(area)) || normalizeText(job.area).includes(normalizeText(area)));
     if (location) mockFiltered = mockFiltered.filter(job => normalizeText(job.location).includes(normalizeText(location)));
     if (type && type !== 'Todos') mockFiltered = mockFiltered.filter(job => normalizeText(job.type).includes(normalizeText(type)));
     if (level && level !== 'Todos') mockFiltered = mockFiltered.filter(job => normalizeText(job.level).includes(normalizeText(level)) || normalizeText(job.title).includes(normalizeText(level)));
     
     filteredJobs = mockFiltered.sort((a, b) => new Date(b.date) - new Date(a.date));
  }

  // Novo formato de resposta que inclui paginação
  res.json({
    jobs: filteredJobs,
    next_page_token: nextToken
  });
});

app.listen(PORT, () => {
  console.log(`Backend rodando na porta ${PORT}`);
});
