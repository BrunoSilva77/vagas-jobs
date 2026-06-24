import express from 'express';
import cors from 'cors';
import axios from 'axios';
import * as cheerio from 'cheerio';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

const normalizeText = (text) => {
  return text ? text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase() : '';
};

const parsePostedAt = (postedAt) => {
  if (!postedAt) return new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(); // Padrão para 30 dias atrás se não houver data
  
  const now = new Date();
  const match = postedAt.match(/(\d+)\s+(min|hora|dia|mês|mes|ano)/i);
  
  if (match) {
    const amount = parseInt(match[1], 10);
    const unit = match[2].toLowerCase();
    
    if (unit.startsWith('min')) {
      now.setMinutes(now.getMinutes() - amount);
    } else if (unit.startsWith('hora')) {
      now.setHours(now.getHours() - amount);
    } else if (unit.startsWith('dia')) {
      now.setDate(now.getDate() - amount);
    } else if (unit.startsWith('mês') || unit.startsWith('mes')) {
      now.setMonth(now.getMonth() - amount);
    } else if (unit.startsWith('ano')) {
      now.setFullYear(now.getFullYear() - amount);
    }
  }
  return now.toISOString();
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
      url: job.url,
      platform: 'Remotive'
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
    let searchTerms = [query.area, query.location || 'Brasil', query.level].filter(Boolean).join(' ');
    
    if (query.type === 'Home Office') {
      searchTerms += ' Remoto';
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

      const applyLink = job.apply_options && job.apply_options.length > 0 ? job.apply_options[0].link : null;
      if (!applyLink) return null; // Ignora vagas que só têm link do Google
      
      const finalUrl = applyLink;
      
      let platform = 'Web';
      if (finalUrl !== '#') {
        const urlLower = finalUrl.toLowerCase();
        if (urlLower.includes('linkedin')) platform = 'LinkedIn';
        else if (urlLower.includes('infojobs')) platform = 'InfoJobs';
        else if (urlLower.includes('gupy')) platform = 'Gupy';
        else if (urlLower.includes('vagas.com')) platform = 'Vagas.com';
        else if (urlLower.includes('catho')) platform = 'Catho';
        else if (urlLower.includes('glassdoor')) platform = 'Glassdoor';
        else if (urlLower.includes('indeed')) platform = 'Indeed';
        else {
          try {
            const domain = new URL(finalUrl).hostname.replace('www.', '');
            platform = domain.split('.')[0];
            platform = platform.charAt(0).toUpperCase() + platform.slice(1);
          } catch (e) {}
        }
      }

      return {
        id: `google-${job.job_id || Math.random().toString(36).substr(2, 9)}`,
        title: job.title,
        company: job.company_name,
        location: job.location,
        type: type,
        area: query.area || 'Diversos',
        level: '',
        date: parsePostedAt(job.detected_extensions?.posted_at), 
        description: (job.description || '').substring(0, 200) + '...',
        url: finalUrl,
        platform: platform
      };
    }).filter(Boolean); // Remove os nulls

    return { jobs: mappedJobs, next_page_token };
  } catch (error) {
    console.error("Erro ao buscar no Google Jobs via SerpApi:", error.message);
    return { jobs: [], next_page_token: null };
  }
}

// Fetch LinkedIn (Direct Scraper)
async function fetchLinkedInJobs(query) {
  if (query.page_token) return []; // Ignore on pagination for now

  const jobs = [];
  try {
    const area = query.area || 'Desenvolvedor';
    const location = query.location || 'Brasil';
    let keywords = area;
    if (query.level && query.level !== 'Todos') {
      keywords += ` ${query.level}`;
    }
    if (query.type === 'Home Office') keywords += ' Remoto';

    const url = `https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search?keywords=${encodeURIComponent(keywords)}&location=${encodeURIComponent(location)}&f_TPR=r604800&start=0`;
    
    const { data } = await axios.get(url, { timeout: 10000 });
    const $ = cheerio.load(data);

    $('li').each((i, el) => {
      const title = $(el).find('h3.base-search-card__title').text().trim();
      const company = $(el).find('h4.base-search-card__subtitle').text().trim();
      const jobLocation = $(el).find('span.job-search-card__location').text().trim();
      const link = $(el).find('a.base-card__full-link').attr('href');
      const dateText = $(el).find('time').attr('datetime'); // YYYY-MM-DD
      
      if (title && link) {
        let jobType = 'Diversos';
        if (query.type && query.type !== 'Todos') jobType = query.type;
        else if (title.toLowerCase().includes('remoto') || title.toLowerCase().includes('remote')) jobType = 'Home Office';
        else if (title.toLowerCase().includes('híbrido') || title.toLowerCase().includes('hybrid')) jobType = 'Híbrido';

        jobs.push({
          id: `linkedin-${Math.random().toString(36).substr(2, 9)}`,
          title,
          company,
          location: jobLocation,
          type: jobType,
          area: query.area || 'Diversos',
          level: '',
          date: dateText ? new Date(dateText).toISOString() : new Date().toISOString(),
          description: 'Acesse o LinkedIn para ver os detalhes completos desta vaga recém-postada.',
          url: link,
          platform: 'LinkedIn'
        });
      }
    });
  } catch (e) {
    console.error("Erro no LinkedIn Scraper:", e.message);
  }
  return jobs;
}

app.get('/api/jobs', async (req, res) => {
  const query = req.query;
  let remotiveJobs = [];
  let googleData = { jobs: [], next_page_token: null };
  let linkedinJobs = [];

  if (query.page_token) {
    googleData = await fetchGoogleJobs(query);
  } else {
    [remotiveJobs, googleData, linkedinJobs] = await Promise.all([
      fetchRemotiveJobs(query),
      fetchGoogleJobs(query),
      fetchLinkedInJobs(query)
    ]);
  }

  let allJobs = [...remotiveJobs, ...googleData.jobs, ...linkedinJobs];
  let nextToken = googleData.next_page_token;

  // Pós-processamento de Filtros (Somente para o Tipo, pois as APIs já filtram o resto)
  const { type } = query;
  let filteredJobs = allJobs;

  if (type && type !== 'Todos') {
    const typeNorm = normalizeText(type);
    filteredJobs = filteredJobs.filter(job => 
      normalizeText(job.type).includes(typeNorm)
    );
  }

  filteredJobs.sort((a, b) => new Date(b.date) - new Date(a.date));

  // Novo formato de resposta que inclui paginação
  res.json({
    jobs: filteredJobs,
    next_page_token: nextToken
  });
});

app.listen(PORT, () => {
  console.log(`Backend rodando na porta ${PORT}`);
});
