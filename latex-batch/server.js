const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 3737;
const OUTPUT_DIR = path.join(__dirname, 'output');

function makeLatex(job) {
  const { company, title, tag } = job;
  const safe = s => (s || '').replace(/[&%$#_{}~^\\]/g, '\\$&');
  return `\\documentclass[11pt]{article}
\\usepackage[margin=1in]{geometry}
\\usepackage{hyperref}
\\begin{document}

\\begin{center}
  {\\LARGE \\textbf{${safe(title)}}} \\\\[4pt]
  {\\large ${safe(company)}} \\\\[2pt]
  {\\small \\textit{Tag: ${safe(tag.toUpperCase())}}}
\\end{center}

\\vspace{1em}
\\noindent
% Add your tailored resume/cover content here for ${safe(company)}.

\\end{document}
`;
}

const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  if (req.method === 'POST' && req.url === '/create-latex') {
    let body = '';
    req.on('data', d => { body += d; });
    req.on('end', () => {
      try {
        const { jobs } = JSON.parse(body);
        if (!Array.isArray(jobs) || !jobs.length) throw new Error('No jobs provided');

        const MONTHS = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];
        const now = new Date();
        const dayFolder = `${MONTHS[now.getMonth()]}${now.getDate()}`;
        const dayDir = path.join(OUTPUT_DIR, dayFolder);

        const slug = s => (s || '').replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '').toLowerCase();
        const tagsUsed = new Set();

        jobs.forEach(job => {
          const tag = (job.tag || 'misc').toLowerCase();
          const tagDir = path.join(dayDir, tag);
          fs.mkdirSync(tagDir, { recursive: true });
          tagsUsed.add(tag);
          const name = `${slug(job.company) || 'job'}_${slug(job.title) || 'untitled'}.tex`;
          fs.writeFileSync(path.join(tagDir, name), makeLatex(job));
        });

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          ok: true,
          count: jobs.length,
          outputDir: dayDir,
          folders: [...tagsUsed].map(t => `${dayFolder}/${t}`),
        }));
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: err.message }));
      }
    });
    return;
  }

  res.writeHead(404);
  res.end();
});

server.listen(PORT, () => {
  console.log(`LaTeX server on http://localhost:${PORT}`);
  console.log(`Files saved to: ${OUTPUT_DIR}`);
});
