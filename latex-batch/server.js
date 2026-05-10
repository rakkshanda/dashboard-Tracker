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

        const stamp = Date.now();
        const folder = `batch-${stamp}`;
        const outDir = path.join(OUTPUT_DIR, folder);
        fs.mkdirSync(outDir, { recursive: true });

        jobs.forEach(job => {
          const name = `${(job.company || 'job').replace(/[^a-z0-9]/gi, '_')}_${job.tag}.tex`;
          fs.writeFileSync(path.join(outDir, name), makeLatex(job));
        });

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          ok: true,
          count: jobs.length,
          outputDir: outDir,
          folders: [folder],
          overleaf: false,
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
