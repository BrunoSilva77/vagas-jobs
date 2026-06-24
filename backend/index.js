import express from 'express';
import cors from 'cors';
import { mockJobs } from './mockData.js';

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

// Função auxiliar para normalizar texto (remover acentos e lowercase)
const normalizeText = (text) => {
  return text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
};

app.get('/api/jobs', (req, res) => {
  const { area, location, type, level } = req.query;
  
  let filteredJobs = [...mockJobs];

  // Filtro por Área de Atuação (busca no título, área ou descrição)
  if (area) {
    const areaNorm = normalizeText(area);
    filteredJobs = filteredJobs.filter(job => 
      normalizeText(job.title).includes(areaNorm) ||
      normalizeText(job.area).includes(areaNorm) ||
      normalizeText(job.description).includes(areaNorm)
    );
  }

  // Filtro por Local
  if (location) {
    const locationNorm = normalizeText(location);
    filteredJobs = filteredJobs.filter(job => 
      normalizeText(job.location).includes(locationNorm)
    );
  }

  // Filtro por Modalidade (Presencial, Home Office, Híbrido, etc)
  if (type && type !== 'Todos') {
    const typeNorm = normalizeText(type);
    filteredJobs = filteredJobs.filter(job => 
      normalizeText(job.type).includes(typeNorm)
    );
  }

  // Filtro por Nível de Experiência
  if (level && level !== 'Todos') {
    const levelNorm = normalizeText(level);
    filteredJobs = filteredJobs.filter(job => {
      const inLevelField = job.level && normalizeText(job.level).includes(levelNorm);
      const inTitleField = job.title && normalizeText(job.title).includes(levelNorm);
      return inLevelField || inTitleField;
    });
  }

  // Ordenar por data (mais recentes primeiro)
  filteredJobs.sort((a, b) => new Date(b.date) - new Date(a.date));

  // Simular um atraso de rede para parecer mais real ao buscar em vários sites
  setTimeout(() => {
    res.json(filteredJobs);
  }, 800);
});

app.listen(PORT, () => {
  console.log(`Backend rodando na porta ${PORT}`);
});
